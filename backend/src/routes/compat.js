const express = require('express');
const supabase = require('../config/supabase');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();
router.use(verificarToken);

function convertirParte(p) {
  const ubics = (p.parte_ubicaciones || []).sort((a, b) => a.orden - b.orden);
  return {
    'Código': p.codigo || '',
    'Descripción': p.gemini_descripcion || p.descripcion || '',
    'Marca': p.marcas?.nombre || '',
    'Ubicación Principal': ubics[0]?.ubicaciones?.codigo_ubicacion || '',
    'Ubicación 2': ubics[1]?.ubicaciones?.codigo_ubicacion || '',
    'Ubicación 3': ubics[2]?.ubicaciones?.codigo_ubicacion || '',
    'Ubicación 4': ubics[3]?.ubicaciones?.codigo_ubicacion || '',
    'Ubicación 5': ubics[4]?.ubicaciones?.codigo_ubicacion || '',
  };
}

// GET /api/compat/stats
router.get('/stats', async (req, res) => {
  const [{ count: total }, { count: conUbic }] = await Promise.all([
    supabase.from('partes').select('*', { count: 'exact', head: true }).eq('activo', true),
    supabase.from('parte_ubicaciones').select('parte_id', { count: 'exact', head: true })
  ]);
  const sinUbic = (total || 0) - (conUbic || 0);
  res.json({
    totalRepuestos: total || 0,
    conUbicacion: conUbic || 0,
    sinUbicacion: sinUbic < 0 ? 0 : sinUbic,
    porcentajeUbicados: total ? ((conUbic / total) * 100).toFixed(1) : 0
  });
});

// GET /api/compat/partes
router.get('/partes', async (req, res) => {
  const { con_ubicacion, sin_ubicacion } = req.query;
  let query = supabase
    .from('partes')
    .select(`codigo, descripcion, gemini_descripcion, marcas(nombre),
             parte_ubicaciones(orden, ubicaciones(codigo_ubicacion))`)
    .eq('activo', true)
    .limit(200);

  const { data } = await query;
  let partes = (data || []).map(convertirParte);

  if (con_ubicacion === 'true') partes = partes.filter(p => p['Ubicación Principal']);
  if (sin_ubicacion === 'true') partes = partes.filter(p => !p['Ubicación Principal']);

  res.json(partes);
});

// GET /api/compat/ubicacion/:ubicacion
router.get('/ubicacion/:ubicacion', async (req, res) => {
  const ub = req.params.ubicacion.toUpperCase();

  const { data: ubData } = await supabase
    .from('ubicaciones').select('id').eq('codigo_ubicacion', ub).single();

  if (!ubData) return res.json({ success: true, count: 0, ubicacion: ub, resultados: [] });

  const { data } = await supabase
    .from('parte_ubicaciones')
    .select(`orden, cantidad, parte:partes(codigo, descripcion, gemini_descripcion, marcas(nombre), parte_ubicaciones(orden, ubicaciones(codigo_ubicacion)))`)
    .eq('ubicacion_id', ubData.id);

  const resultados = (data || []).map(r => convertirParte(r.parte));
  res.json({ success: true, count: resultados.length, ubicacion: ub, resultados });
});

// GET /api/compat/ubicaciones
router.get('/ubicaciones', async (req, res) => {
  const { zona, pasillo } = req.query;
  let query = supabase.from('ubicaciones').select('*').eq('estado', 'ACTIVO').order('codigo_ubicacion').limit(500);
  if (zona) query = query.eq('zona', zona);
  if (pasillo) query = query.eq('pasillo', pasillo);
  const { data } = await query;
  res.json({ success: true, resultados: data || [], count: (data || []).length });
});

// POST /api/compat/ubicaciones
router.post('/ubicaciones', async (req, res) => {
  const { codigo, zona, pasillo, anaquel, rack, nivel } = req.body;
  if (!codigo) return res.status(400).json({ success: false, message: 'Código requerido' });
  const { error } = await supabase.from('ubicaciones').insert({ codigo_ubicacion: codigo.toUpperCase(), zona, pasillo, anaquel, rack, nivel });
  if (error) return res.json({ success: false, message: error.message });
  res.json({ success: true, message: `Ubicación ${codigo} creada` });
});

// POST /api/compat/asignar-ubicacion
router.post('/asignar-ubicacion', async (req, res) => {
  const { codigo, ubicacion } = req.body;
  if (!codigo || !ubicacion) return res.status(400).json({ success: false, message: 'Código y ubicación requeridos' });

  const ub = ubicacion.toUpperCase();
  const cod = codigo.toUpperCase();

  let { data: ubicData } = await supabase.from('ubicaciones').select('id').eq('codigo_ubicacion', ub).single();
  if (!ubicData) {
    const { data: nueva } = await supabase.from('ubicaciones').insert({ codigo_ubicacion: ub }).select('id').single();
    ubicData = nueva;
  }

  let { data: parte } = await supabase.from('partes').select('id').eq('codigo', cod).single();
  if (!parte) {
    const { data: nueva } = await supabase.from('partes').insert({ codigo: cod, codigo_limpio: cod.replace(/[^A-Z0-9]/g, '') }).select('id').single();
    parte = nueva;
  }

  if (!parte || !ubicData) return res.json({ success: false, message: 'Error al buscar parte o ubicación' });

  const { data: existentes } = await supabase.from('parte_ubicaciones').select('orden').eq('parte_id', parte.id).order('orden');
  const ordenUsados = (existentes || []).map(e => e.orden);
  const siguienteOrden = [1,2,3,4,5].find(n => !ordenUsados.includes(n)) || 1;

  await supabase.from('parte_ubicaciones').upsert({ parte_id: parte.id, ubicacion_id: ubicData.id, orden: siguienteOrden, cantidad: 0 }, { onConflict: 'parte_id,orden' });

  res.json({ success: true, message: `Ubicación ${ub} asignada a ${cod}`, campo: `Ubicación ${siguienteOrden}`, ubicacionNormalizada: ub });
});

// POST /api/compat/editar-parte
router.post('/editar-parte', async (req, res) => {
  const { codigo, descripcion, marca } = req.body;
  const updates = {};
  if (descripcion !== undefined) updates.descripcion = descripcion;
  const { error } = await supabase.from('partes').update(updates).eq('codigo', codigo?.toUpperCase());
  if (error) return res.json({ success: false, message: error.message });
  res.json({ success: true, message: `Parte ${codigo} actualizada` });
});

// POST /api/compat/eliminar-parte
router.post('/eliminar-parte', async (req, res) => {
  const { codigo, motivo } = req.body;
  const { error } = await supabase.from('partes').update({ activo: false }).eq('codigo', codigo?.toUpperCase());
  if (error) return res.json({ success: false, message: error.message });
  res.json({ success: true, message: `Parte ${codigo} desactivada. Motivo: ${motivo}` });
});

// POST /api/compat/verificar-codigo
router.post('/verificar-codigo', async (req, res) => {
  const { codigo, accion } = req.body;
  const cod = (codigo || '').toUpperCase();
  const { data } = await supabase.from('partes').select('id, codigo').eq('codigo', cod).single();
  res.json({ esValidado: !!data, codigo: cod, accion });
});

// POST /api/compat/guardar-verificacion
router.post('/guardar-verificacion', async (req, res) => {
  const datos = req.body;
  const ubicacion = (datos.ubicacion || '').toUpperCase();
  const codigosEsperados = datos.codigosEsperados || [];
  const codigosEncontrados = datos.codigosEncontrados || [];

  const validados = codigosEncontrados.filter(c => codigosEsperados.includes(c));
  const intrusos  = codigosEncontrados.filter(c => !codigosEsperados.includes(c));
  const ausentes  = codigosEsperados.filter(c => !codigosEncontrados.includes(c));
  const tasa = codigosEsperados.length > 0 ? ((validados.length / codigosEsperados.length) * 100).toFixed(2) : 100;

  const { data: ubicData } = await supabase.from('ubicaciones').select('id').eq('codigo_ubicacion', ubicacion).single();

  const { data: ver } = await supabase.from('verificaciones').insert({
    ubicacion,
    ubicacion_id: ubicData?.id || null,
    usuario_id: req.usuario.id,
    tasa_exito: parseFloat(tasa),
    total_esperados: codigosEsperados.length,
    total_validados: validados.length,
    total_intrusos: intrusos.length,
    total_ausentes: ausentes.length
  }).select().single();

  if (ver) {
    const detalles = [
      ...validados.map(c => ({ verificacion_id: ver.id, codigo: c, resultado: 'VALIDO' })),
      ...intrusos.map(c  => ({ verificacion_id: ver.id, codigo: c, resultado: 'INTRUSO' })),
      ...ausentes.map(c  => ({ verificacion_id: ver.id, codigo: c, resultado: 'AUSENTE' })),
    ];
    if (detalles.length) await supabase.from('verificacion_detalles').insert(detalles);
  }

  res.json({
    success: true,
    message: `Verificación guardada`,
    emailEnviado: false,
    metricas: {
      ubicacion, tasa_exito: tasa,
      total_esperados: codigosEsperados.length,
      validados: validados.length,
      intrusos: intrusos.length,
      ausentes: ausentes.length,
      listaIntrusos: intrusos,
      listaAusentes: ausentes
    }
  });
});

// POST /api/compat/guardar-recepcion
router.post('/guardar-recepcion', async (req, res) => {
  const datos = req.body;
  const idRecepcion = `REC-${Date.now()}`;

  const { data: rec } = await supabase.from('recepciones').insert({
    id_recepcion: idRecepcion,
    factura: datos.factura,
    proveedor: datos.proveedor || null,
    usuario_id: req.usuario.id,
    estado: 'COMPLETADO',
    completed_at: new Date().toISOString()
  }).select().single();

  const items = datos.items || [];
  if (rec && items.length) {
    const detalles = items.map(item => ({
      recepcion_id: rec.id,
      codigo: (item.codigo || '').toUpperCase(),
      cantidad: parseInt(item.cantidad) || 1,
      descripcion: item.descripcion || null,
      ubicacion: item.ubicacion || null,
    }));
    await supabase.from('detalles_recepcion').insert(detalles);
  }

  const itemsSinUbicar = items.filter(i => !i.ubicacion && !i.ubicado);

  res.json({
    success: true,
    message: 'Recepción guardada',
    idRecepcion,
    totalItems: items.length,
    itemsSinUbicar: itemsSinUbicar.map(i => i.codigo),
    hayItemsSinUbicar: itemsSinUbicar.length > 0,
    urlReporte: null
  });
});

// POST /api/compat/guardar-auditoria
router.post('/guardar-auditoria', async (req, res) => {
  const datos = req.body;
  const idAuditoria = `AUD-${Date.now()}`;

  await supabase.from('auditorias').insert({
    id_auditoria: idAuditoria,
    usuario_id: req.usuario.id,
    tipo: datos.estado || 'AUDITORIA',
    descripcion: datos.codigo,
    datos: { codigo: datos.codigo, cantidad: datos.cantidad, notas: datos.notas, estado: datos.estado }
  });

  res.json({ success: true, idAuditoria, message: 'Auditoría guardada' });
});

// GET /api/compat/buscar-cliente
router.get('/buscar-cliente', async (req, res) => {
  res.json({ success: true, items: [] });
});

// POST /api/compat/validar-items
router.post('/validar-items', async (req, res) => {
  const { items } = req.body;
  const itemsValidados = await Promise.all((items || []).map(async item => {
    const cod = (item.codigo || '').toUpperCase();
    const { data: parte } = await supabase
      .from('partes')
      .select(`codigo, descripcion, gemini_descripcion, parte_ubicaciones(orden, cantidad, ubicaciones(codigo_ubicacion))`)
      .eq('codigo', cod).single();

    const ubics = parte ? (parte.parte_ubicaciones || []).sort((a, b) => a.orden - b.orden) : [];
    return {
      ...item,
      codigo: cod,
      descripcion: parte?.gemini_descripcion || parte?.descripcion || item.descripcion || '',
      ubicacion: ubics[0]?.ubicaciones?.codigo_ubicacion || item.ubicacion || '',
      encontrado: !!parte,
      enInventario: !!parte
    };
  }));

  res.json({ success: true, items: itemsValidados, count: itemsValidados.length });
});

// POST /api/compat/guardar-despacho
router.post('/guardar-despacho', async (req, res) => {
  const datos = req.body;
  const idDespacho = `DSP-${Date.now()}`;

  const { data: desp } = await supabase.from('despachos').insert({
    id_despacho: idDespacho,
    cliente: datos.cliente || null,
    orden_ref: datos.ordenRef || null,
    usuario_id: req.usuario.id,
    estado: 'COMPLETADO',
    completed_at: new Date().toISOString()
  }).select().single();

  const items = datos.items || [];
  if (desp && items.length) {
    const detalles = items.map(item => ({
      despacho_id: desp.id,
      codigo: (item.codigo || '').toUpperCase(),
      cantidad: parseInt(item.cantidad) || 1,
      descripcion: item.descripcion || null,
      ubicacion: item.ubicacion || null,
      encontrado: item.encontrado || false,
      recogido: item.recogido || item.encontrado || false,
    }));
    await supabase.from('detalles_despacho').insert(detalles);
  }

  res.json({
    success: true,
    message: 'Despacho completado',
    idDespacho,
    totalItems: items.length,
    itemsEncontrados: items.filter(i => i.encontrado).length
  });
});

// POST /api/compat/guardar-conteo
router.post('/guardar-conteo', async (req, res) => {
  const datos = req.body;
  const idConteo = `CNT-${Date.now()}`;

  const { data: conteo } = await supabase.from('conteos').insert({
    id_conteo: idConteo,
    ubicacion: datos.ubicacion || null,
    usuario_id: req.usuario.id,
    estado: 'COMPLETADO',
    completed_at: new Date().toISOString()
  }).select().single();

  const items = datos.items || [];
  if (conteo && items.length) {
    const detalles = items.map(item => ({
      conteo_id: conteo.id,
      codigo: (item.codigo || '').toUpperCase(),
      cantidad_fisica: parseInt(item.cantidadFisica || item.cantidad_fisica) || 0,
      cantidad_sistema: parseInt(item.cantidadSistema || item.cantidad_sistema) || null,
    }));
    await supabase.from('detalles_conteo').insert(detalles);
  }

  res.json({ success: true, idConteo, message: 'Conteo guardado', totalItems: items.length });
});

module.exports = router;
