// ============================================================
// PARTFINDER SUKIMOTOR - BACKEND SUPABASE
// Google Apps Script V8 — Reemplaza Google Sheets con Supabase
// Configurar en Project Settings > Script Properties:
//   SUPABASE_URL         = https://TU-PROYECTO.supabase.co
//   SUPABASE_SERVICE_KEY = sb_secret_...  (Project Settings > API > service_role)
//   GEMINI_API_KEY       = (tu key de Gemini)
// ============================================================

const CONFIG = {
  EMAIL_REPORTE:  "soporte@suz.com.pa",
  DRIVE_FOLDER_ID:"1ETnLLpvbhQg9RAPVoi5DkXi7fLH00VR8"
};

const GEMINI_CONFIG = {
  MODEL: "gemini-2.5-flash",
  API_ENDPOINT: "https://generativelanguage.googleapis.com/v1beta/models",
  MAX_TOKENS: 2048,
  TEMPERATURE: 0.1,
  CACHE_DURATION_HOURS: 24
};

const MARCAS_VALIDAS = {
  MOTOS:   ['Suzuki','Haojue','SYM','Loncin','Fuego'],
  MARINOS: ['Suzuki']
};

// ── SUPABASE CLIENT ─────────────────────────────────────────
class SupabaseClient {
  constructor() {
    const p = PropertiesService.getScriptProperties();
    this.base = p.getProperty('SUPABASE_URL') + '/rest/v1';
    // GAS usa la anon/publishable key — la service key es bloqueada por Supabase
    // Las operaciones privilegiadas usan funciones SECURITY DEFINER via /rpc/
    this.key  = p.getProperty('SUPABASE_ANON_KEY');
    this.hdrs = {
      'apikey':        this.key,
      'Authorization': 'Bearer ' + this.key,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation'
    };
  }

  // Llamar a una función PostgreSQL (SECURITY DEFINER bypasea RLS)
  rpc(fn, params) {
    return this._req('/rpc/' + fn, 'POST', params || {});
  }

  _req(path, method, body, extraHeaders) {
    const opts = {
      method: method || 'GET',
      headers: Object.assign({}, this.hdrs, extraHeaders || {}),
      muteHttpExceptions: true
    };
    if (body !== undefined && body !== null) opts.payload = JSON.stringify(body);
    try {
      const r    = UrlFetchApp.fetch(this.base + path, opts);
      const code = r.getResponseCode();
      const txt  = r.getContentText();
      if (!txt || txt === 'null' || txt === '[]' && code >= 400) return null;
      const parsed = JSON.parse(txt);
      if (code >= 400) { Logger.log('SB Error ' + code + ': ' + txt); return null; }
      return parsed;
    } catch(e) { Logger.log('SB req error: ' + e); return null; }
  }

  get(table, q)          { return this._req('/' + table + (q ? '?' + q : ''), 'GET'); }
  getOne(table, q)       { const r = this.get(table, (q||'') + (q?'&':'') + 'limit=1'); return Array.isArray(r) ? r[0]||null : r; }
  insert(table, data)    { return this._req('/' + table, 'POST', Array.isArray(data)?data:[data]); }
  update(table, q, data) { return this._req('/' + table + (q?'?'+q:''), 'PATCH', data); }
  del(table, q)          { return this._req('/' + table + (q?'?'+q:''), 'DELETE'); }
  count(table, q) {
    const r = this._req('/' + table + (q?'?'+q:''), 'GET', null, {'Prefer':'count=exact','Range':'0-0'});
    // Supabase returns count in Content-Range header — approximate via array length fallback
    return Array.isArray(r) ? r.length : 0;
  }
  upsert(table, data, onConflict) {
    const path = '/' + table + (onConflict ? '?on_conflict=' + onConflict : '');
    return this._req(path, 'POST', Array.isArray(data)?data:[data], {'Prefer':'resolution=merge-duplicates,return=representation'});
  }
}

let _sb = null;
function getSB() { if (!_sb) _sb = new SupabaseClient(); return _sb; }

// ── CACHE INVENTARIO (GAS CacheService, 5 min) ──────────────
let _invCache = null, _invTs = 0;

function getCachedInventario() {
  const now = Date.now();
  if (_invCache && (now - _invTs) < 300000) return _invCache;
  const sb = getSB();
  const rows = sb.get('partes',
    'select=codigo,descripcion,gemini_descripcion,updated_at,' +
    'marcas(nombre),' +
    'parte_ubicaciones(orden,ubicaciones(codigo_ubicacion))' +
    '&activo=eq.true&limit=30000'
  );
  _invCache = (rows || []).map(sbToRow);
  _invTs    = now;
  return _invCache;
}

function clearCacheInventario() { _invCache = null; _invTs = 0; }

function sbToRow(p) {
  if (!p) return null;
  const ubics = (p.parte_ubicaciones || []).sort((a,b) => a.orden - b.orden);
  const ult = p.updated_at ? new Date(p.updated_at).toLocaleDateString('es-PA') : '';
  return {
    'Código':              p.codigo || '',
    'Descripción':         p.gemini_descripcion || p.descripcion || '',
    'Marca':               (p.marcas && p.marcas.nombre) ? p.marcas.nombre : '',
    'Ubicación Principal': ubics[0] ? (ubics[0].ubicaciones||{}).codigo_ubicacion||'' : '',
    'Ubicación 2':         ubics[1] ? (ubics[1].ubicaciones||{}).codigo_ubicacion||'' : '',
    'Ubicación 3':         ubics[2] ? (ubics[2].ubicaciones||{}).codigo_ubicacion||'' : '',
    'Ubicación 4':         ubics[3] ? (ubics[3].ubicaciones||{}).codigo_ubicacion||'' : '',
    'Ubicación 5':         ubics[4] ? (ubics[4].ubicaciones||{}).codigo_ubicacion||'' : '',
    'Último Inventario':   ult,
    '_parte_id':           p.id || ''
  };
}

// ── PIN HASHING (SHA-256, compatible con GAS) ────────────────
function hashPIN(pin, salt) {
  if (!salt) salt = Utilities.getUuid().substring(0, 16);
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pin + salt);
  return { hash: Utilities.base64Encode(bytes), salt: salt };
}
function verifyPIN(pin, storedHash, salt) {
  const { hash } = hashPIN(pin, salt);
  return hash === storedHash;
}

// ── SESSION MANAGER (GAS CacheService) ──────────────────────
class SessionManager {
  constructor() { this.cache = CacheService.getScriptCache(); }
  setSession(userData, sid) {
    if (!sid) sid = Utilities.getUuid();
    this.cache.put('session_' + sid, JSON.stringify(userData), 14400);
    this.cache.put('activity_' + sid, Date.now().toString(), 14400);
    return { success: true, sessionId: sid };
  }
  getSession(sid) {
    if (!sid) return null;
    const act = this.cache.get('activity_' + sid);
    if (!act) return null;
    if (Date.now() - parseInt(act) > 1800000) { this.clearSession(sid); return null; }
    this.cache.put('activity_' + sid, Date.now().toString(), 14400);
    const raw = this.cache.get('session_' + sid);
    return raw ? JSON.parse(raw) : null;
  }
  clearSession(sid) {
    this.cache.remove('session_' + sid);
    this.cache.remove('activity_' + sid);
  }
}

// ── AUTENTICACIÓN ────────────────────────────────────────────
function authenticateUser(email, pin) {
  try {
    const sb   = getSB();
    // Usamos RPC (SECURITY DEFINER) para leer usuarios sin exponer la tabla directamente
    const rows = sb.rpc('get_user_for_auth', { p_email: email.toLowerCase().trim() });
    const row  = Array.isArray(rows) ? rows[0] : rows;
    if (!row || !row.activo) return { success: false, message: 'Credenciales inválidas' };
    if (!verifyPIN(pin.toString(), row.pin_hash, row.pin_salt))
      return { success: false, message: 'Credenciales inválidas' };

    const userData = {
      email:    row.email,
      nombre:   row.nombre || '',
      rol:      row.rol === 'Jefe' ? 'Admin' : 'Almacenista',
      permisos: row.permisos || {}
    };
    const sm  = new SessionManager();
    const res = sm.setSession(userData);
    return { success: true, email: row.email, rol: userData.rol, nombre: userData.nombre, permisos: userData.permisos, sessionId: res.sessionId };
  } catch(e) {
    Logger.log('Error authenticateUser: ' + e);
    return { success: false, message: e.toString() };
  }
}

function getSessionUser(sessionId) {
  if (!sessionId) return { success: false, requireLogin: true, message: 'Sin sesión' };
  const sm   = new SessionManager();
  const user = sm.getSession(sessionId);
  if (!user) return { success: false, requireLogin: true, message: 'Sesión expirada' };
  return { success: true, user: user };
}

function logoutUser(sessionId) {
  if (!sessionId) return { success: false };
  new SessionManager().clearSession(sessionId);
  return { success: true };
}

// ── BÚSQUEDA ─────────────────────────────────────────────────
function buscarCodigo(codigo) {
  const cleanInfo = cleanPartCode(codigo);
  const term      = cleanInfo.clean || codigo.trim().toUpperCase();
  const sb        = getSB();
  const enc       = encodeURIComponent('%' + term + '%');
  const rows      = sb.get('partes',
    'select=codigo,descripcion,gemini_descripcion,updated_at,' +
    'marcas(nombre),parte_ubicaciones(orden,ubicaciones(codigo_ubicacion))' +
    '&activo=eq.true' +
    '&or=(codigo.ilike.' + enc + ',codigo_limpio.ilike.' + enc + ')' +
    '&limit=20'
  );
  const resultados = (rows || []).map(sbToRow);
  return { originalInput: codigo, cleanedCode: term, isValid: cleanInfo.isValid, isSYM: cleanInfo.isSYM, manualReview: cleanInfo.manualReview, info: cleanInfo.info, resultados, count: resultados.length };
}
function buscarCodigoRecepcion(c)   { return buscarCodigo(c); }
function buscarCodigoAuditoria(c)   { return buscarCodigo(c); }
function buscarCodigoEditar(c)      { return buscarCodigo(c); }
function buscarCodigoVerificacion(c){ return buscarCodigo(c); }
function escanearCodigoRecepcion(c) { return buscarCodigo(c); }

function buscarPorUbicacion(ubicacion) {
  const ubicInfo = normalizarUbicacion(ubicacion);
  const ub       = ubicInfo.normalized;
  const sb       = getSB();
  const ubicRow  = sb.getOne('ubicaciones', 'codigo_ubicacion=eq.' + encodeURIComponent(ub) + '&select=id');
  if (!ubicRow) return { ubicacion: ub, ubicacionOriginal: ubicacion, resultados: [], count: 0, normalizado: 'No encontrada' };

  const puRows = sb.get('parte_ubicaciones',
    'select=orden,parte:partes(codigo,descripcion,gemini_descripcion,updated_at,marcas(nombre),parte_ubicaciones(orden,ubicaciones(codigo_ubicacion)))' +
    '&ubicacion_id=eq.' + ubicRow.id
  );
  const resultados = (puRows || []).map(r => sbToRow(r.parte)).filter(Boolean);
  return { ubicacion: ub, ubicacionOriginal: ubicacion, resultados, count: resultados.length, normalizado: ubicInfo.info };
}

// ── INVENTARIO / UBICACIONES ─────────────────────────────────
function obtenerEstadisticasDashboard() {
  const inv         = getCachedInventario();
  const conUbicacion = inv.filter(r => r['Ubicación Principal'] && r['Ubicación Principal'].trim());
  return {
    totalRepuestos:    inv.length,
    conUbicacion:      conUbicacion.length,
    sinUbicacion:      inv.length - conUbicacion.length,
    porcentajeUbicados: inv.length > 0 ? ((conUbicacion.length / inv.length)*100).toFixed(1) : '0'
  };
}

function obtenerRepuestosConUbicacion() {
  return getCachedInventario().filter(r => r['Ubicación Principal'] && r['Ubicación Principal'].trim());
}
function obtenerRepuesosSinUbicacion() {
  return getCachedInventario().filter(r => !r['Ubicación Principal'] || !r['Ubicación Principal'].trim());
}

function filtrarUbicaciones(filtros) {
  try {
    const sb = getSB();
    let q = 'select=id,codigo_ubicacion,zona,pasillo,anaquel,rack,nivel,estado&estado=eq.ACTIVO';
    if (filtros.zona)    q += '&zona=eq.'    + encodeURIComponent(filtros.zona);
    if (filtros.pasillo) q += '&pasillo=eq.' + encodeURIComponent(filtros.pasillo);
    if (filtros.anaquel) q += '&anaquel=eq.' + encodeURIComponent(filtros.anaquel);
    if (filtros.rack)    q += '&rack=eq.'    + encodeURIComponent(filtros.rack);
    if (filtros.nivel)   q += '&nivel=eq.'   + encodeURIComponent(filtros.nivel);
    q += '&order=codigo_ubicacion.asc&limit=500';

    const ubicRows = sb.get('ubicaciones', q) || [];
    const inv      = getCachedInventario();

    const resultados = ubicRows.map(u => {
      const codigos = inv.filter(item =>
        [item['Ubicación Principal'], item['Ubicación 2'], item['Ubicación 3'],
         item['Ubicación 4'], item['Ubicación 5']].includes(u.codigo_ubicacion)
      );
      return { Ubicacion: u.codigo_ubicacion, Zona: u.zona, Pasillo: u.pasillo, Anaquel: u.anaquel, Rack: u.rack, Nivel: u.nivel, Estado: u.estado || 'ACTIVO', codigos, cantidadCodigos: codigos.length };
    });
    return { success: true, resultados, count: resultados.length };
  } catch(e) { return { success: false, resultados: [], count: 0, message: e.toString() }; }
}

function crearNuevaUbicacion(datos) {
  try {
    if (!datos.zona || !datos.pasillo || !datos.anaquel || !datos.rack || !datos.nivel)
      return { success: false, message: 'Todos los campos son obligatorios' };

    const codigo = datos.zona + '-' + datos.pasillo + '-' + datos.anaquel + '-' + datos.rack + '-' + datos.nivel;
    const sb     = getSB();
    const existe = sb.getOne('ubicaciones', 'codigo_ubicacion=eq.' + encodeURIComponent(codigo));
    if (existe) return { success: false, message: 'La ubicación ' + codigo + ' ya existe' };

    sb.insert('ubicaciones', { codigo_ubicacion: codigo, zona: datos.zona, pasillo: datos.pasillo, anaquel: datos.anaquel, rack: datos.rack, nivel: datos.nivel, estado: 'ACTIVO' });
    clearCacheInventario();
    return { success: true, message: 'Ubicación ' + codigo + ' creada', ubicacion: codigo };
  } catch(e) { return { success: false, message: e.toString() }; }
}

function asignarUbicacionCodigo(codigo, ubicacion) {
  try {
    const cleanInfo  = cleanPartCode(codigo);
    const ubicInfo   = normalizarUbicacion(ubicacion);
    const cod        = cleanInfo.clean;
    const ub         = ubicInfo.normalized;
    const sb         = getSB();

    let parte = sb.getOne('partes', 'codigo=eq.' + encodeURIComponent(cod) + '&select=id');
    if (!parte) {
      const ins = sb.insert('partes', { codigo: cod, codigo_limpio: cod.replace(/[^A-Z0-9]/g,''), activo: true });
      parte = Array.isArray(ins) ? ins[0] : ins;
    }
    if (!parte) return { success: false, message: 'No se pudo crear la parte' };

    let ubic = sb.getOne('ubicaciones', 'codigo_ubicacion=eq.' + encodeURIComponent(ub) + '&select=id');
    if (!ubic) {
      const ins = sb.insert('ubicaciones', { codigo_ubicacion: ub, estado: 'ACTIVO' });
      ubic = Array.isArray(ins) ? ins[0] : ins;
    }
    if (!ubic) return { success: false, message: 'No se pudo crear la ubicación' };

    const existentes = sb.get('parte_ubicaciones', 'parte_id=eq.' + parte.id + '&select=orden,ubicaciones(codigo_ubicacion)') || [];
    const ordenes    = existentes.map(e => e.orden);

    // Verificar si ya tiene esta ubicación
    const yaAsignada = existentes.some(e => e.ubicaciones && e.ubicaciones.codigo_ubicacion === ub);
    if (yaAsignada) return { success: true, message: ub + ' ya estaba asignada a ' + cod, ubicacionNormalizada: ub };

    if (ordenes.length >= 5) return { success: false, message: 'El código ya tiene 5 ubicaciones', requiereConsolidacion: true, ubicaciones: existentes.map(e => e.ubicaciones ? e.ubicaciones.codigo_ubicacion : '') };

    const siguienteOrden = [1,2,3,4,5].find(n => !ordenes.includes(n));
    sb.insert('parte_ubicaciones', { parte_id: parte.id, ubicacion_id: ubic.id, orden: siguienteOrden, cantidad: 0 });
    clearCacheInventario();
    return { success: true, message: 'Ubicación ' + ub + ' asignada a ' + cod, campo: 'Ubicación ' + siguienteOrden, ubicacionNormalizada: ub };
  } catch(e) { return { success: false, message: e.toString() }; }
}

function asignarUbicacionItem(codigo, ubicacion) { return asignarUbicacionCodigo(codigo, ubicacion); }

function verificarSiIntrusoEsValido(ubicacion, codigo) {
  try {
    const sb   = getSB();
    const part = sb.getOne('partes', 'codigo=eq.' + encodeURIComponent(codigo.toUpperCase()) + '&select=id');
    const ubic = sb.getOne('ubicaciones', 'codigo_ubicacion=eq.' + encodeURIComponent(ubicacion.toUpperCase()) + '&select=id');
    if (!part || !ubic) return { esValidado: false };
    const rel = sb.getOne('parte_ubicaciones', 'parte_id=eq.' + part.id + '&ubicacion_id=eq.' + ubic.id);
    return { esValidado: !!rel };
  } catch(e) { return { esValidado: false }; }
}

function validarIntruso(ubicacion, codigo, accion, email) {
  try {
    if (accion === 'AGREGAR_A_UBICACION') return asignarUbicacionCodigo(codigo, ubicacion);
    if (accion === 'MARCAR_VALIDO') return { success: true, message: codigo + ' marcado como válido en ' + ubicacion };
    return { success: true, message: codigo + ' ignorado' };
  } catch(e) { return { success: false, message: e.toString() }; }
}

function guardarEdicionEnSheet(codigo, datos) {
  try {
    const sb  = getSB();
    const upd = {};
    if (datos.descripcion !== undefined) upd.descripcion = datos.descripcion;
    if (datos.marca !== undefined) {
      const m = sb.getOne('marcas', 'nombre=ilike.' + encodeURIComponent(datos.marca) + '&select=id');
      if (m) upd.marca_id = m.id;
    }
    sb.update('partes', 'codigo=eq.' + encodeURIComponent(codigo.toUpperCase()), upd);
    clearCacheInventario();
    return { success: true, message: 'Parte ' + codigo + ' actualizada' };
  } catch(e) { return { success: false, message: e.toString() }; }
}

function agregarNuevoItem(datos) {
  try {
    const cod = cleanPartCode(datos.codigo).clean;
    getSB().insert('partes', { codigo: cod, codigo_limpio: cod.replace(/[^A-Z0-9]/g,''), descripcion: datos.descripcion || null, activo: true });
    clearCacheInventario();
    return { success: true, message: 'Parte ' + cod + ' agregada' };
  } catch(e) { return { success: false, message: e.toString() }; }
}

function eliminarItem(codigo, motivo) {
  try {
    getSB().update('partes', 'codigo=eq.' + encodeURIComponent(codigo.toUpperCase()), { activo: false });
    clearCacheInventario();
    return { success: true, message: codigo + ' desactivado. Motivo: ' + motivo };
  } catch(e) { return { success: false, message: e.toString() }; }
}

function eliminarUbicacionEspecifica(codigo, ubicacionAEliminar) {
  try {
    const sb   = getSB();
    const part = sb.getOne('partes', 'codigo=eq.' + encodeURIComponent(codigo.toUpperCase()) + '&select=id');
    const ubic = sb.getOne('ubicaciones', 'codigo_ubicacion=eq.' + encodeURIComponent(ubicacionAEliminar.toUpperCase()) + '&select=id');
    if (!part || !ubic) return { exito: false, mensaje: 'No encontrado' };
    sb.del('parte_ubicaciones', 'parte_id=eq.' + part.id + '&ubicacion_id=eq.' + ubic.id);
    clearCacheInventario();
    return { exito: true, mensaje: 'Ubicación ' + ubicacionAEliminar + ' eliminada de ' + codigo };
  } catch(e) { return { exito: false, mensaje: e.toString() }; }
}

// ── VERIFICACIÓN ─────────────────────────────────────────────
function guardarVerificacion(datos) {
  try {
    const session = getSessionUser(datos.sessionId);
    if (!session.success) return { success: false, message: 'Sesión inválida' };

    const ubicacion         = (datos.ubicacion || '').toUpperCase();
    const codigosEsperados  = datos.codigosEsperados || [];
    const codigosEncontrados= datos.codigosEncontrados || [];
    const validados         = codigosEncontrados.filter(c => codigosEsperados.includes(c));
    const intrusos          = codigosEncontrados.filter(c => !codigosEsperados.includes(c));
    const ausentes          = codigosEsperados.filter(c => !codigosEncontrados.includes(c));
    const tasaExito         = codigosEsperados.length > 0 ? ((validados.length / codigosEsperados.length)*100).toFixed(2) : '100.00';
    const idVer             = 'VER-' + Utilities.formatDate(new Date(),'GMT-5','yyyyMMdd-HHmmss');
    const timestamp         = new Date().toLocaleString('es-PA');

    const sb    = getSB();
    const ubicRow = sb.getOne('ubicaciones', 'codigo_ubicacion=eq.' + encodeURIComponent(ubicacion) + '&select=id');

    // Guardar verificación
    const verIns = sb.insert('verificaciones', {
      ubicacion, ubicacion_id: ubicRow ? ubicRow.id : null,
      usuario_id: null, // session es GAS, no Supabase
      tasa_exito: parseFloat(tasaExito),
      total_esperados: codigosEsperados.length, total_validados: validados.length,
      total_intrusos: intrusos.length, total_ausentes: ausentes.length
    });
    const verId = Array.isArray(verIns) && verIns[0] ? verIns[0].id : null;

    if (verId) {
      const detalles = [
        ...validados.map(c => ({ verificacion_id: verId, codigo: c, resultado: 'VALIDO' })),
        ...intrusos.map(c  => ({ verificacion_id: verId, codigo: c, resultado: 'INTRUSO' })),
        ...ausentes.map(c  => ({ verificacion_id: verId, codigo: c, resultado: 'AUSENTE' }))
      ];
      if (detalles.length > 0) sb.insert('verificacion_detalles', detalles);
    }

    // Eliminar ubicación de ausentes
    ausentes.forEach(cod => eliminarUbicacionEspecifica(cod, ubicacion));

    // Generar PDF y enviar email
    let urlReporte = '';
    try {
      const carpetas = obtenerCarpetaReportes('Verificaciones', idVer);
      if (carpetas.success) {
        const datosHTML = { id: idVer, ubicacion, validados: validados.length, intrusos, ausentes, tasaExito: parseFloat(tasaExito), usuario: session.user.email, codigosEsperados, codigosEncontrados, fecha: timestamp };
        urlReporte = generarReporteVerificacionPDF(datosHTML, carpetas.carpetaReporte);
      }
    } catch(pdfErr) { Logger.log('PDF ver error: ' + pdfErr); }

    let emailEnviado = false;
    try {
      const emailMgr = new EmailManagerRobusto();
      const html     = generarHTMLVerificacionIndividual({ id: idVer, ubicacion, validados: validados.length, intrusos, ausentes, tasaExito: parseFloat(tasaExito), usuario: session.user.email, fecha: timestamp, codigosEsperados, codigosEncontrados });
      const res      = emailMgr.enviarReporte('DIARIO', { id: idVer, fechaGeneracion: timestamp }, '✅ Verificación: ' + ubicacion + ' (' + tasaExito + '% éxito)', html);
      emailEnviado   = res.enviados > 0;
    } catch(eErr) { Logger.log('Email ver error: ' + eErr); }

    return { success: true, message: 'Verificación guardada', idVerificacion: idVer, urlReporte, emailEnviado, metricas: { validados: validados.length, intrusos: intrusos.length, ausentes: ausentes.length, tasaExito }, ausentesProcesados: ausentes.length };
  } catch(e) { Logger.log('Error guardarVerificacion: ' + e); return { success: false, message: e.toString() }; }
}

// ── RECEPCIÓN ─────────────────────────────────────────────────
function guardarRecepcion(datos) {
  try {
    const session = getSessionUser(datos.sessionId);
    if (!session.success) return { success: false, message: 'Sesión inválida' };

    const idRec   = 'REC-' + Utilities.formatDate(new Date(),'GMT-5','yyyyMMdd-HHmmss');
    const ts      = new Date().toLocaleString('es-PA');
    const sb      = getSB();
    const recIns  = sb.insert('recepciones', { id_recepcion: idRec, factura: datos.factura, proveedor: datos.proveedor || null, estado: 'COMPLETADO', completed_at: new Date().toISOString() });
    const recId   = Array.isArray(recIns) && recIns[0] ? recIns[0].id : null;

    const items = datos.items || [];
    if (recId && items.length > 0) {
      const detalles = items.map(item => ({
        recepcion_id: recId, codigo: cleanPartCode(item.codigo).clean,
        cantidad: parseInt(item.cantidad) || 1, descripcion: item.descripcion || null,
        ubicacion: item.ubicacion || null
      }));
      sb.insert('detalles_recepcion', detalles);
    }

    let urlReporte = '';
    try {
      const carpetas = obtenerCarpetaReportes('Recepciones', idRec);
      if (carpetas.success) {
        urlReporte = generarReporteRecepcionPDF({ id: idRec, factura: datos.factura, items, fecha: ts, usuario: session.user.email }, carpetas.carpetaReporte);
      }
    } catch(e) { Logger.log('PDF rec error: ' + e); }

    try {
      const emailMgr = new EmailManagerRobusto();
      const html     = generarHTMLRecepcionCompleto(idRec, datos.factura, items, ts);
      emailMgr.enviarReporte('RECEPCION', { id: idRec, fechaGeneracion: ts }, '📦 Recepción ' + datos.factura, html);
    } catch(e) { Logger.log('Email rec error: ' + e); }

    return { success: true, message: 'Recepción guardada', idRecepcion: idRec, urlReporte, totalItems: items.length, hayItemsSinUbicacion: items.some(i => !i.ubicacion) };
  } catch(e) { return { success: false, message: e.toString() }; }
}

// ── DESPACHO ──────────────────────────────────────────────────
function validarItemsContraInventario(items) {
  try {
    const sb = getSB();
    const validados = (items || []).map(item => {
      const cod  = cleanPartCode(item.codigo).clean;
      const enc  = encodeURIComponent(cod);
      const rows = sb.get('partes', 'codigo=eq.' + enc + '&select=codigo,descripcion,gemini_descripcion,marcas(nombre),parte_ubicaciones(orden,ubicaciones(codigo_ubicacion))&activo=eq.true');
      const parte = rows && rows[0] ? sbToRow(rows[0]) : null;
      const ubics = parte ? [parte['Ubicación Principal'], parte['Ubicación 2'], parte['Ubicación 3'], parte['Ubicación 4'], parte['Ubicación 5']].filter(Boolean) : [];
      return { ...item, codigo: cod, codigoLimpio: cod, descripcionInventario: parte ? parte['Descripción'] : '', marca: parte ? parte['Marca'] : '', ubicaciones: ubics, ubicacionPrincipal: ubics[0] || '', encontrado: !!parte, recogido: false, enInventario: !!parte };
    });
    const encontrados    = validados.filter(i => i.encontrado).length;
    const noEncontrados  = validados.length - encontrados;
    return { success: true, items: validados, resumen: { total: validados.length, encontrados, noEncontrados } };
  } catch(e) { return { success: false, items: [], error: e.toString() }; }
}
function validarItemsDespacho(items) { return validarItemsContraInventario(items); }

function guardarDespacho(datos) {
  try {
    const session = getSessionUser(datos.sessionId);
    if (!session.success) return { success: false, error: 'Sesión inválida' };

    const id  = 'DESP-' + Utilities.formatDate(new Date(),'GMT-5','yyyyMMdd-HHmmss');
    const sb  = getSB();
    const ins = sb.insert('despachos', { id_despacho: id, cliente: datos.cliente || null, orden_ref: datos.po || datos.ordenRef || null, estado: 'COMPLETADO', completed_at: new Date().toISOString() });
    const despId = Array.isArray(ins) && ins[0] ? ins[0].id : null;

    const items = datos.items || [];
    if (despId && items.length > 0) {
      const det = items.map(item => ({
        despacho_id: despId, codigo: cleanPartCode(item.codigo).clean,
        cantidad: parseInt(item.cantidad) || 1, descripcion: item.descripcionInventario || item.descripcionOrden || null,
        ubicacion: item.ubicacionPrincipal || null, encontrado: !!item.encontrado, recogido: !!item.recogido
      }));
      sb.insert('detalles_despacho', det);
    }
    return { success: true, id, message: 'Despacho guardado' };
  } catch(e) { return { success: false, error: e.toString() }; }
}

// ── AUDITORÍA ─────────────────────────────────────────────────
function guardarAuditoriaCompleta(datos) {
  try {
    const session = getSessionUser(datos.sessionId);
    if (!session.success) return { success: false, message: 'Sesión inválida' };

    const cleanInfo  = cleanPartCode(datos.codigo);
    const idAud      = 'AUD-' + Utilities.formatDate(new Date(),'GMT-5','yyyyMMdd-HHmmss');
    const ts         = new Date().toLocaleString('es-PA');
    const inv        = getCachedInventario();
    const itemInv    = inv.find(i => i['Código'] === cleanInfo.clean);
    const descripcion = itemInv ? itemInv['Descripción'] : 'No en inventario';
    const marca       = itemInv ? itemInv['Marca']       : 'Desconocida';
    const ubicacion   = itemInv ? itemInv['Ubicación Principal'] : 'Sin ubicación';

    // Subir fotos a Drive
    let fotosUrls = [];
    const carpetas = obtenerCarpetaReportes('Auditorias', idAud);
    if (datos.fotos && datos.fotos.length > 0 && carpetas.success) {
      datos.fotos.forEach((foto, i) => {
        try {
          const b64 = foto.includes(',') ? foto.split(',')[1] : foto;
          const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', idAud + '_foto' + (i+1) + '.jpg');
          const file = carpetas.carpetaReporte.createFile(blob);
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          fotosUrls.push(file.getUrl());
        } catch(fe) { Logger.log('Foto error: ' + fe); }
      });
    }

    const datosComp = { id: idAud, codigo: cleanInfo.clean, descripcion, marca, ubicacion, estado: datos.estado, cantidad: datos.cantidad || 'N/A', notas: datos.notas || '', usuario: session.user.email, fecha: ts, fotos: fotosUrls.map((u,i) => ({ url: u, nombre: idAud+'_foto'+(i+1)+'.jpg' })), carpetaDrive: carpetas.success ? carpetas.rutaCompleta : '' };

    let urlReporte = '';
    if (carpetas.success) {
      try { urlReporte = generarReporteAuditoriaPDF(datosComp, carpetas.carpetaReporte); } catch(e) {}
    }

    getSB().insert('auditorias', { id_auditoria: idAud, tipo: datos.estado || 'AUDITORIA', descripcion: cleanInfo.clean, datos: { codigo: cleanInfo.clean, cantidad: datos.cantidad, notas: datos.notas, estado: datos.estado, fotos: fotosUrls }, pdf_url: urlReporte });

    let emailEnviado = false;
    try {
      const emailMgr = new EmailManagerRobusto();
      const html     = generarHTMLAuditoria(datosComp);
      const res      = emailMgr.enviarReporte('DIARIO', { id: idAud, fechaGeneracion: ts }, '🔍 Auditoría: ' + cleanInfo.clean + ' - ' + datos.estado, html);
      emailEnviado   = res.enviados > 0;
    } catch(e) { Logger.log('Email aud error: ' + e); }

    return { success: true, message: 'Auditoría guardada', idAuditoria: idAud, urlReporte, emailEnviado, fotos: fotosUrls.length };
  } catch(e) { Logger.log('Error guardarAuditoriaCompleta: ' + e); return { success: false, message: e.toString() }; }
}

// ── CONTEO FÍSICO — LOTES ────────────────────────────────────
function guardarLotePreliminar(datos) {
  try {
    const session = getSessionUser(datos.sessionId);
    if (!session.success) return { success: false, message: 'Sesión inválida' };

    const sb       = getSB();
    const isUpdate = !!datos.loteID;
    const loteID   = isUpdate ? datos.loteID : 'LOTE-' + Utilities.formatDate(new Date(),'GMT-5','yyyyMMdd-HHmmss') + '-' + cleanPartCode(datos.codigo).clean;
    const ts       = new Date().toLocaleString('es-PA');

    // Subir fotos
    let fotosUrls = [];
    if (datos.fotos && datos.fotos.length > 0) {
      datos.fotos.forEach((foto, i) => {
        try {
          const res = guardarEvidenciaDrive(foto, loteID + '_img_' + (i+1));
          if (res.success) fotosUrls.push(res.url);
        } catch(e) {}
      });
    }

    const row = { lote_id: loteID, codigo: cleanPartCode(datos.codigo).clean, descripcion: datos.descripcion || '', marca: datos.marca || '', ubicacion: datos.ubicacion || '', cant_sistema: parseInt(datos.cantSistema)||0, cant_fisica: parseInt(datos.cantFisica)||0, defectuoso: parseInt(datos.defectuoso)||0, fotos_urls: fotosUrls.join(', '), estado: 'ABIERTO', usuario_email: session.user.email };

    if (isUpdate) {
      sb.update('conteo_lotes', 'lote_id=eq.' + encodeURIComponent(loteID), { ubicacion: datos.ubicacion || '', cant_sistema: row.cant_sistema, cant_fisica: row.cant_fisica, defectuoso: row.defectuoso, fotos_urls: row.fotos_urls, updated_at: new Date().toISOString() });
      return { success: true, message: 'Lote actualizado', loteID };
    }
    sb.insert('conteo_lotes', row);
    return { success: true, message: 'Lote guardado', loteID };
  } catch(e) { return { success: false, message: e.toString() }; }
}

function obtenerLotesProvisionales() {
  try {
    const session = getSessionUser(arguments[0]);
    const email   = session.success ? session.user.email : null;
    const sb      = getSB();
    let q = 'estado=eq.ABIERTO&order=created_at.desc&limit=50&select=lote_id,codigo,descripcion,marca,ubicacion,cant_sistema,cant_fisica,defectuoso,faltante,sobrante,fotos_urls,usuario_email,created_at';
    if (email) q += '&usuario_email=eq.' + encodeURIComponent(email);
    const rows = sb.get('conteo_lotes', q) || [];
    return { success: true, lotes: rows };
  } catch(e) { return { success: true, lotes: [] }; }
}

function cerrarLoteConteoFisico(sessionId, loteID) {
  try {
    getSB().update('conteo_lotes', 'lote_id=eq.' + encodeURIComponent(loteID), { estado: 'CERRADO', fecha_cierre: new Date().toLocaleString('es-PA'), updated_at: new Date().toISOString() });
    return { success: true, message: 'Lote cerrado' };
  } catch(e) { return { success: false, message: e.toString() }; }
}

function enviarReporteLotes(sessionId) {
  try {
    const session = getSessionUser(sessionId);
    if (!session.success) return { success: false };
    const sb   = getSB();
    const rows = sb.get('conteo_lotes', 'usuario_email=eq.' + encodeURIComponent(session.user.email) + '&estado=eq.ABIERTO') || [];
    if (rows.length === 0) return { success: true, message: 'Sin lotes para reportar' };
    const emailMgr = new EmailManagerRobusto();
    const html = generarHTMLConteoFisico({ lotes: rows, usuario: session.user.email, fecha: new Date().toLocaleString('es-PA') });
    emailMgr.enviarReporte('CONTEO_FISICO', { id: 'RPT-' + Date.now(), fechaGeneracion: new Date().toLocaleString('es-PA') }, '📊 Reporte Lotes Conteo Físico', html);
    return { success: true };
  } catch(e) { return { success: false, message: e.toString() }; }
}

// ── CONTEO REFERENCIA ────────────────────────────────────────
function buscarCodigoConteoFisico(codigo) { return buscarCodigo(codigo); }
function buscarCodigoConteoReferencia(codigo) { return buscarCodigo(codigo); }

function guardarConteoReferencia(datos) {
  try {
    const session = getSessionUser(datos.sessionId);
    if (!session.success) return { success: false, message: 'Sesión inválida' };
    const referencias = datos.referencias || [];
    if (referencias.length === 0) return { success: false, message: 'Sin referencias' };

    const idConteo = 'CR-' + Utilities.formatDate(new Date(),'GMT-5','yyyyMMdd-HHmmss');
    const ts       = new Date().toLocaleString('es-PA');
    const sb       = getSB();

    const filas = [];
    referencias.forEach(ref => {
      const cod = cleanPartCode(ref.codigo).clean;
      if (ref.ubicaciones && ref.ubicaciones.length > 0) {
        ref.ubicaciones.forEach(u => filas.push({ id_conteo: idConteo, codigo: cod, descripcion: ref.descripcion || '', marca: ref.marca || '', ubicacion: u.ubicacion, cantidad_fisica: u.cantidadFisica || 0, total_fisico: ref.totalFisico || 0, usuario_email: session.user.email }));
      } else {
        filas.push({ id_conteo: idConteo, codigo: cod, descripcion: ref.descripcion || '', marca: ref.marca || '', ubicacion: 'SIN UBICACIÓN', cantidad_fisica: 0, total_fisico: ref.totalFisico || 0, usuario_email: session.user.email });
      }
    });
    if (filas.length > 0) sb.insert('conteo_referencia', filas);

    // Actualizar updated_at en partes (equivale a "Último Inventario")
    referencias.forEach(ref => {
      const cod = cleanPartCode(ref.codigo).clean;
      sb.update('partes', 'codigo=eq.' + encodeURIComponent(cod), { updated_at: new Date().toISOString() });
    });
    clearCacheInventario();

    const totalGlobal = referencias.reduce((s, r) => s + (r.totalFisico || 0), 0);
    let emailEnviado = false;
    try {
      const emailMgr = new EmailManagerRobusto();
      const html = generarHTMLConteoFisico({ referencias, idConteo, fecha: ts, usuario: session.user.email });
      const res  = emailMgr.enviarReporte('CONTEO_REFERENCIA', { id: idConteo, fechaGeneracion: ts }, '📋 Conteo Referencia: ' + referencias.length + ' código(s) · ' + totalGlobal + ' uds', html);
      emailEnviado = res.enviados > 0;
    } catch(e) { Logger.log('Email conteo ref: ' + e); }

    return { success: true, idConteo, emailEnviado, metricas: { totalReferencias: referencias.length, totalUnidades: totalGlobal } };
  } catch(e) { Logger.log('Error guardarConteoReferencia: ' + e); return { success: false, message: e.toString() }; }
}

// ── GEMINI AI ─────────────────────────────────────────────────
function obtenerAPIKeyGemini() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key || key.trim() === '') throw new Error('GEMINI_API_KEY no configurada en Properties Service');
  return key.trim();
}

function obtenerDescripcionConGemini(codigo, marca) {
  try {
    const cleanInfo = cleanPartCode(codigo);
    const cod       = cleanInfo.clean;
    // Check cache in Supabase first
    const sb    = getSB();
    const parte = sb.getOne('partes', 'codigo=eq.' + encodeURIComponent(cod) + '&select=gemini_descripcion,gemini_cached_at');
    if (parte && parte.gemini_descripcion && parte.gemini_cached_at) {
      const hrs = (Date.now() - new Date(parte.gemini_cached_at).getTime()) / 3600000;
      if (hrs < GEMINI_CONFIG.CACHE_DURATION_HOURS) return { success: true, descripcion: parte.gemini_descripcion, fuente: 'cache', codigo: cod, marca };
    }
    const resultado = consultarGeminiParaPieza(cod, marca || '');
    if (resultado && resultado.esRepuesto) {
      // Guardar en cache
      sb.upsert('partes', { codigo: cod, codigo_limpio: cod.replace(/[^A-Z0-9]/g,''), gemini_descripcion: resultado.descripcion, gemini_cached_at: new Date().toISOString(), activo: true }, 'codigo');
      clearCacheInventario();
      return { success: true, descripcion: resultado.descripcion, fuente: 'gemini', codigo: cod, marca };
    }
    return { success: false, message: 'No es repuesto de moto/marino', codigo: cod };
  } catch(e) { return { success: false, message: e.toString() }; }
}

function consultarGeminiParaPieza(codigo, marca) {
  try {
    const apiKey = obtenerAPIKeyGemini();
    const prompt = `Eres un EXPERTO EXCLUSIVO en repuestos de MOTOCICLETAS y MOTORES FUERA DE BORDA.
Código a identificar: "${codigo}"${marca ? ' Marca: ' + marca : ''}

Responde en JSON con este formato exacto:
{"esRepuesto": true/false, "descripcion": "descripción corta en español (máximo 8 palabras)", "marca": "marca del repuesto"}

Si NO es repuesto de moto o motor marino: {"esRepuesto": false, "descripcion": ""}
PROHIBIDO mencionar autos, camiones, vehículos de 4 ruedas.`;

    const url = GEMINI_CONFIG.API_ENDPOINT + '/' + GEMINI_CONFIG.MODEL + ':generateContent?key=' + apiKey;
    const res = UrlFetchApp.fetch(url, {
      method: 'POST', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 200, temperature: GEMINI_CONFIG.TEMPERATURE } })
    });
    const json  = JSON.parse(res.getContentText());
    const texto = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    const match = texto.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch(e) { Logger.log('Gemini error: ' + e); return null; }
}

function procesarImagenOrden(imagenBase64) {
  try {
    if (!imagenBase64 || imagenBase64.length < 50)
      return { success: false, error: 'Imagen no recibida', items: [] };

    const apiKey = obtenerAPIKeyGemini();
    const b64    = imagenBase64.includes(',') ? imagenBase64.split(',')[1] : imagenBase64;
    const mime   = imagenBase64.startsWith('data:') ? imagenBase64.split(';')[0].replace('data:','') : 'image/jpeg';

    const prompt =
      'Eres un asistente de almacen de repuestos de motos. ' +
      'Mira esta imagen y extrae TODOS los codigos de repuesto que veas (columna Codigo o similar). ' +
      'Si no hay cantidad visible, usa 1. ' +
      'Responde SOLO con este JSON sin ningun texto adicional ni markdown: ' +
      '{"items":[{"codigo":"18210-93002-000","cantidad":1},{"codigo":"18191-94410-000","cantidad":1}]} ' +
      'Extrae TODOS los codigos visibles aunque sean muchos. ' +
      'Si no ves ningun codigo responde exactamente: {"items":[]}';

    const url = GEMINI_CONFIG.API_ENDPOINT + '/' + GEMINI_CONFIG.MODEL + ':generateContent?key=' + apiKey;
    const res = UrlFetchApp.fetch(url, {
      method: 'POST', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }],
        generationConfig: { maxOutputTokens: 1024, temperature: 0 }
      })
    });

    const code = res.getResponseCode();
    if (code !== 200) return { success: false, error: 'Error Gemini ' + code, items: [] };

    const json  = JSON.parse(res.getContentText());
    const texto = (json.candidates && json.candidates[0] &&
                   json.candidates[0].content && json.candidates[0].content.parts &&
                   json.candidates[0].content.parts[0].text) || '';

    Logger.log('Gemini OCR respuesta: ' + texto.substring(0, 300));

    if (!texto || texto.trim() === '') return { success: true, items: [] };

    // Limpiar markdown si Gemini lo incluyó
    const sinMarkdown = texto.replace(/```json/g,'').replace(/```/g,'').trim();

    // Buscar bloque JSON
    const match = sinMarkdown.match(/\{[\s\S]*"items"[\s\S]*\}/);
    if (!match) {
      Logger.log('No se encontro bloque JSON en: ' + sinMarkdown.substring(0,200));
      return { success: true, items: [] };
    }

    const limpio = match[0].replace(/[\r\n\t]/g,' ').replace(/,\s*\}/g,'}').replace(/,\s*\]/g,']');
    let result;
    try { result = JSON.parse(limpio); }
    catch(pe) {
      Logger.log('Error parseando JSON: ' + limpio.substring(0,200));
      return { success: true, items: [] };
    }

    const items = (result.items || []).map(function(i) {
      return { codigo: String(i.codigo || '').trim().toUpperCase(), cantidad: parseInt(i.cantidad) || 1 };
    }).filter(function(i) { return i.codigo.length >= 4; });

    Logger.log('Items extraidos: ' + items.length);
    return { success: true, items: items };

  } catch(e) {
    // Devolver mensaje genérico — nunca incluir el error original que puede romper JSON
    return { success: false, error: 'Error al procesar imagen. Usa entrada manual.', items: [] };
  }
}

// ── EMAIL MANAGER (lee destinatarios de Supabase) ─────────────
class EmailManagerRobusto {
  obtenerDestinatarios(tipo) {
    try {
      const sb   = getSB();
      let q = 'activo=eq.true&select=email,nombre,tipo_reporte';
      const rows = sb.get('config_emails', q) || [];
      return rows.filter(r => r.tipo_reporte === tipo || r.tipo_reporte === 'TODOS').filter((r, i, arr) => arr.findIndex(x => x.email === r.email) === i);
    } catch(e) { return []; }
  }

  enviarReporte(tipo, reporte, titulo, htmlContenido) {
    const destinatarios = this.obtenerDestinatarios(tipo);
    if (destinatarios.length === 0) return { success: false, enviados: 0, fallidos: 0, mensaje: 'Sin destinatarios para ' + tipo };
    const asunto = 'PartFinder - ' + titulo;
    let enviados = 0, fallidos = 0;
    let adjuntos = [];
    try {
      const blob = Utilities.newBlob(htmlContenido, MimeType.HTML).getAs(MimeType.PDF);
      blob.setName('Reporte_' + tipo + '_' + (reporte.id || Date.now()) + '.pdf');
      adjuntos.push(blob);
    } catch(e) { Logger.log('PDF adj error: ' + e); }

    destinatarios.forEach(dest => {
      try {
        GmailApp.sendEmail(dest.email, asunto, 'Ver reporte adjunto.', { htmlBody: htmlContenido, name: 'PartFinder SukiMotor', attachments: adjuntos });
        enviados++;
      } catch(e) { Logger.log('Email fail ' + dest.email + ': ' + e); fallidos++; }
    });
    return { success: fallidos === 0, enviados, fallidos };
  }
}

// ── DRIVE / PDF (sin cambios respecto al original) ─────────────
function obtenerCarpetaReportes(tipo, id) {
  try {
    const raiz = CONFIG.DRIVE_FOLDER_ID ? DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID) : DriveApp.getRootFolder();
    let carpetaTipo;
    try { carpetaTipo = raiz.getFoldersByName(tipo).next(); }
    catch(e) { carpetaTipo = raiz.createFolder(tipo); }
    let carpetaReporte;
    try { carpetaReporte = carpetaTipo.getFoldersByName(id).next(); }
    catch(e) { carpetaReporte = carpetaTipo.createFolder(id); }
    const ruta = tipo + '/' + id;
    return { success: true, carpetaReporte, rutaCompleta: ruta };
  } catch(e) { return { success: false, mensaje: e.toString() }; }
}

function guardarEvidenciaDrive(base64Data, nombre) {
  try {
    const b64  = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', nombre + '.jpg');
    const carpeta = CONFIG.DRIVE_FOLDER_ID ? DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID) : DriveApp.getRootFolder();
    const file    = carpeta.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { success: true, url: file.getUrl(), id: file.getId() };
  } catch(e) { return { success: false, error: e.toString() }; }
}

// ── PROCESAMIENTO DE CÓDIGOS (sin cambios respecto al original) ─

function cleanPartCode(qrData) {
  if (!qrData || typeof qrData !== 'string') return { clean: "", isValid: false, info: "Entrada inválida" };
  let codigo = qrData.trim();
  codigo = codigo.replace(/'/g, '-');
  if (codigo.includes(',')) {
    const partes = codigo.split(',');
    for (let parte of partes) { parte = parte.trim(); if (parte.length >= 12 && parte.length <= 15 && /^[A-Z0-9\-]{12,15}$/.test(parte.toUpperCase())) { codigo = parte.toUpperCase(); break; } }
    if (codigo.includes(',')) { for (let parte of partes) { parte = parte.trim(); if (parte && /^[A-Z0-9\-]{5,17}$/.test(parte.toUpperCase())) { codigo = parte.toUpperCase(); break; } } }
  }
  if (codigo.includes('[')) codigo = codigo.split('[')[0].trim();
  codigo = codigo.toUpperCase().replace(/\s+/g, '');
  const pSYM17 = /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{2}$/;
  const pSYM14 = /^[A-Z0-9]{5}-[A-Z0-9]{3}-[A-Z0-9]{4}-[A-Z0-9]{2}$/;
  const pSYM533= /^[A-Z0-9]{5}-[A-Z0-9]{3}-[A-Z0-9]{3}$/;
  const pSYM5332=/^[A-Z0-9]{5}-[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{2}$/;
  const pSYM43412=/^[A-Z0-9]{4}-[A-Z0-9]{3}-[A-Z0-9]{4}-[A-Z0-9]{1}-[A-Z0-9]{2}$/;
  if (pSYM17.test(codigo)||pSYM14.test(codigo)||pSYM533.test(codigo)||pSYM5332.test(codigo)||pSYM43412.test(codigo)) {
    let rev = false; if (codigo.length > 20) { codigo = codigo.substring(0,20); rev = true; }
    return { clean: codigo, isValid: true, isSYM: true, manualReview: rev, info: rev ? "SYM truncado" : "SYM válido" };
  }
  codigo = codigo.replace(/[^A-Z0-9\-]/g,'').replace(/\-+/g,'-').replace(/^-+|-+$/g,'');
  let rev = false; if (codigo.length > 15) { codigo = codigo.substring(0,15); rev = true; }
  if (codigo.length < 5) return { clean: codigo, isValid: false, manualReview: true, info: "Código muy corto" };
  return { clean: codigo, isValid: true, isSYM: false, manualReview: rev, info: rev ? "Truncado a 15 chars" : "OK" };
}

function agregarGuionesSYM(codigo) {
  if (codigo.length === 17) { const f = `${codigo.substring(0,5)}-${codigo.substring(5,10)}-${codigo.substring(10,15)}-${codigo.substring(15,17)}`; if (/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{2}$/.test(f)) return { esSYM: true, codigo: f }; }
  if (codigo.length === 14) { const f = `${codigo.substring(0,5)}-${codigo.substring(5,8)}-${codigo.substring(8,12)}-${codigo.substring(12,14)}`; if (/^[A-Z0-9]{5}-[A-Z0-9]{3}-[A-Z0-9]{4}-[A-Z0-9]{2}$/.test(f)) return { esSYM: true, codigo: f }; }
  return { esSYM: false, codigo: codigo };
}

function normalizarUbicacion(ubicacionRaw) {
  if (!ubicacionRaw || typeof ubicacionRaw !== 'string') return { normalized: "", isValid: false, info: "Entrada inválida" };
  let u = ubicacionRaw.trim().toUpperCase().replace(/'/g,'-');
  const mG = u.match(/^([A-Z])-(\d+)-([A-Z])-(\d+)-([A-Z])$/);
  if (mG) { const rack = mG[4].padStart(2,'0'); return { normalized: `${mG[1]}-${mG[2]}-${mG[3]}-${rack}-${mG[5]}`, isValid: true, info: "Formato correcto", partes: { zona:mG[1], pasillo:mG[2], anaquel:mG[3], rack, nivel:mG[5] } }; }
  const clean = u.replace(/[-\s]/g,'');
  const mS = clean.match(/^([A-Z])(\d+)([A-Z])(\d+)([A-Z])$/);
  if (mS) { const rack = mS[4].padStart(2,'0'); const norm = `${mS[1]}-${mS[2]}-${mS[3]}-${rack}-${mS[5]}`; return { normalized: norm, isValid: true, info: "Normalizado", partes: { zona:mS[1], pasillo:mS[2], anaquel:mS[3], rack, nivel:mS[5] } }; }
  return { normalized: u, isValid: false, info: "Formato no reconocido. Use: B1A01F o B-1-A-01-F", partes: null };
}

function normalizarUbicacionSimple(ubicacionRaw) { return normalizarUbicacion(ubicacionRaw).normalized; }

// ── HTML / PDF GENERATORS (sin cambios respecto al original) ────

function generarHTMLVerificacionIndividual(datos) {
  try {
    const ubicacion = datos.ubicacion || "Sin ubicación";
    const validados = Number(datos.validados) || 0;
    const intrusos = Array.isArray(datos.intrusos) ? datos.intrusos : [];
    const ausentes = Array.isArray(datos.ausentes) ? datos.ausentes : [];
    const tasaExito = Number(datos.tasaExito) || 0;
    const usuario = datos.usuario || "Usuario desconocido";
    const fecha = datos.fecha || new Date().toLocaleString("es-PA");
    const codigosEsperados = Array.isArray(datos.codigosEsperados) ? datos.codigosEsperados : [];
    const codigosEncontrados = Array.isArray(datos.codigosEncontrados) ? datos.codigosEncontrados : [];
    const estadoColor = tasaExito >= 95 ? '#28a745' : tasaExito >= 85 ? '#ffc107' : '#dc3545';
    const estadoIcono = tasaExito >= 95 ? '✅' : tasaExito >= 85 ? '⚠️' : '❌';
    const codigosValidados = codigosEncontrados.filter(c => codigosEsperados.includes(c));
    const validadosHTML = codigosValidados.length > 0 ? `<div style="margin-top:20px;"><h4 style="color:#28a745;">✅ Códigos Validados (${codigosValidados.length})</h4><div style="background:#f0fff4;padding:15px;border-radius:8px;border-left:4px solid #28a745;">${codigosValidados.slice(0,20).map(c=>`<span style="display:inline-block;background:#e8f5e9;padding:6px 12px;margin:4px;border-radius:5px;font-size:13px;font-weight:600;">${c}</span>`).join('')}${codigosValidados.length>20?`<p style="color:#666;font-size:13px;font-style:italic;">... y ${codigosValidados.length-20} más</p>`:''}</div></div>` : '';
    const intrusosHTML = intrusos.length > 0 ? `<div style="margin-top:20px;"><h4 style="color:#dc3545;">🚨 Intrusos Detectados (${intrusos.length})</h4><div style="background:#fff5f5;padding:15px;border-radius:8px;border-left:4px solid #dc3545;">${intrusos.map(i=>`<span style="display:inline-block;background:#fff3cd;padding:6px 12px;margin:4px;border-radius:5px;font-size:13px;font-weight:700;color:#dc3545;">${i}</span>`).join('')}</div></div>` : '';
    const ausentesHTML = ausentes.length > 0 ? `<div style="margin-top:20px;"><h4 style="color:#ffc107;">❌ Códigos Ausentes (${ausentes.length})</h4><div style="background:#fffbf0;padding:15px;border-radius:8px;border-left:4px solid #ffc107;">${ausentes.slice(0,20).map(c=>`<span style="display:inline-block;background:#fff3cd;padding:6px 12px;margin:4px;border-radius:5px;font-size:13px;font-weight:600;">${c}</span>`).join('')}${ausentes.length>20?`<p style="color:#666;font-size:13px;">... y ${ausentes.length-20} más</p>`:''}</div></div>` : '';
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Verificación ${ubicacion}</title></head><body style="font-family:'Segoe UI',Arial,sans-serif;margin:0;padding:20px;background:#f5f5f5;"><div style="max-width:800px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.1);"><div style="background:linear-gradient(135deg,${estadoColor} 0%,${estadoColor}dd 100%);color:white;padding:40px 30px;text-align:center;"><div style="font-size:64px;margin-bottom:15px;">${estadoIcono}</div><h1 style="margin:0 0 10px 0;font-size:32px;font-weight:800;">Verificación Completada</h1><h2 style="margin:0;font-size:28px;font-weight:400;">${ubicacion}</h2><div style="margin-top:20px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.3);"><p style="margin:5px 0;opacity:0.9;font-size:14px;"><strong>Realizada por:</strong> ${usuario}</p><p style="margin:5px 0;opacity:0.9;font-size:14px;"><strong>Fecha:</strong> ${fecha}</p></div></div><div style="padding:30px;"><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:15px;margin-bottom:30px;"><div style="background:#e8f5e9;padding:20px;border-radius:8px;text-align:center;border-left:4px solid #28a745;"><div style="font-size:42px;font-weight:bold;color:#28a745;line-height:1;">${validados}</div><div style="color:#2e7d32;font-size:13px;font-weight:600;">Validados</div></div><div style="background:#fff5f5;padding:20px;border-radius:8px;text-align:center;border-left:4px solid #dc3545;"><div style="font-size:42px;font-weight:bold;color:#dc3545;line-height:1;">${intrusos.length}</div><div style="color:#c82333;font-size:13px;font-weight:600;">Intrusos</div></div><div style="background:#fffbf0;padding:20px;border-radius:8px;text-align:center;border-left:4px solid #ffc107;"><div style="font-size:42px;font-weight:bold;color:#ffc107;line-height:1;">${ausentes.length}</div><div style="color:#856404;font-size:13px;font-weight:600;">Ausentes</div></div><div style="background:#e3f2fd;padding:20px;border-radius:8px;text-align:center;border-left:4px solid #1d66c3;"><div style="font-size:42px;font-weight:bold;color:#1d66c3;line-height:1;">${tasaExito.toFixed ? tasaExito.toFixed(1) : tasaExito}%</div><div style="color:#155ab5;font-size:13px;font-weight:600;">Precisión</div></div></div>${validadosHTML}${intrusosHTML}${ausentesHTML}<div style="background:#f8f9fa;padding:20px;border-radius:8px;margin-top:40px;text-align:center;border:1px solid #e0e0e0;"><p style="margin:0;color:#666;font-size:13px;">PartFinder SukiMotor Ultra — ${new Date().getFullYear()}</p></div></div></div></body></html>`;
  } catch(e) { return `<html><body><h2>Error: ${e.message}</h2></body></html>`; }
}

function generarHTMLAuditoria(datos) {
  const estadoColor = { 'Dañado':'#dc3545','Faltante':'#ffc107','Excedente':'#17a2b8','Sobrante':'#28a745','Mal Ubicado':'#6c757d' };
  const color = estadoColor[datos.estado] || '#6c757d';
  const fotosHTML = datos.fotos && datos.fotos.length > 0 ? `<div style="margin-top:20px;"><h4 style="color:#333;">📸 Evidencia Fotográfica (${datos.fotos.length})</h4><div style="background:#f8f9fa;padding:15px;border-radius:8px;">${datos.fotos.map((f,i)=>`<div style="margin:5px 0;"><a href="${f.url}" style="color:#1d66c3;">📷 Ver Foto ${i+1}: ${f.nombre}</a></div>`).join('')}</div></div>` : '';
  return `<div style="background:linear-gradient(135deg,${color} 0%,${color}dd 100%);color:white;padding:30px;border-radius:8px;text-align:center;margin-bottom:30px;"><div style="font-size:48px;margin-bottom:15px;">🔍</div><h1 style="margin:0 0 10px 0;font-size:28px;">Auditoría Registrada</h1><h2 style="margin:0;font-size:24px;font-weight:400;">${datos.codigo}</h2><p style="margin:15px 0 0 0;opacity:0.95;"><span style="background:rgba(255,255,255,0.2);padding:8px 20px;border-radius:20px;font-weight:bold;">${datos.estado}</span></p></div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:15px;margin-bottom:30px;"><div style="background:#f8f9fa;padding:20px;border-radius:8px;text-align:center;border-left:4px solid ${color};"><div style="font-size:14px;color:#666;margin-bottom:5px;">Estado</div><div style="font-size:20px;font-weight:bold;color:${color};">${datos.estado}</div></div><div style="background:#f8f9fa;padding:20px;border-radius:8px;text-align:center;border-left:4px solid #1d66c3;"><div style="font-size:14px;color:#666;margin-bottom:5px;">Cantidad</div><div style="font-size:28px;font-weight:bold;color:#1d66c3;">${datos.cantidad}</div></div><div style="background:#f8f9fa;padding:20px;border-radius:8px;text-align:center;border-left:4px solid #28a745;"><div style="font-size:14px;color:#666;margin-bottom:5px;">Fotos</div><div style="font-size:28px;font-weight:bold;color:#28a745;">${datos.fotos?datos.fotos.length:0}</div></div></div><div style="background:white;border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin-bottom:20px;"><h4 style="margin-top:0;color:#1d66c3;">📦 Información del Repuesto</h4><table style="width:100%;"><tr><td style="padding:8px 0;color:#666;width:120px;"><strong>Código:</strong></td><td style="padding:8px 0;font-weight:bold;">${datos.codigo}</td></tr><tr><td style="padding:8px 0;color:#666;"><strong>Descripción:</strong></td><td style="padding:8px 0;">${datos.descripcion}</td></tr><tr><td style="padding:8px 0;color:#666;"><strong>Marca:</strong></td><td style="padding:8px 0;">${datos.marca}</td></tr><tr><td style="padding:8px 0;color:#666;"><strong>Ubicación:</strong></td><td style="padding:8px 0;">${datos.ubicacion}</td></tr><tr><td style="padding:8px 0;color:#666;"><strong>Auditor:</strong></td><td style="padding:8px 0;">${datos.usuario}</td></tr><tr><td style="padding:8px 0;color:#666;"><strong>Fecha:</strong></td><td style="padding:8px 0;">${datos.fecha}</td></tr></table></div>${datos.notas?`<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:20px;margin-bottom:20px;"><h4 style="margin-top:0;color:#856404;">📝 Notas</h4><p style="margin:0;color:#856404;">${datos.notas}</p></div>`:''}${fotosHTML}`;
}

function generarHTMLRecepcionCompleto(id, factura, items, timestamp) {
  const itemsHTML = items.map(item => `<tr><td>${item.codigo}</td><td>${item.cantidad||1}</td><td>${item.ubicacion||'PENDIENTE'}</td><td>${item.ubicado?'✅':'⏳'}</td></tr>`).join('');
  return `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:15px;margin-bottom:20px;"><div style="background:#e3f2fd;padding:20px;border-radius:8px;text-align:center;"><div style="font-size:32px;font-weight:bold;color:#1d66c3;">${items.length}</div><div style="color:#666;">Items Recibidos</div></div><div style="background:#e8f5e9;padding:20px;border-radius:8px;text-align:center;"><div style="font-size:32px;font-weight:bold;color:#28a745;">${items.filter(i=>i.ubicado).length}</div><div style="color:#666;">Ubicados</div></div></div><h3>Factura: ${factura}</h3><p>ID: ${id} | Fecha: ${timestamp}</p><table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#1d66c3;color:white;"><th style="padding:10px;text-align:left;">Código</th><th style="padding:10px;text-align:left;">Cantidad</th><th style="padding:10px;text-align:left;">Ubicación</th><th style="padding:10px;text-align:left;">Estado</th></tr></thead><tbody>${itemsHTML}</tbody></table>`;
}

function generarHTMLConteoFisico(datos) {
  // Maneja tanto conteo físico (esperados/contados/ausentes) como conteo referencia (referencias/lotes)
  if (datos.referencias) {
    const filas = datos.referencias.map(r => `<tr><td style="padding:8px;font-weight:700;">${cleanPartCode(r.codigo).clean}</td><td style="padding:8px;text-align:center;font-size:18px;font-weight:900;color:#28a745;">${r.totalFisico||0}</td><td style="padding:8px;color:#666;">${r.descripcion||''}</td></tr>`).join('');
    return `<h2 style="color:#1d66c3;">📋 Conteo Referencia — ID: ${datos.idConteo}</h2><p><strong>Fecha:</strong> ${datos.fecha} | <strong>Usuario:</strong> ${datos.usuario}</p><table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#1d66c3;color:white;"><th style="padding:10px;text-align:left;">Código</th><th style="padding:10px;text-align:center;">Cant. Física</th><th style="padding:10px;text-align:left;">Descripción</th></tr></thead><tbody>${filas}</tbody></table>`;
  }
  if (datos.lotes) {
    const filas = datos.lotes.map(l => `<tr><td style="padding:8px;font-weight:700;">${l.codigo}</td><td style="padding:8px;">${l.ubicacion||'-'}</td><td style="padding:8px;text-align:center;">${l.cant_sistema||0}</td><td style="padding:8px;text-align:center;">${l.cant_fisica||0}</td><td style="padding:8px;text-align:center;color:${(l.sobrante||0)>0?'#28a745':(l.faltante||0)>0?'#dc3545':'#666'};">${(l.sobrante||0)>0?'+'+l.sobrante:(l.faltante||0)>0?'-'+l.faltante:'=0'}</td></tr>`).join('');
    return `<h2 style="color:#1d66c3;">📊 Reporte Lotes Conteo Físico</h2><p><strong>Usuario:</strong> ${datos.usuario}</p><table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#1d66c3;color:white;"><th style="padding:10px;">Código</th><th style="padding:10px;">Ubicación</th><th style="padding:10px;">Sistema</th><th style="padding:10px;">Físico</th><th style="padding:10px;">Diferencia</th></tr></thead><tbody>${filas}</tbody></table>`;
  }
  const ausentes = datos.ausentes||[]; const noEsperados = datos.noEsperados||[]; const contados = datos.contados||[]; const esperados = datos.esperados||[];
  return `<h2 style="color:#1d66c3;">🔢 Conteo Físico — ${datos.ubicacion||''}</h2><p><strong>Fecha:</strong> ${datos.fecha} | <strong>Usuario:</strong> ${datos.usuario} | <strong>ID:</strong> ${datos.id}</p><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:15px;margin:20px 0;"><div style="background:#e3f2fd;padding:15px;border-radius:8px;text-align:center;"><div style="font-size:24px;font-weight:bold;color:#1d66c3;">${esperados.length}</div><div>Esperados</div></div><div style="background:#e8f5e9;padding:15px;border-radius:8px;text-align:center;"><div style="font-size:24px;font-weight:bold;color:#28a745;">${contados.filter(c=>esperados.includes(c)).length}</div><div>Contados</div></div><div style="background:#ffebee;padding:15px;border-radius:8px;text-align:center;"><div style="font-size:24px;font-weight:bold;color:#dc3545;">${ausentes.length}</div><div>Ausentes</div></div><div style="background:#fff3e0;padding:15px;border-radius:8px;text-align:center;"><div style="font-size:24px;font-weight:bold;color:#e65100;">${noEsperados.length}</div><div>No Esperados</div></div></div>`;
}

function generarReporteAuditoriaPDF(datos, carpetaDestino) {
  try {
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:Arial,sans-serif;margin:40px;color:#333;}.header{background:linear-gradient(135deg,#dc3545 0%,#c82333 100%);color:white;padding:30px;border-radius:10px;margin-bottom:30px;}.section{background:#f8f9fa;border-radius:8px;padding:20px;margin-bottom:20px;border-left:4px solid #dc3545;}.info-grid{display:grid;grid-template-columns:150px 1fr;gap:10px;}.label{font-weight:bold;color:#666;}.footer{margin-top:40px;text-align:center;color:#999;font-size:12px;border-top:1px solid #eee;padding-top:20px;}</style></head><body><div class="header"><h1>🔍 Reporte de Auditoría</h1><p>ID: ${datos.id}</p><p>Fecha: ${datos.fecha}</p></div><div class="section"><h3>📦 Información del Repuesto</h3><div class="info-grid"><span class="label">Código:</span><span style="font-weight:bold;font-size:18px;">${datos.codigo}</span><span class="label">Descripción:</span><span>${datos.descripcion}</span><span class="label">Marca:</span><span>${datos.marca}</span><span class="label">Ubicación:</span><span>${datos.ubicacion}</span></div></div><div class="section"><h3>📋 Resultado</h3><div class="info-grid"><span class="label">Estado:</span><span style="font-weight:bold;color:#dc3545;">${datos.estado}</span><span class="label">Cantidad:</span><span style="font-size:24px;font-weight:bold;">${datos.cantidad}</span><span class="label">Auditor:</span><span>${datos.usuario}</span></div>${datos.notas?`<div style="background:#fff3cd;border:1px solid #ffc107;padding:15px;border-radius:8px;margin-top:20px;"><strong>📝 Notas:</strong><br>${datos.notas}</div>`:''}</div>${datos.fotos&&datos.fotos.length>0?`<div class="section"><h3>📸 Evidencia Fotográfica (${datos.fotos.length})</h3>${datos.fotos.map((f,i)=>`<div style="margin:10px 0;padding:10px;background:white;border-radius:5px;">📷 Foto ${i+1}: <a href="${f.url}">${f.nombre}</a></div>`).join('')}</div>`:''}<div class="footer"><p>PartFinder SukiMotor Ultra</p><p>Reporte generado el ${datos.fecha}</p></div></body></html>`;
    const blob = Utilities.newBlob(html,'text/html','reporte.html');
    const pdf  = blob.getAs('application/pdf').setName(`${datos.id}_Reporte.pdf`);
    const file = carpetaDestino.createFile(pdf);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch(e) { Logger.log('PDF auditoria error: '+e); return ''; }
}

function generarReporteVerificacionPDF(datos, carpetaDestino) {
  try {
    const col = datos.tasaExito>=95?'#28a745':datos.tasaExito>=85?'#ffc107':'#dc3545';
    const codigosValidados = (datos.codigosEncontrados||[]).filter(c=>(datos.codigosEsperados||[]).includes(c));
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:Arial,sans-serif;margin:40px;color:#333;}.header{background:linear-gradient(135deg,${col} 0%,${col}dd 100%);color:white;padding:30px;border-radius:10px;margin-bottom:30px;text-align:center;}.section{background:#f8f9fa;border-radius:8px;padding:20px;margin-bottom:20px;}.stat-box{display:inline-block;background:white;padding:15px 25px;border-radius:8px;margin:10px;text-align:center;border-left:4px solid ${col};}.stat-value{font-size:32px;font-weight:bold;color:${col};}.codigo-item{display:inline-block;background:#e8f5e9;padding:5px 10px;margin:3px;border-radius:5px;font-size:13px;}</style></head><body><div class="header"><h1>✅ Reporte de Verificación</h1><h2>${datos.ubicacion}</h2><p>${datos.fecha}</p></div><div style="text-align:center;margin-bottom:30px;"><div class="stat-box"><div class="stat-value">${datos.validados}</div><div style="color:#666;font-size:12px;">Validados</div></div><div class="stat-box"><div class="stat-value">${(datos.intrusos||[]).length}</div><div style="color:#666;font-size:12px;">Intrusos</div></div><div class="stat-box"><div class="stat-value">${(datos.ausentes||[]).length}</div><div style="color:#666;font-size:12px;">Ausentes</div></div><div class="stat-box"><div class="stat-value">${datos.tasaExito}%</div><div style="color:#666;font-size:12px;">Precisión</div></div></div>${codigosValidados.length>0?`<div class="section"><h3>✅ Códigos Validados (${codigosValidados.length})</h3>${codigosValidados.map(c=>`<span class="codigo-item">${c}</span>`).join('')}</div>`:''} ${(datos.intrusos||[]).length>0?`<div class="section"><h3 style="color:#dc3545;">🚨 Intrusos (${datos.intrusos.length})</h3>${datos.intrusos.map(c=>`<span class="codigo-item" style="background:#fff3cd;">${c}</span>`).join('')}</div>`:''}${(datos.ausentes||[]).length>0?`<div class="section"><h3 style="color:#ffc107;">❌ Ausentes (${datos.ausentes.length})</h3>${datos.ausentes.map(c=>`<span class="codigo-item" style="background:#f8d7da;">${c}</span>`).join('')}</div>`:''}</body></html>`;
    const blob = Utilities.newBlob(html,'text/html','reporte.html');
    const pdf  = blob.getAs('application/pdf').setName(`${datos.id}_Reporte.pdf`);
    const file = carpetaDestino.createFile(pdf);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch(e) { Logger.log('PDF verificacion error: '+e); return ''; }
}

function generarReporteRecepcionPDF(datos, carpetaDestino) {
  try {
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:Arial,sans-serif;margin:40px;color:#333;}.header{background:linear-gradient(135deg,#1d66c3 0%,#155ab5 100%);color:white;padding:30px;border-radius:10px;margin-bottom:30px;text-align:center;}table{width:100%;border-collapse:collapse;margin-top:20px;}th{background:#1d66c3;color:white;padding:12px;text-align:left;}td{padding:10px;border-bottom:1px solid #e0e0e0;}tr:nth-child(even){background:#f8f9fa;}</style></head><body><div class="header"><h1>📦 Reporte de Recepción</h1><h2>Factura: ${datos.factura}</h2><p>${datos.fecha}</p></div><table><thead><tr><th>Código</th><th>Cantidad</th><th>Ubicación</th><th>Estado</th></tr></thead><tbody>${datos.items.map(item=>`<tr><td><strong>${item.codigo}</strong></td><td>${item.cantidad||1}</td><td>${item.ubicacion||'PENDIENTE'}</td><td>${item.ubicado?'✅ Ubicado':'⏳ Pendiente'}</td></tr>`).join('')}</tbody></table></body></html>`;
    const blob = Utilities.newBlob(html,'text/html','reporte.html');
    const pdf  = blob.getAs('application/pdf').setName(`${datos.id}_Reporte.pdf`);
    const file = carpetaDestino.createFile(pdf);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch(e) { Logger.log('PDF recepcion error: '+e); return ''; }
}

// ── EXPORTAR INVENTARIO A GOOGLE SHEETS ──────────────────────
/**
 * Exporta todo el inventario de Supabase a un Google Sheet nuevo.
 * Ejecutar manualmente desde el editor de GAS o desde un botón en la UI.
 * Devuelve la URL del Sheet generado.
 */
function exportarInventarioASheet() {
  try {
    Logger.log('Iniciando exportación de inventario...');
    const sb = getSB();

    // 1. Obtener todas las partes con ubicaciones y marca
    let todas = [];
    let offset = 0;
    const limite = 1000;

    while (true) {
      const lote = sb.get('partes',
        'select=codigo,descripcion,gemini_descripcion,updated_at,' +
        'marcas(nombre),' +
        'parte_ubicaciones(orden,ubicaciones(codigo_ubicacion))' +
        '&activo=eq.true' +
        '&order=codigo.asc' +
        '&limit=' + limite + '&offset=' + offset
      );
      if (!lote || lote.length === 0) break;
      todas = todas.concat(lote);
      if (lote.length < limite) break;
      offset += limite;
    }

    Logger.log('Total partes obtenidas: ' + todas.length);

    // 2. Crear nuevo Google Sheet
    const fecha    = Utilities.formatDate(new Date(), 'GMT-5', 'yyyy-MM-dd_HHmm');
    const nombre   = 'Inventario_SukiMotor_' + fecha;
    const sheet    = SpreadsheetApp.create(nombre);
    const hoja     = sheet.getActiveSheet();
    hoja.setName('Inventario');

    // 3. Encabezados (formato idéntico al original)
    const headers = [
      'Código', 'Descripción', 'Marca',
      'Ubicación Principal', 'Ubicación 2', 'Ubicación 3',
      'Ubicación 4', 'Ubicación 5', 'Último Inventario'
    ];
    hoja.getRange(1, 1, 1, headers.length).setValues([headers]);
    hoja.getRange(1, 1, 1, headers.length)
      .setBackground('#1d66c3')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    hoja.setFrozenRows(1);

    // 4. Convertir datos y escribir en lotes de 500 filas
    const filas = todas.map(p => {
      const row   = sbToRow(p);
      const ultInv = p.updated_at
        ? Utilities.formatDate(new Date(p.updated_at), 'GMT-5', 'dd/MM/yyyy')
        : '';
      return [
        row['Código'],
        row['Descripción'],
        row['Marca'],
        row['Ubicación Principal'],
        row['Ubicación 2'],
        row['Ubicación 3'],
        row['Ubicación 4'],
        row['Ubicación 5'],
        ultInv
      ];
    });

    const tamLote = 500;
    for (let i = 0; i < filas.length; i += tamLote) {
      const lote = filas.slice(i, i + tamLote);
      hoja.getRange(i + 2, 1, lote.length, headers.length).setValues(lote);
    }

    // 5. Formato final
    hoja.autoResizeColumns(1, headers.length);
    hoja.getRange(2, 1, filas.length, 1).setFontWeight('bold'); // Columna Código en negrita

    // 6. Agregar hoja de resumen
    const resumen = sheet.insertSheet('Resumen');
    const conUbic = filas.filter(f => f[3] && f[3].trim()).length;
    resumen.getRange('A1:B6').setValues([
      ['Exportación PartFinder SukiMotor', ''],
      ['Fecha',              Utilities.formatDate(new Date(), 'GMT-5', 'dd/MM/yyyy HH:mm')],
      ['Total partes',       filas.length],
      ['Con ubicación',      conUbic],
      ['Sin ubicación',      filas.length - conUbic],
      ['% Ubicados',         filas.length > 0 ? ((conUbic / filas.length) * 100).toFixed(1) + '%' : '0%']
    ]);
    resumen.getRange('A1:B1').merge().setBackground('#1d66c3').setFontColor('#fff').setFontWeight('bold');
    resumen.getRange('A2:A6').setFontWeight('bold');
    resumen.autoResizeColumns(1, 2);

    const url = sheet.getUrl();
    Logger.log('Exportación completada: ' + url);
    Logger.log('Total filas: ' + filas.length);

    return {
      success: true,
      url: url,
      nombre: nombre,
      totalPartes: filas.length,
      conUbicacion: conUbic,
      sinUbicacion: filas.length - conUbic
    };

  } catch(e) {
    Logger.log('Error en exportarInventarioASheet: ' + e.toString());
    return { success: false, message: e.toString() };
  }
}

/**
 * Exportar también usuarios y ubicaciones para backup completo
 */
function exportarBackupCompleto() {
  try {
    const sb    = getSB();
    const fecha = Utilities.formatDate(new Date(), 'GMT-5', 'yyyy-MM-dd_HHmm');
    const sheet = SpreadsheetApp.create('Backup_SukiMotor_' + fecha);

    // ── Inventario ──
    const partes = sb.get('partes',
      'select=codigo,descripcion,gemini_descripcion,marcas(nombre),' +
      'parte_ubicaciones(orden,ubicaciones(codigo_ubicacion))' +
      '&activo=eq.true&order=codigo.asc&limit=30000'
    ) || [];
    const hInv = sheet.getActiveSheet();
    hInv.setName('Inventario');
    hInv.getRange(1,1,1,9).setValues([['Código','Descripción','Marca','Ubicación 1','Ubicación 2','Ubicación 3','Ubicación 4','Ubicación 5','Descripción AI']]);
    hInv.getRange(1,1,1,9).setBackground('#1d66c3').setFontColor('#fff').setFontWeight('bold');
    if (partes.length > 0) {
      const filas = partes.map(p => {
        const r = sbToRow(p);
        return [r['Código'],r['Descripción'],r['Marca'],r['Ubicación Principal'],r['Ubicación 2'],r['Ubicación 3'],r['Ubicación 4'],r['Ubicación 5'],p.gemini_descripcion||''];
      });
      hInv.getRange(2,1,filas.length,9).setValues(filas);
    }

    // ── Ubicaciones ──
    const ubics = sb.get('ubicaciones', 'select=codigo_ubicacion,zona,pasillo,anaquel,rack,nivel,estado&order=codigo_ubicacion.asc&limit=5000') || [];
    const hUbic = sheet.insertSheet('Ubicaciones');
    hUbic.getRange(1,1,1,7).setValues([['Código','Zona','Pasillo','Anaquel','Rack','Nivel','Estado']]);
    hUbic.getRange(1,1,1,7).setBackground('#28a745').setFontColor('#fff').setFontWeight('bold');
    if (ubics.length > 0) {
      hUbic.getRange(2,1,ubics.length,7).setValues(ubics.map(u=>[u.codigo_ubicacion,u.zona||'',u.pasillo||'',u.anaquel||'',u.rack||'',u.nivel||'',u.estado||'']));
    }

    // ── Usuarios (sin hashes) ──
    const users = sb.get('usuarios', 'select=email,nombre,rol,activo,created_at&order=email.asc') || [];
    const hUser = sheet.insertSheet('Usuarios');
    hUser.getRange(1,1,1,5).setValues([['Email','Nombre','Rol','Activo','Creado']]);
    hUser.getRange(1,1,1,5).setBackground('#dc3545').setFontColor('#fff').setFontWeight('bold');
    if (users.length > 0) {
      hUser.getRange(2,1,users.length,5).setValues(users.map(u=>[u.email,u.nombre||'',u.rol,u.activo?'Sí':'No',u.created_at?u.created_at.substring(0,10):'']));
    }

    [hInv, hUbic, hUser].forEach(h => h.autoResizeColumns(1, h.getLastColumn()));
    sheet.setActiveSheet(hInv);

    const url = sheet.getUrl();
    Logger.log('Backup completo: ' + url);
    return { success: true, url, partes: partes.length, ubicaciones: ubics.length, usuarios: users.length };

  } catch(e) {
    Logger.log('Error backup: ' + e.toString());
    return { success: false, message: e.toString() };
  }
}

// ── DIAGNÓSTICO (ejecutar desde el editor GAS para debugear) ──
function debugLogin() {
  Logger.log('=== DEBUG LOGIN ===');

  const props = PropertiesService.getScriptProperties();
  const url   = props.getProperty('SUPABASE_URL');
  const key   = props.getProperty('SUPABASE_ANON_KEY');

  Logger.log('SUPABASE_URL configurada: ' + (url ? 'SÍ → ' + url.substring(0, 40) : 'NO ❌'));
  Logger.log('SUPABASE_ANON_KEY configurada: ' + (key ? 'SÍ → ' + key.substring(0, 20) + '...' : 'NO ❌'));

  if (!url || !key) {
    Logger.log('>> Falta configurar Script Properties. Ve a Configuración del Proyecto → Propiedades de script.');
    return;
  }

  const sb   = getSB();
  const rows = sb.rpc('get_user_for_auth', { p_email: 'mendozag05@gmail.com' });
  const row  = Array.isArray(rows) ? rows[0] : rows;

  Logger.log('Usuario encontrado en Supabase: ' + (row ? 'SÍ' : 'NO ❌'));

  if (!row) {
    Logger.log('>> El email mendozag05@gmail.com no existe en la tabla usuarios de Supabase.');
    Logger.log('>> Verifica que la migración se ejecutó correctamente.');
    return;
  }

  Logger.log('Activo: ' + row.activo);
  Logger.log('Rol: ' + row.rol);
  Logger.log('pin_salt presente: ' + (row.pin_salt ? 'SÍ (' + row.pin_salt.substring(0,8) + '...)' : 'NO ❌ — columna vacía'));
  Logger.log('pin_hash presente: ' + (row.pin_hash ? 'SÍ (' + row.pin_hash.substring(0,12) + '...)' : 'NO ❌'));

  if (!row.pin_salt || !row.pin_hash) {
    Logger.log('>> pin_salt o pin_hash están vacíos. Hay que volver a migrar los PINs.');
    return;
  }

  // Probar verificación SHA-256
  const calculado = hashPIN('1121', row.pin_salt);
  const coincide  = calculado.hash === row.pin_hash;

  Logger.log('Hash calculado por GAS: ' + calculado.hash.substring(0, 20) + '...');
  Logger.log('Hash guardado en Supabase: ' + row.pin_hash.substring(0, 20) + '...');
  Logger.log('¿Coinciden? ' + (coincide ? 'SÍ ✅' : 'NO ❌ — problema de hashing'));

  if (coincide) {
    Logger.log('>> El PIN es correcto. El problema debe ser otro (sesión, rol, etc.)');
    const result = authenticateUser('mendozag05@gmail.com', '1121');
    Logger.log('authenticateUser() retornó: ' + JSON.stringify(result));
  } else {
    Logger.log('>> Los hashes no coinciden. Ejecuta fixPINs() para corregirlos.');
  }
}

/**
 * Si debugLogin() muestra que los hashes no coinciden,
 * ejecuta esta función para re-hashear los PINs directamente desde GAS.
 */
function fixPINs() {
  const usuarios = [
    { email: 'mendozag05@gmail.com',       pin: '1121'   },
    { email: 'jc@suz.com.pa',              pin: '727325' },
    { email: 'suzukirepuesto73@gmail.com', pin: '7325'   },
    { email: 'suzukirepuesto72@gmail.com', pin: '7225'   },
  ];
  const sb = getSB();
  usuarios.forEach(u => {
    const { hash, salt } = hashPIN(u.pin);
    // Usar RPC SECURITY DEFINER para actualizar — la anon key no puede escribir usuarios directamente
    const res = sb.rpc('update_user_pin', { p_email: u.email, p_pin_hash: hash, p_pin_salt: salt });
    Logger.log((res !== null ? 'OK' : 'Error') + ' → ' + u.email + ' | hash: ' + hash.substring(0,12) + '...');
  });
  Logger.log('fixPINs completado. Ejecuta debugLogin() para verificar.');
}

// ── WEB APP ───────────────────────────────────────────────────
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('PartFinder SukiMotor Ultra')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
