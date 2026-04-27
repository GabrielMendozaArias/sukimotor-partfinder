const express = require('express');
const crypto  = require('crypto');
const jwt     = require('jsonwebtoken');
const supabase = require('../config/supabase');
const { verificarToken, soloJefe } = require('../middleware/auth');

const router = express.Router();

// SHA-256 idéntico al que usa Google Apps Script:
// Utilities.computeDigest(SHA_256, pin+salt) → base64Encode
function hashPIN(pin, salt) {
  if (!salt) salt = crypto.randomBytes(8).toString('hex').substring(0, 16);
  const hash = crypto.createHash('sha256').update(pin + salt, 'utf8').digest('base64');
  return { hash, salt };
}
function verifyPIN(pin, storedHash, salt) {
  const { hash } = hashPIN(pin, salt);
  return hash === storedHash;
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, pin } = req.body;
  if (!email || !pin) return res.status(400).json({ error: 'Email y PIN requeridos' });

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('id, email, nombre, rol, pin_hash, pin_salt, activo, permisos')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (!usuario || !usuario.activo)
    return res.status(401).json({ error: 'Credenciales inválidas' });

  if (!verifyPIN(pin.toString(), usuario.pin_hash, usuario.pin_salt)) {
    await supabase.from('log_sesiones').insert({ usuario_id: usuario.id, email: usuario.email, accion: 'LOGIN_FALLIDO', ip_address: req.ip });
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const token = jwt.sign(
    { id: usuario.id, email: usuario.email, nombre: usuario.nombre, rol: usuario.rol },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  await supabase.from('log_sesiones').insert({ usuario_id: usuario.id, email: usuario.email, accion: 'LOGIN', ip_address: req.ip });

  const rolFrontend = usuario.rol === 'Jefe' ? 'Admin' : 'Almacenista';
  res.json({
    token,
    usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre, rol: rolFrontend, permisos: usuario.permisos || {} }
  });
});

// POST /api/auth/logout
router.post('/logout', verificarToken, async (req, res) => {
  await supabase.from('log_sesiones').insert({ usuario_id: req.usuario.id, email: req.usuario.email, accion: 'LOGOUT', ip_address: req.ip });
  res.json({ success: true });
});

// GET /api/auth/me
router.get('/me', verificarToken, async (req, res) => {
  const { data } = await supabase
    .from('usuarios')
    .select('id, email, nombre, rol, permisos')
    .eq('id', req.usuario.id)
    .single();
  if (!data) return res.status(404).json({ error: 'Usuario no encontrado' });
  const rolFrontend = data.rol === 'Jefe' ? 'Admin' : 'Almacenista';
  res.json({ usuario: { ...data, rol: rolFrontend } });
});

// GET /api/auth/usuarios — listar (solo Jefe)
router.get('/usuarios', verificarToken, soloJefe, async (req, res) => {
  const { data, error } = await supabase
    .from('usuarios').select('id, email, nombre, rol, activo, created_at').order('created_at');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ usuarios: data });
});

// POST /api/auth/usuarios — crear usuario (solo Jefe)
router.post('/usuarios', verificarToken, soloJefe, async (req, res) => {
  const { email, nombre, pin, rol } = req.body;
  if (!email || !pin || !rol) return res.status(400).json({ error: 'Email, PIN y rol requeridos' });
  if (!['Jefe', 'Operario'].includes(rol)) return res.status(400).json({ error: 'Rol inválido' });

  const { hash, salt } = hashPIN(pin.toString());
  const { data, error } = await supabase
    .from('usuarios')
    .insert({ email: email.toLowerCase().trim(), nombre: nombre?.trim(), rol, pin_hash: hash, pin_salt: salt, activo: true })
    .select('id, email, nombre, rol, activo').single();

  if (error) return res.status(400).json({ error: error.message.includes('unique') ? 'El email ya existe' : error.message });
  res.status(201).json({ usuario: data });
});

// PATCH /api/auth/usuarios/:id — actualizar (solo Jefe)
router.patch('/usuarios/:id', verificarToken, soloJefe, async (req, res) => {
  const { nombre, pin, rol, activo } = req.body;
  const updates = {};
  if (nombre !== undefined) updates.nombre = nombre.trim();
  if (rol !== undefined) {
    if (!['Jefe', 'Operario'].includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
    updates.rol = rol;
  }
  if (activo !== undefined) updates.activo = activo;
  if (pin !== undefined) {
    const { hash, salt } = hashPIN(pin.toString());
    updates.pin_hash = hash;
    updates.pin_salt = salt;
  }
  const { data, error } = await supabase
    .from('usuarios').update(updates).eq('id', req.params.id)
    .select('id, email, nombre, rol, activo').single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ usuario: data });
});

// POST /api/auth/setup — crear primer admin
router.post('/setup', async (req, res) => {
  const { count } = await supabase.from('usuarios').select('*', { count: 'exact', head: true });
  if (count > 0) return res.status(403).json({ error: 'El sistema ya tiene usuarios' });
  const { email, nombre, pin } = req.body;
  if (!email || !pin) return res.status(400).json({ error: 'Email y PIN requeridos' });
  const { hash, salt } = hashPIN(pin.toString());
  const { data, error } = await supabase
    .from('usuarios')
    .insert({ email: email.toLowerCase().trim(), nombre: nombre?.trim() || 'Administrador', rol: 'Jefe', pin_hash: hash, pin_salt: salt, activo: true })
    .select('id, email, nombre, rol').single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ mensaje: 'Administrador creado', usuario: data });
});

module.exports = router;
