const express = require('express');
const supabase = require('../config/supabase');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/conteos — crear nuevo conteo
router.post('/', verificarToken, async (req, res) => {
  const { ubicacion } = req.body;

  const { data, error } = await supabase
    .from('conteos')
    .insert({ id_conteo: `CNT-${Date.now()}`, ubicacion: ubicacion?.toUpperCase() || null, usuario_id: req.usuario.id })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ conteo: data });
});

// POST /api/conteos/:id/items — registrar cantidad física de una parte
router.post('/:id/items', verificarToken, async (req, res) => {
  const { codigo, cantidad_fisica } = req.body;

  if (!codigo || cantidad_fisica === undefined) {
    return res.status(400).json({ error: 'Código y cantidad requeridos' });
  }

  // Buscar cantidad en sistema
  const { data: parte } = await supabase
    .from('partes')
    .select(`id, parte_ubicaciones(cantidad, ubicacion:ubicaciones(codigo_ubicacion))`)
    .eq('codigo', codigo.toUpperCase())
    .single();

  let cantidad_sistema = null;
  if (parte) {
    const { data: conteo } = await supabase.from('conteos').select('ubicacion').eq('id', req.params.id).single();
    const pu = conteo?.ubicacion
      ? parte.parte_ubicaciones?.find(u => u.ubicacion?.codigo_ubicacion === conteo.ubicacion)
      : parte.parte_ubicaciones?.[0];
    cantidad_sistema = pu?.cantidad ?? null;
  }

  // Verificar si ya existe este código en el conteo
  const { data: existente } = await supabase
    .from('detalles_conteo')
    .select('id')
    .eq('conteo_id', req.params.id)
    .eq('codigo', codigo.toUpperCase())
    .single();

  if (existente) {
    const { data, error } = await supabase
      .from('detalles_conteo')
      .update({ cantidad_fisica: parseInt(cantidad_fisica), cantidad_sistema })
      .eq('id', existente.id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ item: data, actualizado: true });
  }

  const { data, error } = await supabase
    .from('detalles_conteo')
    .insert({
      conteo_id: req.params.id,
      codigo: codigo.toUpperCase(),
      cantidad_fisica: parseInt(cantidad_fisica),
      cantidad_sistema
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ item: data });
});

// GET /api/conteos/:id/items
router.get('/:id/items', verificarToken, async (req, res) => {
  const { data, error } = await supabase
    .from('detalles_conteo')
    .select('*')
    .eq('conteo_id', req.params.id)
    .order('created_at');

  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data });
});

// PATCH /api/conteos/:id/completar
router.patch('/:id/completar', verificarToken, async (req, res) => {
  const { data, error } = await supabase
    .from('conteos')
    .update({ estado: 'COMPLETADO', completed_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ conteo: data });
});

// GET /api/conteos — historial
router.get('/', verificarToken, async (req, res) => {
  const { data, error } = await supabase
    .from('conteos')
    .select(`id, id_conteo, ubicacion, estado, created_at, usuario:usuarios(nombre, email)`)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ conteos: data });
});

module.exports = router;
