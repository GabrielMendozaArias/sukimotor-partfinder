const express = require('express');
const supabase = require('../config/supabase');
const { verificarToken, soloJefe } = require('../middleware/auth');

const router = express.Router();

// GET /api/auditorias — historial completo (solo Jefe)
router.get('/', verificarToken, soloJefe, async (req, res) => {
  const { tipo, desde, hasta, limit = 100 } = req.query;

  let query = supabase
    .from('auditorias')
    .select(`id, id_auditoria, tipo, descripcion, datos, created_at,
             usuario:usuarios(nombre, email)`)
    .order('created_at', { ascending: false })
    .limit(parseInt(limit));

  if (tipo) query = query.eq('tipo', tipo);
  if (desde) query = query.gte('created_at', desde);
  if (hasta) query = query.lte('created_at', hasta);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ auditorias: data });
});

// GET /api/auditorias/resumen — estadísticas del día (solo Jefe)
router.get('/resumen', verificarToken, soloJefe, async (req, res) => {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const [recepciones, despachos, verificaciones, conteos, sesiones] = await Promise.all([
    supabase.from('recepciones').select('id', { count: 'exact' }).gte('created_at', hoy.toISOString()),
    supabase.from('despachos').select('id', { count: 'exact' }).gte('created_at', hoy.toISOString()),
    supabase.from('verificaciones').select('id, tasa_exito', { count: 'exact' }).gte('created_at', hoy.toISOString()),
    supabase.from('conteos').select('id', { count: 'exact' }).gte('created_at', hoy.toISOString()),
    supabase.from('log_sesiones').select('id', { count: 'exact' }).eq('accion', 'LOGIN').gte('created_at', hoy.toISOString()),
  ]);

  const tasaPromedio = verificaciones.data?.length > 0
    ? Math.round(verificaciones.data.reduce((s, v) => s + (v.tasa_exito || 0), 0) / verificaciones.data.length)
    : null;

  res.json({
    fecha: hoy.toISOString().split('T')[0],
    recepciones_hoy: recepciones.count || 0,
    despachos_hoy: despachos.count || 0,
    verificaciones_hoy: verificaciones.count || 0,
    tasa_verificacion_promedio: tasaPromedio,
    conteos_hoy: conteos.count || 0,
    logins_hoy: sesiones.count || 0,
  });
});

// GET /api/auditorias/actividad — últimos eventos de todas las tablas
router.get('/actividad', verificarToken, soloJefe, async (req, res) => {
  const { limit = 30 } = req.query;
  const lim = parseInt(limit);

  const [recepciones, despachos, verificaciones, conteos] = await Promise.all([
    supabase.from('recepciones').select(`id_recepcion, factura, estado, created_at, usuario:usuarios(nombre, email)`).order('created_at', { ascending: false }).limit(lim),
    supabase.from('despachos').select(`id_despacho, cliente, estado, created_at, usuario:usuarios(nombre, email)`).order('created_at', { ascending: false }).limit(lim),
    supabase.from('verificaciones').select(`ubicacion, tasa_exito, created_at, usuario:usuarios(nombre, email)`).order('created_at', { ascending: false }).limit(lim),
    supabase.from('conteos').select(`id_conteo, ubicacion, estado, created_at, usuario:usuarios(nombre, email)`).order('created_at', { ascending: false }).limit(lim),
  ]);

  // Unir y ordenar por fecha
  const actividad = [
    ...(recepciones.data || []).map(r => ({ tipo: 'RECEPCION', descripcion: `Recepción ${r.id_recepcion} — Factura ${r.factura || '—'}`, estado: r.estado, fecha: r.created_at, usuario: r.usuario })),
    ...(despachos.data || []).map(d => ({ tipo: 'DESPACHO', descripcion: `Despacho ${d.id_despacho} — Cliente: ${d.cliente || '—'}`, estado: d.estado, fecha: d.created_at, usuario: d.usuario })),
    ...(verificaciones.data || []).map(v => ({ tipo: 'VERIFICACION', descripcion: `Verificación ${v.ubicacion} — ${v.tasa_exito}% de éxito`, estado: 'COMPLETADO', fecha: v.created_at, usuario: v.usuario })),
    ...(conteos.data || []).map(c => ({ tipo: 'CONTEO', descripcion: `Conteo ${c.id_conteo}${c.ubicacion ? ` — ${c.ubicacion}` : ''}`, estado: c.estado, fecha: c.created_at, usuario: c.usuario })),
  ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, lim);

  res.json({ actividad });
});

// POST /api/auditorias — registrar evento manual
router.post('/', verificarToken, async (req, res) => {
  const { tipo, descripcion, datos } = req.body;
  if (!tipo) return res.status(400).json({ error: 'Tipo requerido' });

  const { data, error } = await supabase
    .from('auditorias')
    .insert({ id_auditoria: `AUD-${Date.now()}`, tipo, descripcion, datos, usuario_id: req.usuario.id })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ auditoria: data });
});

module.exports = router;
