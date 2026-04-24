const express = require('express');
const supabase = require('../config/supabase');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/partes?q=18137 — buscar por código o descripción
router.get('/', verificarToken, async (req, res) => {
  const { q, marca_id, limit = 50 } = req.query;

  let query = supabase
    .from('partes')
    .select(`
      id, codigo, codigo_limpio, descripcion, activo,
      gemini_descripcion, gemini_cached_at,
      marca:marcas(id, nombre),
      ubicaciones:parte_ubicaciones(
        orden, cantidad,
        ubicacion:ubicaciones(id, codigo_ubicacion, zona, pasillo, anaquel, rack, nivel)
      )
    `)
    .eq('activo', true)
    .limit(parseInt(limit));

  if (q) {
    query = query.or(`codigo.ilike.%${q}%,codigo_limpio.ilike.%${q}%,descripcion.ilike.%${q}%`);
  }
  if (marca_id) {
    query = query.eq('marca_id', marca_id);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  res.json({ partes: data });
});

// GET /api/partes/:codigo — obtener una parte por código exacto
router.get('/:codigo', verificarToken, async (req, res) => {
  const { data, error } = await supabase
    .from('partes')
    .select(`
      id, codigo, codigo_limpio, descripcion, activo,
      gemini_descripcion, gemini_cached_at,
      marca:marcas(id, nombre),
      ubicaciones:parte_ubicaciones(
        orden, cantidad,
        ubicacion:ubicaciones(id, codigo_ubicacion, zona, pasillo, anaquel, rack, nivel)
      )
    `)
    .eq('codigo', req.params.codigo.toUpperCase())
    .single();

  if (error) return res.status(404).json({ error: 'Parte no encontrada' });
  res.json({ parte: data });
});

// POST /api/partes — crear nueva parte (Jefe y Operario)
router.post('/', verificarToken, async (req, res) => {
  const { codigo, descripcion, marca_id, ubicaciones } = req.body;

  if (!codigo) return res.status(400).json({ error: 'Código requerido' });

  const codigoLimpio = codigo.replace(/[^A-Z0-9]/gi, '').toUpperCase();

  const { data: parte, error } = await supabase
    .from('partes')
    .insert({ codigo: codigo.toUpperCase(), codigo_limpio: codigoLimpio, descripcion, marca_id })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  if (ubicaciones?.length > 0) {
    const relaciones = ubicaciones.slice(0, 5).map((u, i) => ({
      parte_id: parte.id,
      ubicacion_id: u.ubicacion_id,
      orden: i + 1,
      cantidad: u.cantidad || 0
    }));
    await supabase.from('parte_ubicaciones').insert(relaciones);
  }

  res.status(201).json({ parte });
});

// PATCH /api/partes/:id — actualizar parte (Jefe y Operario)
router.patch('/:id', verificarToken, async (req, res) => {
  const { descripcion, marca_id, activo } = req.body;

  const { data, error } = await supabase
    .from('partes')
    .update({ descripcion, marca_id, activo })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ parte: data });
});

module.exports = router;
