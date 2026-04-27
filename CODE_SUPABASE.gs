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
    this.key  = p.getProperty('SUPABASE_SERVICE_KEY');
    this.hdrs = {
      'apikey':        this.key,
      'Authorization': 'Bearer ' + this.key,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation'
    };
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
    const sb  = getSB();
    const row = sb.getOne('usuarios',
      'select=id,email,nombre,rol,pin_hash,pin_salt,activo,permisos' +
      '&email=eq.' + encodeURIComponent(email.toLowerCase().trim())
    );
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
    const apiKey = obtenerAPIKeyGemini();
    const b64    = imagenBase64.includes(',') ? imagenBase64.split(',')[1] : imagenBase64;
    const mime   = imagenBase64.startsWith('data:') ? imagenBase64.split(';')[0].replace('data:','') : 'image/jpeg';
    const prompt = `Eres un experto en inventario de repuestos de motos. Analiza esta imagen de una orden de despacho y extrae TODOS los códigos de repuestos y sus cantidades.
Devuelve SOLO JSON válido: {"items":[{"codigo":"XXXX-XXXX","cantidad":1}]}
Si no hay códigos claros: {"items":[]}`;

    const url = GEMINI_CONFIG.API_ENDPOINT + '/' + GEMINI_CONFIG.MODEL + ':generateContent?key=' + apiKey;
    const res = UrlFetchApp.fetch(url, {
      method: 'POST', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }], generationConfig: { maxOutputTokens: 1024, temperature: 0.1 } })
    });
    const json    = JSON.parse(res.getContentText());
    const texto   = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{"items":[]}';
    const limpio  = texto.replace(/```json|```/g,'').trim();
    const result  = JSON.parse(limpio);
    return { success: true, items: result.items || [] };
  } catch(e) { return { success: false, error: e.toString(), items: [] }; }
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

// ── cleanPartCode y normalizarUbicacion (sin cambios) ──────────
// COPIA AQUÍ LAS FUNCIONES cleanPartCode(), agregarGuionesSYM(),
// normalizarUbicacion(), normalizarUbicacionSimple() del CODE original.
// No interactúan con ninguna base de datos.

// ── HTML GENERATORS (sin cambios) ──────────────────────────────
// COPIA AQUÍ LAS FUNCIONES:
// generarHTMLVerificacionIndividual(), generarHTMLAuditoria(),
// generarHTMLRecepcionCompleto(), generarHTMLConteoFisico(),
// generarReporteAuditoriaPDF(), generarReporteVerificacionPDF(),
// generarReporteRecepcionPDF()
// No interactúan con Google Sheets.

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
