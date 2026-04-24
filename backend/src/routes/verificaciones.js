const express = require('express');
const supabase = require('../config/supabase');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/verificaciones/iniciar — iniciar verificación de una ubicación
router.post('/iniciar', verificarToken, async (req, res) => {
  const { ubicacion } = req.body;
  if (!ubicacion) return res.status(400).json({ error: 'Ubicación requerida' });

  // Obtener partes esperadas en esta ubicación
  const { data: esperadas, error } = await supabase
    .from('parte_ubicaciones')
    .select('parte:partes(id, codigo, codigo_limpio, descripcion), cantidad')
    .eq('ubicacion.codigo_ubicacion', ubicacion)
    .not('parte', 'is', null);

  if (error) return res.status(500).json({ error: error.message });

  res.json({
    ubicacion,
    esperadas: esperadas.map(e => ({
      id: e.parte.id,
      codigo: e.parte.codigo,
      descripcion: e.parte.descripcion,
      cantidad_esperada: e.cantidad
    }))
  });
});

// POST /api/verificaciones — guardar resultado de verificación
router.post('/', verificarToken, async (req, res) => {
  const { ubicacion, codigos_escaneados } = req.body;

  if (!ubicacion || !Array.isArray(codigos_escaneados)) {
    return res.status(400).json({ error: 'Ubicación y códigos requeridos' });
  }

  // Obtener partes esperadas
  const { data: ubicData } = await supabase
    .from('ubicaciones')
    .select('id')
    .eq('codigo_ubicacion', ubicacion)
    .single();

  const { data: esperadasData } = await supabase
    .from('parte_ubicaciones')
    .select('parte:partes(codigo)')
    .eq('ubicacion_id', ubicData?.id);

  const codigosEsperados = new Set((esperadasData || []).map(e => e.parte.codigo));
  const codigosEscaneados = new Set(codigos_escaneados.map(c => c.toUpperCase()));

  const validados = [...codigosEscaneados].filter(c => codigosEsperados.has(c));
  const intrusos  = [...codigosEscaneados].filter(c => !codigosEsperados.has(c));
  const ausentes  = [...codigosEsperados].filter(c => !codigosEscaneados.has(c));

  const total = codigosEsperados.size || 1;
  const tasa_exito = Math.round((validados.length / total) * 100 * 100) / 100;

  // Guardar verificación
  const { data: verificacion, error } = await supabase
    .from('verificaciones')
    .insert({
      ubicacion_id: ubicData?.id || null,
      ubicacion,
      usuario_id: req.usuario.id,
      tasa_exito,
      total_esperados: codigosEsperados.size,
      total_validados: validados.length,
      total_intrusos: intrusos.length,
      total_ausentes: ausentes.length
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Guardar detalles
  const detalles = [
    ...validados.map(c => ({ verificacion_id: verificacion.id, codigo: c, resultado: 'VALIDO' })),
    ...intrusos.map(c  => ({ verificacion_id: verificacion.id, codigo: c, resultado: 'INTRUSO' })),
    ...ausentes.map(c  => ({ verificacion_id: verificacion.id, codigo: c, resultado: 'AUSENTE' })),
  ];

  if (detalles.length > 0) {
    await supabase.from('verificacion_detalles').insert(detalles);
  }

  res.status(201).json({ verificacion, validados, intrusos, ausentes, tasa_exito });
});

// PATCH /api/verificaciones/:id/accion — tomar acción sobre un intruso
router.patch('/:id/accion', verificarToken, async (req, res) => {
  const { codigo, accion } = req.body;
  // accion: 'AGREGAR' | 'IGNORAR'

  if (!['AGREGAR', 'IGNORAR'].includes(accion)) {
    return res.status(400).json({ error: 'Acción inválida' });
  }

  await supabase
    .from('verificacion_detalles')
    .update({ accion_tomada: accion })
    .eq('verificacion_id', req.params.id)
    .eq('codigo', codigo.toUpperCase());

  if (accion === 'AGREGAR') {
    // Obtener la ubicación de la verificación
    const { data: ver } = await supabase
      .from('verificaciones')
      .select('ubicacion_id')
      .eq('id', req.params.id)
      .single();

    // Buscar o crear la parte
    let { data: parte } = await supabase
      .from('partes')
      .select('id')
      .eq('codigo', codigo.toUpperCase())
      .single();

    if (!parte) {
      const { data: nueva } = await supabase
        .from('partes')
        .insert({ codigo: codigo.toUpperCase(), codigo_limpio: codigo.replace(/[^A-Z0-9]/gi, '').toUpperCase() })
        .select()
        .single();
      parte = nueva;
    }

    // Agregar relación parte-ubicación si no existe
    if (parte && ver?.ubicacion_id) {
      const { data: existente } = await supabase
        .from('parte_ubicaciones')
        .select('id')
        .eq('parte_id', parte.id)
        .eq('ubicacion_id', ver.ubicacion_id)
        .single();

      if (!existente) {
        const { data: maxOrden } = await supabase
          .from('parte_ubicaciones')
          .select('orden')
          .eq('parte_id', parte.id)
          .order('orden', { ascending: false })
          .limit(1)
          .single();

        await supabase.from('parte_ubicaciones').insert({
          parte_id: parte.id,
          ubicacion_id: ver.ubicacion_id,
          orden: (maxOrden?.orden || 0) + 1,
          cantidad: 1
        });
      }
    }
  }

  res.json({ success: true, accion });
});

// GET /api/verificaciones — historial
router.get('/', verificarToken, async (req, res) => {
  const { data, error } = await supabase
    .from('verificaciones')
    .select(`id, ubicacion, tasa_exito, total_esperados, total_validados, total_intrusos, total_ausentes, created_at,
             usuario:usuarios(nombre, email)`)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ verificaciones: data });
});

module.exports = router;
