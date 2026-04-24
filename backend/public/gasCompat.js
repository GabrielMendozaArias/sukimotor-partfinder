// ============================================================
// GAS COMPATIBILITY LAYER — PartFinder SukiMotor
// Reemplaza google.script.run con fetch calls a la API REST
// ============================================================

const GAS_API_URL = 'https://sukimotor-partfinder-production.up.railway.app';

function gasGetToken() { return localStorage.getItem('token'); }

async function gasFetch(path, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  const token = gasGetToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(GAS_API_URL + path, {
    method, headers,
    body: body ? JSON.stringify(body) : null
  });
  const data = await res.json();
  if (!res.ok && data.error) throw new Error(data.error);
  return data;
}

// Convierte parte del formato nuevo al formato GAS original
function gasConvertirParte(p) {
  if (!p) return null;
  const ubics = (p.ubicaciones || []).sort((a, b) => a.orden - b.orden);
  return {
    'Código': p.codigo || '',
    'Descripción': p.gemini_descripcion || p.descripcion || '',
    'Marca': p.marca?.nombre || '',
    'Ubicación Principal': ubics[0]?.ubicacion?.codigo_ubicacion || '',
    'Ubicación 2': ubics[1]?.ubicacion?.codigo_ubicacion || '',
    'Ubicación 3': ubics[2]?.ubicacion?.codigo_ubicacion || '',
    'Ubicación 4': ubics[3]?.ubicacion?.codigo_ubicacion || '',
    'Ubicación 5': ubics[4]?.ubicacion?.codigo_ubicacion || '',
  };
}

function gasLimpiarCodigo(c) {
  return (c || '').replace(/[^A-Z0-9\-]/gi, '').toUpperCase().trim();
}

function gasRespuestaBusqueda(codigo, partes) {
  const resultados = (partes || []).map(gasConvertirParte);
  return {
    originalInput: codigo,
    cleanedCode: gasLimpiarCodigo(codigo),
    isValid: resultados.length > 0,
    isSYM: codigo.toUpperCase().includes('SYM'),
    manualReview: false,
    info: resultados.length > 0 ? '' : 'Código no encontrado en inventario',
    resultados,
    count: resultados.length
  };
}

// ──────────────────────────────────────────────────────────
// CLASE PRINCIPAL QUE EMULA google.script.run
// ──────────────────────────────────────────────────────────
class GASRunner {
  constructor() { this._success = null; this._failure = null; }

  withSuccessHandler(fn) { this._success = fn; return this; }
  withFailureHandler(fn) { this._failure = fn; return this; }

  _exec(promise) {
    promise
      .then(data => { if (this._success) this._success(data); })
      .catch(err => { if (this._failure) this._failure(err.message || 'Error de conexión'); });
  }

  // ── AUTH ──────────────────────────────────────────────
  authenticateUser(email, pin) {
    this._exec(gasFetch('/api/auth/login', 'POST', { email, pin: String(pin) }).then(data => {
      localStorage.setItem('token', data.token);
      return {
        success: true,
        email: data.usuario.email,
        rol: data.usuario.rol,
        nombre: data.usuario.nombre,
        permisos: { puedeEditar: true, puedeVerificar: true, puedeRecibir: true, puedeDespachar: true },
        sessionId: data.token
      };
    }).catch(err => ({ success: false, message: err.message })));
  }

  getSessionUser(sessionId) {
    this._exec(gasFetch('/api/auth/me').then(data => ({
      success: true,
      user: {
        email: data.usuario.email,
        rol: data.usuario.rol,
        nombre: data.usuario.nombre,
        permisos: { puedeEditar: true, puedeVerificar: true, puedeRecibir: true, puedeDespachar: true }
      }
    })).catch(() => ({ success: false, requireLogin: true, message: 'Sesión expirada' })));
  }

  logoutUser(sessionId) {
    this._exec(gasFetch('/api/auth/logout', 'POST').then(() => {
      localStorage.removeItem('token');
      return { success: true };
    }));
  }

  // ── BÚSQUEDA ──────────────────────────────────────────
  buscarCodigo(codigo) {
    const q = encodeURIComponent(gasLimpiarCodigo(codigo) || codigo);
    this._exec(gasFetch(`/api/partes?q=${q}&limit=20`).then(data =>
      gasRespuestaBusqueda(codigo, data.partes)
    ));
  }

  buscarCodigoRecepcion(codigo) { this.buscarCodigo(codigo); }
  buscarCodigoAuditoria(codigo) { this.buscarCodigo(codigo); }
  buscarCodigoEditar(codigo) { this.buscarCodigo(codigo); }
  buscarCodigoVerificacion(codigo) { this.buscarCodigo(codigo); }
  escanearCodigoRecepcion(codigo) { this.buscarCodigo(codigo); }

  buscarPorUbicacion(ubicacion) {
    this._exec(gasFetch(`/api/compat/ubicacion/${encodeURIComponent(ubicacion)}`).then(data => data));
  }

  filtrarUbicaciones(filtros) {
    const params = new URLSearchParams(filtros || {}).toString();
    this._exec(gasFetch(`/api/compat/ubicaciones?${params}`).then(data => data));
  }

  // ── INVENTARIO / EDICIÓN ──────────────────────────────
  obtenerEstadisticasDashboard() {
    this._exec(gasFetch('/api/compat/stats').then(data => data));
  }

  obtenerRepuestosConUbicacion() {
    this._exec(gasFetch('/api/compat/partes?con_ubicacion=true').then(data => data));
  }

  obtenerRepuesosSinUbicacion() {
    this._exec(gasFetch('/api/compat/partes?sin_ubicacion=true').then(data => data));
  }

  crearNuevaUbicacion(datos) {
    this._exec(gasFetch('/api/compat/ubicaciones', 'POST', datos).then(data => data));
  }

  asignarUbicacionCodigo(codigo, ubicacion) {
    this._exec(gasFetch('/api/compat/asignar-ubicacion', 'POST', { codigo, ubicacion }).then(data => data));
  }

  asignarUbicacionItem(codigo, ubicacion) {
    this._exec(gasFetch('/api/compat/asignar-ubicacion', 'POST', { codigo, ubicacion }).then(data => data));
  }

  guardarEdicionEnSheet(codigo, datosEdicion) {
    this._exec(gasFetch('/api/compat/editar-parte', 'POST', { codigo, ...datosEdicion }).then(data => data));
  }

  agregarNuevoItem(datos) {
    const parte = {
      codigo: datos.codigo,
      descripcion: datos.descripcion,
      marca_id: null
    };
    this._exec(gasFetch('/api/partes', 'POST', parte).then(() => ({
      success: true,
      message: `Parte ${datos.codigo} agregada correctamente`
    })));
  }

  eliminarItem(codigo, motivo) {
    this._exec(gasFetch(`/api/compat/eliminar-parte`, 'POST', { codigo, motivo }).then(data => data));
  }

  // ── VERIFICACIÓN ─────────────────────────────────────
  marcarCodigoVerificacion(codigo, accion) {
    this._exec(gasFetch('/api/compat/verificar-codigo', 'POST', { codigo, accion }).then(data => data));
  }

  guardarVerificacion(datos) {
    this._exec(gasFetch('/api/compat/guardar-verificacion', 'POST', datos).then(data => data));
  }

  // ── RECEPCIÓN ─────────────────────────────────────────
  guardarRecepcion(datos) {
    this._exec(gasFetch('/api/compat/guardar-recepcion', 'POST', datos).then(data => data));
  }

  // ── AUDITORÍA ─────────────────────────────────────────
  guardarAuditoriaCompleta(datos) {
    this._exec(gasFetch('/api/compat/guardar-auditoria', 'POST', datos).then(data => data));
  }

  // ── DESPACHO ─────────────────────────────────────────
  buscarClienteDespacho(cliente) {
    this._exec(gasFetch(`/api/compat/buscar-cliente?q=${encodeURIComponent(cliente)}`).then(data => data));
  }

  validarItemsContraInventario(items) {
    this._exec(gasFetch('/api/compat/validar-items', 'POST', { items }).then(data => data));
  }

  validarItemsDespacho(items) { this.validarItemsContraInventario(items); }

  guardarDespacho(datos) {
    this._exec(gasFetch('/api/compat/guardar-despacho', 'POST', datos).then(data => data));
  }

  // ── CONTEO FÍSICO ─────────────────────────────────────
  buscarPorUbicacionConteo(ubicacion) {
    this._exec(gasFetch(`/api/compat/ubicacion/${encodeURIComponent(ubicacion)}`).then(data => ({
      success: true,
      count: data.resultados?.length || 0,
      ubicacion,
      items: data.resultados || []
    })));
  }

  buscarCodigoConteoFisico(codigo) { this.buscarCodigo(codigo); }

  guardarLotePreliminar(datos) {
    this._exec(gasFetch('/api/compat/guardar-conteo', 'POST', datos).then(data => data));
  }

  obtenerLotesProvisionales() {
    this._exec(gasFetch('/api/conteos').then(data => ({
      success: true,
      lotes: data.conteos || []
    })));
  }

  cerrarLoteConteoFisico(sessionId, loteID) {
    this._exec(gasFetch(`/api/conteos/${loteID}/completar`, 'PATCH').then(() => ({
      success: true, message: 'Lote cerrado'
    })));
  }

  // ── CONTEO REFERENCIA ─────────────────────────────────
  buscarCodigoConteoReferencia(codigo) { this.buscarCodigo(codigo); }

  guardarConteoReferencia(datos) {
    this._exec(gasFetch('/api/compat/guardar-conteo', 'POST', datos).then(data => data));
  }

  // ── GEMINI AI ─────────────────────────────────────────
  obtenerDescripcionConGemini(codigo, marca) {
    this._exec(gasFetch('/api/gemini/identificar', 'POST', { codigo, marca }).then(data => ({
      success: true,
      descripcion: data.descripcion,
      fuente: data.fuente,
      codigo,
      marca
    })).catch(err => ({ success: false, message: err.message })));
  }

  // ── ADMIN / CONFIG (stubs que no rompen la UI) ────────
  obtenerDatosConfiguracion() {
    this._exec(Promise.resolve({ success: true, stats: {} }));
  }
  obtenerLogs() {
    this._exec(Promise.resolve({ success: true, logs: [] }));
  }
  obtenerDatosVisualizador() {
    this._exec(Promise.resolve({ success: true, resultados: [] }));
  }
  obtenerConfiguracionEmails() {
    this._exec(Promise.resolve({ success: true, destinatarios: [] }));
  }
  agregarDestinatarioEmail(email, nombre, rol, tipo) {
    this._exec(Promise.resolve({ success: true }));
  }
  listarTriggers() {
    this._exec(Promise.resolve({ success: true, triggers: [] }));
  }
  configurarTodosLosTriggers() {
    this._exec(Promise.resolve({ success: true }));
  }
  eliminarTodosLosTriggers() {
    this._exec(Promise.resolve({ success: true, eliminados: 0 }));
  }
  limpiarCacheGlobal() {
    this._exec(Promise.resolve({ success: true }));
  }
  crearBackupAutomatico() {
    this._exec(Promise.resolve({ success: true, nombre: 'backup-' + Date.now() }));
  }
  limpiarLogsAntiguos() {
    this._exec(Promise.resolve({ success: true, eliminados: 0 }));
  }
  limpiarAuditoriaEmailsAntigua() {
    this._exec(Promise.resolve({ success: true, eliminados: 0 }));
  }
  obtenerInfoSistema() {
    this._exec(Promise.resolve({ success: true, version: '2.0', plataforma: 'Railway+Supabase' }));
  }
  obtenerEstadisticasSistemaAdmin() {
    this._exec(gasFetch('/api/compat/stats').then(data => data));
  }
  enviarReporteLotes() {
    this._exec(Promise.resolve({ success: true }));
  }
}

// Exponer como global — reemplaza el objeto de Google
const google = {
  script: {
    get run() { return new GASRunner(); }
  }
};

console.log('✅ GAS Compatibility Layer cargado — API:', GAS_API_URL);
