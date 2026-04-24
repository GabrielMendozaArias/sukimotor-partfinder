const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, pin } = req.body;

  if (!email || !pin) {
    return res.status(400).json({ error: 'Email y PIN requeridos' });
  }

  const { data: usuario, error } = await supabase
    .from('usuarios')
    .select('id, email, nombre, rol, pin_hash, pin_salt, activo')
    .eq('email', email.toLowerCase().trim())
    .eq('activo', true)
    .single();

  if (error || !usuario) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const pinValido = await bcrypt.compare(pin + usuario.pin_salt, usuario.pin_hash);
  if (!pinValido) {
    await supabase.from('log_sesiones').insert({
      usuario_id: usuario.id,
      email: usuario.email,
      accion: 'LOGIN_FALLIDO',
      ip_address: req.ip
    });
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const token = jwt.sign(
    { id: usuario.id, email: usuario.email, nombre: usuario.nombre, rol: usuario.rol },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  await supabase.from('log_sesiones').insert({
    usuario_id: usuario.id,
    email: usuario.email,
    accion: 'LOGIN',
    ip_address: req.ip
  });

  res.json({
    token,
    usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre, rol: usuario.rol }
  });
});

// POST /api/auth/logout
router.post('/logout', verificarToken, async (req, res) => {
  await supabase.from('log_sesiones').insert({
    usuario_id: req.usuario.id,
    email: req.usuario.email,
    accion: 'LOGOUT',
    ip_address: req.ip
  });
  res.json({ success: true });
});

// GET /api/auth/me
router.get('/me', verificarToken, (req, res) => {
  res.json({ usuario: req.usuario });
});

module.exports = router;
