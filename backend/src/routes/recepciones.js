const express = require('express');
const supabase = require('../config/supabase');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/recepciones — listar recepciones recientes
router.get('/', verificarToken, async (req, res) => {
  const { data, error } = await supabase
    .from('recepciones')
    .select(`id, id_recepcion, factura, proveedor, estado, created_at,
             usuario:usuarios(nombre, email)`)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ recepciones: data });
});

// POST /api/recepciones — crear nueva recepción
router.post('/', verificarToken, async (req, res) => {
  const { factura, proveedor, observaciones } = req.body;

  const idRecepcion = `REC-${Date.now()}`;

  const { data, error } = await supabase
    .from('recepciones')
    .insert({ id_recepcion: idRecepcion, factura, proveedor, observaciones, usuario_id: req.usuario.id })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ recepcion: data });
});

// POST /api/recepciones/:id/items — agregar item a recepción
router.post('/:id/items', verificarToken, async (req, res) => {
  const { codigo, cantidad, descripcion, ubicacion } = req.body;

  if (!codigo || !cantidad) return res.status(400).json({ error: 'Código y cantidad requeridos' });

  // Buscar si la parte ya existe
  const { data: parte } = await supabase
    .from('partes')
    .select('id')
    .eq('codigo', codigo.toUpperCase())
    .single();

  const { data, error } = await supabase
    .from('detalles_recepcion')
    .insert({
      recepcion_id: req.params.id,
      parte_id: parte?.id || null,
      codigo: codigo.toUpperCase(),
      cantidad: parseInt(cantidad),
      descripcion,
      ubicacion
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ item: data });
});

// GET /api/recepciones/:id/items — obtener items de una recepción
router.get('/:id/items', verificarToken, async (req, res) => {
  const { data, error } = await supabase
    .from('detalles_recepcion')
    .select('*')
    .eq('recepcion_id', req.params.id)
    .order('created_at');

  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data });
});

// PATCH /api/recepciones/:id/completar — completar recepción
router.patch('/:id/completar', verificarToken, async (req, res) => {
  const { data, error } = await supabase
    .from('recepciones')
    .update({ estado: 'COMPLETADO', completed_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ recepcion: data });
});

module.exports = router;
