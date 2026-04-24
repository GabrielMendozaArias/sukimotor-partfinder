const express = require('express');
const supabase = require('../config/supabase');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/despachos
router.get('/', verificarToken, async (req, res) => {
  const { data, error } = await supabase
    .from('despachos')
    .select(`id, id_despacho, cliente, orden_ref, estado, created_at,
             usuario:usuarios(nombre, email)`)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ despachos: data });
});

// POST /api/despachos — crear nuevo despacho
router.post('/', verificarToken, async (req, res) => {
  const { cliente, orden_ref, observaciones } = req.body;

  const { data, error } = await supabase
    .from('despachos')
    .insert({ id_despacho: `DSP-${Date.now()}`, cliente, orden_ref, observaciones, usuario_id: req.usuario.id })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ despacho: data });
});

// POST /api/despachos/:id/items — agregar item
router.post('/:id/items', verificarToken, async (req, res) => {
  const { codigo, cantidad, descripcion, ubicacion } = req.body;

  if (!codigo || !cantidad) return res.status(400).json({ error: 'Código y cantidad requeridos' });

  const { data: parte } = await supabase
    .from('partes')
    .select('id, descripcion, parte_ubicaciones(cantidad, ubicacion:ubicaciones(codigo_ubicacion))')
    .eq('codigo', codigo.toUpperCase())
    .single();

  const { data, error } = await supabase
    .from('detalles_despacho')
    .insert({
      despacho_id: req.params.id,
      parte_id: parte?.id || null,
      codigo: codigo.toUpperCase(),
      cantidad: parseInt(cantidad),
      descripcion: descripcion || parte?.descripcion,
      ubicacion: ubicacion || parte?.parte_ubicaciones?.[0]?.ubicacion?.codigo_ubicacion || null,
      encontrado: false,
      recogido: false
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ item: data });
});

// GET /api/despachos/:id/items
router.get('/:id/items', verificarToken, async (req, res) => {
  const { data, error } = await supabase
    .from('detalles_despacho')
    .select('*')
    .eq('despacho_id', req.params.id)
    .order('created_at');

  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data });
});

// PATCH /api/despachos/:id/items/:itemId — marcar encontrado/recogido
router.patch('/:id/items/:itemId', verificarToken, async (req, res) => {
  const { encontrado, recogido } = req.body;

  const { data, error } = await supabase
    .from('detalles_despacho')
    .update({ encontrado, recogido })
    .eq('id', req.params.itemId)
    .eq('despacho_id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ item: data });
});

// PATCH /api/despachos/:id/completar
router.patch('/:id/completar', verificarToken, async (req, res) => {
  const { data, error } = await supabase
    .from('despachos')
    .update({ estado: 'COMPLETADO', completed_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ despacho: data });
});

module.exports = router;
