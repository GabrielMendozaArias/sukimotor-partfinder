
// ========================================
// PARTFINDER SUKIMOTOR - SISTEMA COMPLETO
// ========================================

let usuarioActual = null;
let currentSessionId = null;  // ⚠️ NUEVO
let stream = null;
let ultimoCamara = 'environment';
let inputTargetActual = null;
let cambiosPendientes = false;

// DATOS GLOBALES
let datosVerificacion = {
  ubicacion: '',
  codigosEsperados: [],
  codigosEncontrados: [],
  intrusosData: [],
  datosCompletos: []  // 🆕 NUEVA: guardar datos completos
};

let datosRecepcion = {
  factura: '',
  idRecepcion: '',
  fechaInicio: '',
  fechaCierre: null,
  estado: 'en_proceso',
  items: []
};

let datosAuditoria = {
  items: []
};

let datosConteoFisico = {
  ubicacion: '',
  codigosEsperados: [],
  cantidadesContadas: {},    // { "ABC123": 3, "XYZ456": 1 }
  cantidadesNoEsperadas: {}, // { "DEF789": 2 }
  datosCompletos: []
};

// datosConteoReferencia: keyed by código limpio
// { "13101-05H00": { codigo, descripcion, marca, loading, ubicaciones: [{ubicacion, cantidadFisica}] }, ... }
let datosConteoReferencia = {};

// ========================================
// 🛡️ PROTECCIÓN INTELIGENTE DE DATOS
// ========================================

function hayVerificacionEnProgreso() {
  return datosVerificacion.ubicacion !== '' && 
         (datosVerificacion.codigosEncontrados.length > 0 || 
          (datosVerificacion.intrusosData && datosVerificacion.intrusosData.length > 0));
}

function hayRecepcionEnProgreso() {
  return datosRecepcion.items.length > 0;
}

function hayAuditoriaEnProgreso() {
  return datosAuditoria.items.length > 0;
}

function hayDespachoEnProgreso() {
  return datosDespachoActual.items && datosDespachoActual.items.length > 0;
}

function hayConteoEnProgreso() {
  return datosConteoFisico.ubicacion !== '' &&
    (Object.keys(datosConteoFisico.cantidadesContadas).length > 0 ||
     Object.keys(datosConteoFisico.cantidadesNoEsperadas).length > 0);
}

function hayConteoReferenciaEnProgreso() {
  return Object.keys(datosConteoReferencia).length > 0;
}

function hayDatosSinGuardar() {
  return hayVerificacionEnProgreso() || hayRecepcionEnProgreso() ||
         hayAuditoriaEnProgreso() || hayDespachoEnProgreso() || hayConteoEnProgreso() || hayConteoReferenciaEnProgreso();
}

// ========================================
// 🔐 AUTENTICACIÓN
// ========================================

function loginUser() {
  const email = document.getElementById('loginEmail').value.trim();
  const pin = document.getElementById('loginPin').value.trim();
  
  if (!email || !pin) {
    mostrarAlerta('loginError', 'Completa todos los campos', 'error');
    return;
  }
  
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      if (respuesta.success) {
        // ⚠️ NUEVO: Guardar sessionId
        currentSessionId = respuesta.sessionId;
        localStorage.setItem('sessionId', respuesta.sessionId);
        
        usuarioActual = respuesta;
        mostrarAlerta('loginError', 'Inicio de sesión exitoso', 'success');
        setTimeout(() => {
          showModulo('menu');
          document.getElementById('userDisplay').textContent = respuesta.email + ' (' + respuesta.rol + ')';
          document.getElementById('btnLogout').style.display = 'inline-block';
        }, 500);
      } else {
        mostrarAlerta('loginError', respuesta.message || 'Error al iniciar sesión', 'error');
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('loginError', 'Error de conexión: ' + error, 'error');
    })
    .authenticateUser(email, pin);
}

function logout() {
  if (hayDatosSinGuardar()) {
    let detalles = [];
    
    if (hayVerificacionEnProgreso()) {
      detalles.push(`• Verificación: ${datosVerificacion.ubicacion} (${datosVerificacion.codigosEncontrados.length} validados)`);
    }
    if (hayRecepcionEnProgreso()) {
      detalles.push(`• Recepción: ${datosRecepcion.items.length} items`);
    }
    if (hayAuditoriaEnProgreso()) {
      detalles.push(`• Auditoría: ${datosAuditoria.items.length} items`);
    }
    if (hayDespachoEnProgreso()) {
      detalles.push(`• Despacho: ${datosDespachoActual.items.filter(i => i.recogido).length} items recogidos`);
    }
    
    mostrarModalConfirmacionLimpiar(
      '⚠️ ¿Cerrar sesión?',
      `Tienes trabajo sin guardar:<br><br>${detalles.join('<br>')}<br><br>Si cierras sesión, perderás todo el progreso.`,
      () => ejecutarLogout()
    );
  } else {
    ejecutarLogout();
  }
}

function ejecutarLogout() {
  // ⚠️ NUEVO: Obtener sessionId
  const sessionId = currentSessionId || localStorage.getItem('sessionId');
  
  google.script.run
    .withSuccessHandler(() => {
      // ⚠️ NUEVO: Limpiar sessionId
      currentSessionId = null;
      localStorage.removeItem('sessionId');
      
      usuarioActual = null;
      datosVerificacion = { ubicacion: '', codigosEsperados: [], codigosEncontrados: [], intrusosData: [], datosCompletos: [] };
      datosRecepcion = { factura: '', idRecepcion: '', fechaInicio: '', fechaCierre: null, estado: 'en_proceso', items: [] };
      datosAuditoria = { items: [] };
      datosDespachoActual = { cliente: '', items: [], tiempoInicio: null, filtroActual: 'todos' };
      
      showModulo('login');
      document.getElementById('loginEmail').value = '';
      document.getElementById('loginPin').value = '';
      document.getElementById('userDisplay').textContent = 'Iniciando...';
      document.getElementById('btnLogout').style.display = 'none';
      mostrarAlerta('loginError', 'Sesión cerrada', 'info');
    })
    .logoutUser(sessionId);  // ⚠️ NUEVO: Pasar sessionId
}

function verificarSesion() {
  // ⚠️ NUEVO: Obtener sessionId guardado
  const sessionId = localStorage.getItem('sessionId');
  
  // ⚠️ NUEVO: Si no hay sessionId, ir a login
  if (!sessionId) {
    showModulo('login');
    return;
  }
  
  // ⚠️ NUEVO: Guardar en variable global
  currentSessionId = sessionId;
  
  google.script.run
    .withSuccessHandler(respuesta => {
      if (respuesta.success) {
        usuarioActual = respuesta.user;
        showModulo('menu');
        document.getElementById('userDisplay').textContent = respuesta.user.email + ' (' + respuesta.user.rol + ')';
        document.getElementById('btnLogout').style.display = 'inline-block';
      } else {
        // ⚠️ NUEVO: Limpiar si expiró
        localStorage.removeItem('sessionId');
        currentSessionId = null;
        showModulo('login');
      }
    })
    .getSessionUser(sessionId);  // ⚠️ NUEVO: Pasar sessionId
}

// ========================================
// 🎨 UI Y NAVEGACIÓN
// ========================================


function volverAlMenu() {
  if (cambiosPendientes) {
    mostrarConfirmacion(
      '¿Salir sin guardar?',
      'Tienes cambios sin guardar. ¿Deseas salir?',
      () => {
        cambiosPendientes = false;
        showModulo('menu');
      }
    );
  } else {
    showModulo('menu');
  }
}

function limpiarModulo(modulo) {
  // Verificar si hay datos que perder
  let hayDatos = false;
  let mensaje = '';
  
  switch(modulo) {
    case 'verificar':
      hayDatos = hayVerificacionEnProgreso();
      mensaje = `Verificación de <strong>${datosVerificacion.ubicacion}</strong> con <strong>${datosVerificacion.codigosEncontrados.length}</strong> códigos validados`;
      break;
    case 'recepcion':
      hayDatos = hayRecepcionEnProgreso();
      mensaje = `Recepción con <strong>${datosRecepcion.items.length}</strong> items`;
      break;
    case 'auditoria':
      hayDatos = hayAuditoriaEnProgreso();
      mensaje = `Auditoría con <strong>${datosAuditoria.items.length}</strong> items`;
      break;
    case 'despacho':
      hayDatos = hayDespachoEnProgreso();
      const recogidos = datosDespachoActual.items ? datosDespachoActual.items.filter(i => i.recogido).length : 0;
      mensaje = `Despacho con <strong>${recogidos}</strong> items recogidos`;
      break;
    case 'conteo-fisico':
      hayDatos = hayConteoEnProgreso();
      mensaje = `Conteo de <strong>${datosConteoFisico.ubicacion}</strong> con <strong>${Object.keys(datosConteoFisico.cantidadesContadas).length}</strong> códigos contados`;
      break;
  }
  
  if (hayDatos) {
    mostrarModalConfirmacionLimpiar(
      '⚠️ ¿Limpiar datos?',
      `Tienes en progreso: ${mensaje}<br><br>¿Estás seguro de que quieres limpiar todo?`,
      () => ejecutarLimpiezaModulo(modulo)
    );
  } else {
    ejecutarLimpiezaModulo(modulo);
  }
}

function ejecutarLimpiezaModulo(modulo) {
  switch(modulo) {
    case 'buscar':
      document.getElementById('buscarInput').value = '';
      document.getElementById('buscarResultados').innerHTML = '';
      ocultarAlerta('buscarAlerta');
      break;
      
    case 'ubicaciones':
      document.getElementById('ubicacionInput').value = '';
      document.getElementById('ubicacionResultados').innerHTML = '';
      document.getElementById('btnAgregarUbicacion').style.display = 'none';
      ocultarAlerta('ubicacionAlerta');
      break;
      
    case 'asignacion':
      document.getElementById('codigoAsignacion').value = '';
      document.getElementById('ubicacionAsignacion').value = '';
      ocultarAlerta('asignacionAlerta');
      break;
      
    case 'verificar':
      document.getElementById('verificarUbicacionInput').value = '';
      document.getElementById('verificarResultados').innerHTML = '';
      document.getElementById('btnFinalizarVerificacion').style.display = 'none';
      datosVerificacion = { ubicacion: '', codigosEsperados: [], codigosEncontrados: [], intrusosData: [], datosCompletos: [] };
      ocultarAlerta('verificarAlerta');
      break;
      
    case 'recepcion':
      datosRecepcion = { factura: '', idRecepcion: '', fechaInicio: '', fechaCierre: null, estado: 'en_proceso', items: [] };
      document.getElementById('recepcionFactura').value = '';
      document.getElementById('recepcionCodigoInput').value = '';
      document.getElementById('recepcionLista').innerHTML = '';
      document.getElementById('recepcionReporte').innerHTML = '';
      document.getElementById('btnFinalizarRecepcion').style.display = 'none';
      cambiosPendientes = false;
      ocultarAlerta('recepcionAlerta');
      break;
      
    case 'por-ubicar':
      document.getElementById('porUbicarLista').innerHTML = '';
      document.getElementById('porUbicarFormulario').innerHTML = '';
      ocultarAlerta('porUbicarAlerta');
      break;
      
    case 'auditoria':
      document.getElementById('auditoriaCodigoInput').value = '';
      document.getElementById('auditoriaFormulario').innerHTML = '';
      document.getElementById('auditoriaLista').innerHTML = '';
      document.getElementById('btnFinalizarAuditoria').style.display = 'none';
      datosAuditoria = { items: [] };
      ocultarAlerta('auditoriaAlerta');
      break;
      
    case 'editar':
      document.getElementById('editarCodigoInput').value = '';
      document.getElementById('editarFormulario').innerHTML = '';
      ocultarAlerta('editarAlerta');
      break;
      
    case 'indice-ubicaciones':
      document.getElementById('filtroZona').value = '';
      document.getElementById('filtroPasillo').value = '';
      document.getElementById('filtroAnaquel').value = '';
      document.getElementById('filtroRack').value = '';
      document.getElementById('filtroNivel').value = '';
      document.getElementById('filtroEstado').value = '';
      document.getElementById('indiceResultados').innerHTML = '';
      ocultarAlerta('indiceAlerta');
      break;

    case 'despacho':
      datosDespachoActual = { cliente: '', items: [], tiempoInicio: null, filtroActual: 'todos' };
      document.getElementById('despachoCliente').value = '';
      document.getElementById('despachoCodigos').value = '';
      document.getElementById('despachoImageInput').value = '';
      document.getElementById('despachoImagePreview').style.display = 'none';
      document.getElementById('despachoResultadoValidacion').innerHTML = '';
      document.getElementById('despachoListaItems').innerHTML = '';
      document.getElementById('despachoResumenContenido').innerHTML = '';
      document.getElementById('despachoFaseCaptura').style.display = 'block';
      document.getElementById('despachoFaseValidacion').style.display = 'none';
      document.getElementById('despachoFasePicking').style.display = 'none';
      document.getElementById('despachoFaseResumen').style.display = 'none';
      ocultarAlerta('despachoAlerta');
      break;

    case 'conteo-fisico':
      datosConteoFisico = { ubicacion: '', codigosEsperados: [], cantidadesContadas: {}, cantidadesNoEsperadas: {}, datosCompletos: [] };
      document.getElementById('conteoUbicacionInput').value = '';
      document.getElementById('conteoResultados').innerHTML = '';
      document.getElementById('btnFinalizarConteo').style.display = 'none';
      ocultarAlerta('conteoAlerta');
      break;

    case 'conteo-referencia':
      datosConteoReferencia = {};
      document.getElementById('crCodigoInput').value = '';
      document.getElementById('crChips').innerHTML = '';
      document.getElementById('crContenido').innerHTML = '';
      document.getElementById('btnFinalizarConteoRef').style.display = 'none';
      document.getElementById('crBarra').style.display = 'none';
      ocultarAlerta('crAlerta');
      break;
  }
}

function mostrarAlerta(idAlerta, mensaje, tipo) {
  const alerta = document.getElementById(idAlerta);
  alerta.className = 'alerta-custom alerta-' + tipo;
  alerta.textContent = mensaje;
  alerta.style.display = 'block';
  
  setTimeout(() => {
    alerta.style.display = 'none';
  }, 5000);
}

function ocultarAlerta(idAlerta) {
  const alerta = document.getElementById(idAlerta);
  if (alerta) {
    alerta.style.display = 'none';
  }
}

function mostrarCargando(mostrar) {
  document.getElementById('loadingSpinner').style.display = mostrar ? 'block' : 'none';
}

function marcarCambios() {
  cambiosPendientes = true;
}

// ========================================
// 📸 ESCÁNER UNIVERSAL - VERSIÓN CORREGIDA PARA TABLETS
// ========================================

let html5QrCode = null;
let scannerActivo = false;

function abrirScanner(campoDestino) {
  console.log("📷 Abriendo escáner para:", campoDestino);
  
  const modal = document.getElementById('scannerModal');
  const readerContainer = document.getElementById('reader');
  
  // Limpiar el contenedor antes de iniciar
  readerContainer.innerHTML = '';
  
  // Mostrar modal con mensaje de carga
  modal.style.display = 'flex';
  readerContainer.innerHTML = `
    <div style="padding: 50px; text-align: center; background: #222; color: white;">
      <i class="fas fa-spinner fa-spin" style="font-size: 48px; margin-bottom: 15px;"></i>
      <p>Iniciando cámara...</p>
      <p style="font-size: 12px; color: #999;">Si no aparece la imagen, verifica los permisos de cámara</p>
    </div>
  `;
  
  // Si ya hay un escáner activo, cerrarlo primero
  if (html5QrCode) {
    try {
      html5QrCode.stop().then(() => {
        html5QrCode.clear();
        html5QrCode = null;
        iniciarEscanerReal(campoDestino);
      }).catch(() => {
        html5QrCode = null;
        iniciarEscanerReal(campoDestino);
      });
    } catch (e) {
      html5QrCode = null;
      iniciarEscanerReal(campoDestino);
    }
  } else {
    iniciarEscanerReal(campoDestino);
  }
}

function iniciarEscanerReal(campoDestino) {
  const readerContainer = document.getElementById('reader');
  
  // Limpiar contenedor
  readerContainer.innerHTML = '';
  
  const config = {
    fps: 10,
    qrbox: { width: 280, height: 150 },
    aspectRatio: 1.0,
    formatsToSupport: [
      Html5QrcodeSupportedFormats.QR_CODE,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.CODE_93,
      Html5QrcodeSupportedFormats.CODABAR
    ]
  };
  
  try {
    html5QrCode = new Html5Qrcode("reader");
    scannerActivo = true;
    
    html5QrCode.start(
      { facingMode: "environment" },
      config,
      (decodedText, decodedResult) => {
        console.log(`✅ Código detectado: ${decodedText}`);
        
        // Insertar en el campo
        const input = document.getElementById(campoDestino);
        if (input) {
          input.value = decodedText.trim();
        }
        
        // Cerrar escáner
        cerrarScanner();
        
        // Reproducir sonido
        reproducirSonido('exito');
        
        // Auto-procesar según el módulo
        setTimeout(() => {
          procesarCodigoEscaneado(campoDestino, input);
        }, 100);
      },
      (errorMessage) => {
        // Silencioso - errores normales de escaneo
      }
    ).catch((err) => {
      console.error("❌ Error iniciando escáner:", err);
      scannerActivo = false;
      
      // Mostrar error en el modal pero permitir cerrar
      readerContainer.innerHTML = `
        <div style="padding: 40px; text-align: center; background: #f8d7da; color: #721c24; border-radius: 8px;">
          <i class="fas fa-exclamation-triangle" style="font-size: 48px; margin-bottom: 15px;"></i>
          <h4>Error al acceder a la cámara</h4>
          <p style="font-size: 14px; margin-top: 10px;">${err.message || err}</p>
          <div style="margin-top: 20px; font-size: 13px; color: #666; background: white; padding: 15px; border-radius: 5px; text-align: left;">
            <strong>Posibles soluciones:</strong>
            <ul style="margin: 10px 0 0 20px;">
              <li>Permite el acceso a la cámara en el navegador</li>
              <li>Usa HTTPS (no HTTP)</li>
              <li>Cierra otras apps que usen la cámara</li>
              <li>Reinicia el navegador</li>
            </ul>
          </div>
        </div>
      `;
    });
    
  } catch (e) {
    console.error("💥 Error creando escáner:", e);
    scannerActivo = false;
    
    readerContainer.innerHTML = `
      <div style="padding: 40px; text-align: center; background: #f8d7da; color: #721c24;">
        <i class="fas fa-times-circle" style="font-size: 48px; margin-bottom: 15px;"></i>
        <h4>No se pudo iniciar el escáner</h4>
        <p>${e.message || e}</p>
      </div>
    `;
  }
}

function cerrarScanner() {
  console.log("🔴 Cerrando escáner...");
  
  const modal = document.getElementById('scannerModal');
  const readerContainer = document.getElementById('reader');
  
  // SIEMPRE ocultar el modal primero (esto garantiza que el usuario pueda cerrar)
  modal.style.display = 'none';
  scannerActivo = false;
  
  // Luego intentar limpiar el escáner
  if (html5QrCode) {
    try {
      // Verificar si el escáner está corriendo
      const state = html5QrCode.getState();
      console.log("Estado del escáner:", state);
      
      if (state === Html5QrcodeScannerState.SCANNING || state === Html5QrcodeScannerState.PAUSED) {
        html5QrCode.stop()
          .then(() => {
            console.log("✅ Escáner detenido");
            try {
              html5QrCode.clear();
            } catch (e) {}
            html5QrCode = null;
          })
          .catch((err) => {
            console.warn("⚠️ Error al detener escáner:", err);
            html5QrCode = null;
          });
      } else {
        // No está escaneando, solo limpiar
        try {
          html5QrCode.clear();
        } catch (e) {}
        html5QrCode = null;
      }
    } catch (e) {
      console.warn("⚠️ Error verificando estado:", e);
      html5QrCode = null;
    }
  }
  
  // Limpiar el contenedor del reader
  if (readerContainer) {
    readerContainer.innerHTML = '';
  }
  
  console.log("✅ Modal cerrado");
}

function procesarCodigoEscaneado(campoDestino, input) {
  switch(campoDestino) {
    case 'verificarCodigoInput':
      agregarCodigoVerificacionMejorado();
      break;
    case 'verificarUbicacionInput':
      cargarUbicacionParaVerificar();
      break;
    case 'buscarInput':
      buscarCodigoGlobal();
      break;
    case 'codigoAsignacion':
      document.getElementById('ubicacionAsignacion').focus();
      break;
    case 'ubicacionAsignacion':
      asignarUbicacionGlobal();
      break;
    case 'recepcionCodigoInput':
      agregarARecepcionGlobal();
      break;
    case 'auditoriaCodigoInput':
      buscarParaAuditoriaGlobal();
      break;
    case 'editarCodigoInput':
      buscarParaEditarGlobal();
      break;
    case 'ubicacionInput':
      buscarUbicacion();
      break;
    case 'porUbicarInput':
      guardarUbicacionActual();
      break;
    case 'conteoCodigoInput':
      agregarCodigoConteoFisico();
      break;
    case 'conteoUbicacionInput':
      cargarUbicacionParaConteo();
      break;
    default:
      // Intentar disparar Enter
      if (input) {
        const event = new KeyboardEvent('keypress', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true
        });
        input.dispatchEvent(event);
      }
  }
}
// ========================================
// 🔍 BÚSQUEDA
// ========================================

function buscarCodigoGlobal() {
  const codigo = document.getElementById('buscarInput').value.trim();
  
  if (!codigo) {
    mostrarAlerta('buscarAlerta', 'Ingresa un código', 'warning');
    return;
  }
  
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      mostrarResultadosBusqueda(respuesta);
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('buscarAlerta', 'Error: ' + error, 'error');
    })
    .buscarCodigo(codigo);
}

function mostrarResultadosBusqueda(respuesta) {
  const container = document.getElementById('buscarResultados');
  
  if (respuesta.manualReview) {
    mostrarAlerta('buscarAlerta', '⚠️ ' + respuesta.info + ' - Código: ' + respuesta.cleanedCode, 'warning');
  }
  
  if (respuesta.count === 0) {
    container.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No se encontraron resultados para: <strong>' + respuesta.cleanedCode + '</strong></p>';
    return;
  }
  
  let html = '<h4 style="margin-top: 15px; margin-bottom: 10px;">Resultados (' + respuesta.count + '):</h4>';
  
  respuesta.resultados.forEach(item => {
    html += `
      <div class="resultado-item">
        <div style="font-weight: 800; font-size: 16px; color: #1d66c3; margin-bottom: 5px;">${item['Código']}</div>
        <div style="margin-bottom: 5px;"><strong>Descripción:</strong> ${item['Descripción'] || 'N/A'}</div>
        <div style="margin-bottom: 5px;"><strong>Marca:</strong> ${item['Marca'] || 'N/A'}</div>
        ${item['Último Inventario'] ? `<div style="margin-bottom: 5px; color: #155724; background-color: #d4edda; border: 1px solid #c3e6cb; padding: 4px 8px; border-radius: 6px; font-weight: 700; font-size: 12px; display: inline-block;"><i class="fas fa-check-circle"></i> Últ. Inventario: ${item['Último Inventario']}</div>` : ''}
        <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 4px;">
  ${item['Ubicación Principal'] ? '<span class="item-ubicacion-badge">📍 ' + item['Ubicación Principal'] + '</span>' : '<span class="item-ubicacion-badge empty">Sin ubicación</span>'}
  ${item['Ubicación 2'] ? '<span class="item-ubicacion-badge">📍 ' + item['Ubicación 2'] + '</span>' : ''}
  ${item['Ubicación 3'] ? '<span class="item-ubicacion-badge">📍 ' + item['Ubicación 3'] + '</span>' : ''}
  ${item['Ubicación 4'] ? '<span class="item-ubicacion-badge">📍 ' + item['Ubicación 4'] + '</span>' : ''}
  ${item['Ubicación 5'] ? '<span class="item-ubicacion-badge">📍 ' + item['Ubicación 5'] + '</span>' : ''}
</div>
      </div>
    `;
  });
  
  container.innerHTML = html;
}

// ========================================
// 📍 UBICACIONES
// ========================================

function buscarUbicacion() {
  const ubicacion = document.getElementById('ubicacionInput').value.trim();
  
  if (!ubicacion) {
    mostrarAlerta('ubicacionAlerta', 'Ingresa una ubicación', 'warning');
    return;
  }
  
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      
      // 🆕 Mostrar si se normalizó la ubicación
      if (respuesta.ubicacionOriginal !== respuesta.ubicacion) {
        mostrarAlerta('ubicacionAlerta', 
          `📍 Ubicación normalizada: ${respuesta.ubicacionOriginal} → ${respuesta.ubicacion}`, 
          'info');
      }
      
      mostrarResultadosUbicacion(respuesta);
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('ubicacionAlerta', 'Error: ' + error, 'error');
    })
    .buscarPorUbicacion(ubicacion);
}

function mostrarResultadosUbicacion(respuesta) {
  const container = document.getElementById('ubicacionResultados');
  
  if (respuesta.count === 0) {
    container.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">Ubicación vacía: <strong>' + respuesta.ubicacion + '</strong></p>';
    document.getElementById('btnAgregarUbicacion').style.display = 'block';
    return;
  }
  
  let html = '<h4 style="margin-top: 15px; margin-bottom: 10px;">Códigos en ' + respuesta.ubicacion + ' (' + respuesta.count + '):</h4>';
  
  respuesta.resultados.forEach(item => {
    html += `
      <div class="resultado-item">
        <div style="font-weight: 800; font-size: 16px; color: #1d66c3;">${item['Código']}</div>
        <div>${item['Descripción'] || 'N/A'}</div>
        <div style="color: #666; font-size: 14px;">${item['Marca'] || 'N/A'}</div>
        ${item['Último Inventario'] ? `<div style="margin-top: 5px; color: #155724; background-color: #d4edda; border: 1px solid #c3e6cb; padding: 4px 8px; border-radius: 4px; font-weight: 700; font-size: 12px; display: inline-block;"><i class="fas fa-check-circle"></i> Últ. Inventario: ${item['Último Inventario']}</div>` : ''}
      </div>
    `;
  });
  
  container.innerHTML = html;
  document.getElementById('btnAgregarUbicacion').style.display = 'block';
}

function prepararAgregarCodigo() {
  const ubicacion = document.getElementById('ubicacionInput').value.trim();
  showModulo('asignacion');
  document.getElementById('ubicacionAsignacion').value = ubicacion;
}

// ========================================
// 📋 ÍNDICE DE UBICACIONES
// ========================================

function filtrarUbicacionesIndice() {
  const zona = document.getElementById('filtroZona').value;
  
  if (!zona) {
    mostrarAlerta('indiceAlerta', 'Selecciona una zona', 'warning');
    return;
  }
  
  const filtros = {
    zona: zona,
    pasillo: document.getElementById('filtroPasillo').value,
    anaquel: document.getElementById('filtroAnaquel').value.toUpperCase(),
    rack: document.getElementById('filtroRack').value,
    nivel: document.getElementById('filtroNivel').value.toUpperCase(),
    estado: document.getElementById('filtroEstado').value
  };
  
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      if (respuesta.success) {
        mostrarResultadosIndice(respuesta.resultados, respuesta.count);
      } else {
        mostrarAlerta('indiceAlerta', 'Error: ' + (respuesta.message || 'Desconocido'), 'error');
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('indiceAlerta', 'Error de conexión: ' + error, 'error');
    })
    .filtrarUbicaciones(filtros);
}

function mostrarResultadosIndice(ubicaciones, count) {
  const container = document.getElementById('indiceResultados');
  
  if (count === 0) {
    container.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No se encontraron ubicaciones con esos filtros</p>';
    return;
  }
  
  let html = `<h4 style="margin-top: 15px; margin-bottom: 10px;">📦 ${count} Ubicaciones encontradas:</h4>`;
  
  ubicaciones.forEach(ub => {
    const ubicacionStr = ub.Ubicacion || ub['Ubicación'] || `${ub.Zona}-${ub.Pasillo}-${ub.Anaquel}-${ub.Rack}-${ub.Nivel}`;
    const estadoStr = ub.Estado || 'Activa';
    const estadoColor = estadoStr === 'Activa' ? '#28a745' : '#dc3545';
    const estadoIcono = estadoStr === 'Activa' ? '✅' : '❌';
    
    html += `
      <div class="resultado-item" style="border-left: 4px solid ${estadoColor};">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
          <div>
            <div style="font-weight: 800; font-size: 18px; color: #1d66c3;">${ubicacionStr}</div>
            <div style="font-size: 12px; color: #666; margin-top: 3px;">
              Zona: ${ub.Zona || '-'} | Pasillo: ${ub.Pasillo || '-'} | Anaquel: ${ub.Anaquel || '-'} | Rack: ${ub.Rack || '-'} | Nivel: ${ub.Nivel || '-'}
            </div>
          </div>
          <span style="background: ${estadoColor}; color: white; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 700;">
            ${estadoIcono} ${estadoStr}
          </span>
        </div>
        
        <div style="background: #f8f9fa; padding: 10px; border-radius: 6px; margin-top: 10px;">
          <div style="font-weight: 700; margin-bottom: 5px;">
            📦 Códigos en esta ubicación (${ub.cantidadCodigos || 0}):
          </div>
          ${mostrarCodigosUbicacion(ub.codigos || [], ubicacionStr)}
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
}

function mostrarCodigosUbicacion(codigos, ubicacion) {
  if (!codigos || codigos.length === 0) {
    return `
      <div style="text-align: center; padding: 10px; color: #999;">
        <i class="fas fa-inbox"></i> Ubicación vacía
        <button onclick="asignarAUbicacion('${ubicacion}')" style="display: block; width: 100%; margin-top: 10px; background: #28a745; color: white; border: none; padding: 8px; border-radius: 5px; cursor: pointer;">
          <i class="fas fa-plus"></i> Agregar código aquí
        </button>
      </div>
    `;
  }
  
  let html = '<div style="display: flex; flex-direction: column; gap: 5px;">';
  
  codigos.slice(0, 10).forEach(codigo => {
    const codigoStr = codigo.Codigo || codigo['Código'] || '';
    const descripcionStr = codigo.Descripcion || codigo['Descripción'] || '';
    
    html += `
      <div style="background: white; padding: 8px; border-radius: 4px; border: 1px solid #e0e0e0;">
        <span style="font-weight: 700; color: #1d66c3;">${codigoStr}</span>
        <span style="color: #666; font-size: 12px; margin-left: 8px;">${descripcionStr}</span>
      </div>
    `;
  });
  
  if (codigos.length > 10) {
    html += `<div style="text-align: center; color: #999; font-size: 12px; margin-top: 5px;">+ ${codigos.length - 10} más</div>`;
  }
  
  html += `
    <button onclick="asignarAUbicacion('${ubicacion}')" style="width: 100%; margin-top: 10px; background: #1d66c3; color: white; border: none; padding: 8px; border-radius: 5px; cursor: pointer;">
      <i class="fas fa-plus"></i> Agregar más códigos
    </button>
  </div>`;
  
  return html;
}

function asignarAUbicacion(ubicacion) {
  showModulo('asignacion');
  document.getElementById('ubicacionAsignacion').value = ubicacion;
  document.getElementById('codigoAsignacion').focus();
}
// ========================================
// 🆕 CREAR NUEVA UBICACIÓN - FRONTEND
// ========================================

function mostrarFormularioNuevaUbicacion() {
  const html = `
    <div style="background: #e8f5e9; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
      <p style="margin: 0; color: #2e7d32; font-size: 14px;">
        <i class="fas fa-info-circle"></i>
        Las ubicaciones siguen el formato: <strong>ZONA-PASILLO-ANAQUEL-RACK-NIVEL</strong>
        <br>Ejemplo: <strong>B-1-A-01-A</strong>
      </p>
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Zona (Requerido) *</label>
      <select id="nuevaUbZona" class="input-custom" onchange="previsualizarUbicacion()">
        <option value="">Selecciona...</option>
        <option value="A">A</option>
        <option value="B">B</option>
        <option value="C">C</option>
        <option value="D">D</option>
        <option value="E">E</option>
        <option value="F">F</option>
      </select>
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Pasillo (Requerido) *</label>
      <input type="number" id="nuevaUbPasillo" class="input-custom" placeholder="Ej: 1" min="1" max="99" onchange="previsualizarUbicacion()">
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Anaquel (Requerido) *</label>
      <input type="text" id="nuevaUbAnaquel" class="input-custom" placeholder="Ej: A" maxlength="1" style="text-transform: uppercase;" onchange="previsualizarUbicacion()">
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Rack (Requerido) *</label>
      <input type="number" id="nuevaUbRack" class="input-custom" placeholder="Ej: 01" min="1" max="99" onchange="previsualizarUbicacion()">
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Nivel (Requerido) *</label>
      <input type="text" id="nuevaUbNivel" class="input-custom" placeholder="Ej: A" maxlength="1" style="text-transform: uppercase;" onchange="previsualizarUbicacion()">
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Estado</label>
      <select id="nuevaUbEstado" class="input-custom">
        <option value="Activa">✅ Activa</option>
        <option value="Inactiva">❌ Inactiva</option>
      </select>
    </div>
    
    <div id="previsualizacionUbicacion" style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin-top: 15px; display: none;">
      <strong style="color: #1d66c3;">Vista Previa de la Ubicación:</strong>
      <div style="font-size: 24px; font-weight: 800; color: #1d66c3; margin-top: 8px;" id="previsualizacionTexto">
        -
      </div>
    </div>
  `;
  
  mostrarModal(
    '➕ Crear Nueva Ubicación',
    'Completa los datos de la nueva ubicación:',
    html,
    [
      { texto: 'Cancelar', clase: 'modal-btn-secondary', callback: cerrarModal },
      { 
        texto: 'Crear Ubicación', 
        clase: 'modal-btn-success', 
        callback: () => ejecutarCrearUbicacion()
      }
    ]
  );
  
setTimeout(() => {
  // Ocultar el input simple
  document.getElementById('modalInput').style.display = 'none';
  
  // Mostrar y llenar el contenedor HTML
  const htmlContainer = document.getElementById('modalHtmlContent');
  htmlContainer.style.display = 'block';
  htmlContainer.innerHTML = html;
}, 100);
}

function previsualizarUbicacion() {
  const zona = document.getElementById('nuevaUbZona').value.toUpperCase();
  const pasillo = document.getElementById('nuevaUbPasillo').value;
  const anaquel = document.getElementById('nuevaUbAnaquel').value.toUpperCase();
  const rack = document.getElementById('nuevaUbRack').value.padStart(2, '0');
  const nivel = document.getElementById('nuevaUbNivel').value.toUpperCase();
  
  const preview = document.getElementById('previsualizacionUbicacion');
  const texto = document.getElementById('previsualizacionTexto');
  
  if (zona && pasillo && anaquel && rack && nivel) {
    const ubicacionCompleta = `${zona}-${pasillo}-${anaquel}-${rack}-${nivel}`;
    texto.textContent = ubicacionCompleta;
    preview.style.display = 'block';
  } else {
    preview.style.display = 'none';
  }
}

function ejecutarCrearUbicacion() {
  const zona = document.getElementById('nuevaUbZona').value.toUpperCase().trim();
  const pasillo = document.getElementById('nuevaUbPasillo').value.trim();
  const anaquel = document.getElementById('nuevaUbAnaquel').value.toUpperCase().trim();
  const rack = document.getElementById('nuevaUbRack').value.trim();
  const nivel = document.getElementById('nuevaUbNivel').value.toUpperCase().trim();
  const estado = document.getElementById('nuevaUbEstado').value;
  
  // Validar que todos los campos estén completos
  if (!zona || !pasillo || !anaquel || !rack || !nivel) {
    alert('❌ Todos los campos son obligatorios');
    return;
  }
  
  // Validar formato
  if (anaquel.length !== 1 || !/^[A-Z]$/.test(anaquel)) {
    alert('❌ El anaquel debe ser una sola letra (A-Z)');
    return;
  }
  
  if (nivel.length !== 1 || !/^[A-Z]$/.test(nivel)) {
    alert('❌ El nivel debe ser una sola letra (A-Z)');
    return;
  }
  
  if (isNaN(pasillo) || parseInt(pasillo) < 1) {
    alert('❌ El pasillo debe ser un número mayor a 0');
    return;
  }
  
  if (isNaN(rack) || parseInt(rack) < 1) {
    alert('❌ El rack debe ser un número mayor a 0');
    return;
  }
  
  const datosUbicacion = {
    zona: zona,
    pasillo: pasillo,
    anaquel: anaquel,
    rack: rack.padStart(2, '0'), // Agregar cero inicial si es necesario
    nivel: nivel,
    estado: estado
  };
  
  cerrarModal();
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      
      if (respuesta.success) {
        mostrarAlerta('indiceAlerta', `✅ ${respuesta.message}: ${respuesta.ubicacion}`, 'success');
        
        // Opcional: Recargar la lista de ubicaciones
        setTimeout(() => {
          filtrarUbicacionesIndice();
        }, 1500);
      } else {
        mostrarAlerta('indiceAlerta', '❌ Error: ' + respuesta.message, 'error');
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('indiceAlerta', '❌ Error de conexión: ' + error, 'error');
    })
    .crearNuevaUbicacion(datosUbicacion);
}

// ========================================
// 🎯 ASIGNAR UBICACIÓN
// ========================================

function procesarCodigoManualAsignacion() {
  const codigo = document.getElementById('codigoAsignacion').value.trim();
  if (codigo) {
    asignarUbicacionGlobal();
  }
}

function asignarUbicacionGlobal() {
  const codigo = document.getElementById('codigoAsignacion').value.trim();
  const ubicacion = document.getElementById('ubicacionAsignacion').value.trim();
  
  if (!codigo || !ubicacion) {
    mostrarAlerta('asignacionAlerta', 'Completa ambos campos', 'warning');
    return;
  }
  
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      if (respuesta.success) {
        mostrarAlerta('asignacionAlerta', respuesta.message, 'success');
        document.getElementById('codigoAsignacion').value = '';
        document.getElementById('ubicacionAsignacion').value = '';
      } else {
        if (respuesta.requiereConsolidacion) {
          mostrarAlerta('asignacionAlerta', respuesta.message + ' Ubicaciones: ' + respuesta.ubicaciones.join(', '), 'warning');
        } else {
          mostrarAlerta('asignacionAlerta', respuesta.message, 'error');
        }
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('asignacionAlerta', 'Error: ' + error, 'error');
    })
    .asignarUbicacionCodigo(codigo, ubicacion);
}

// ========================================
// 📊 DASHBOARD ESTADO DE UBICACIONES
// ========================================

function cargarDashboard() {
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(stats => {
      mostrarCargando(false);
      mostrarEstadisticasDashboard(stats);
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      console.error('Error cargando dashboard:', error);
    })
    .obtenerEstadisticasDashboard();
  
  cargarRepuestosConUbicacion();
  cargarRepuestosSinUbicacion();
}

function mostrarEstadisticasDashboard(stats) {
  const html = `
    <div class="stat-card">
      <div class="stat-value">${stats.totalRepuestos}</div>
      <div class="stat-label">Total Repuestos</div>
    </div>
    <div class="stat-card" style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%);">
      <div class="stat-value">${stats.conUbicacion}</div>
      <div class="stat-label">Con Ubicación</div>
    </div>
    <div class="stat-card" style="background: linear-gradient(135deg, #dc3545 0%, #c82333 100%);">
      <div class="stat-value">${stats.sinUbicacion}</div>
      <div class="stat-label">Sin Ubicación</div>
    </div>
    <div class="stat-card" style="background: linear-gradient(135deg, #17a2b8 0%, #00bcd4 100%);">
      <div class="stat-value">${stats.porcentajeUbicados}%</div>
      <div class="stat-label">% Ubicados</div>
    </div>
  `;
  
  document.getElementById('statsContainer').innerHTML = html;
}

function cargarRepuestosConUbicacion() {
  google.script.run
    .withSuccessHandler(repuestos => {
      mostrarListaConUbicacion(repuestos);
    })
    .obtenerRepuestosConUbicacion();
}

function cargarRepuestosSinUbicacion() {
  google.script.run
    .withSuccessHandler(repuestos => {
      mostrarListaSinUbicacion(repuestos);
    })
    .obtenerRepuesosSinUbicacion();
}

function mostrarListaConUbicacion(repuestos) {
  const container = document.getElementById('listaConUbicacion');
  
  if (repuestos.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #999;">No hay repuestos con ubicación</p>';
    return;
  }
  
  let html = '';
  repuestos.slice(0, 50).forEach(item => {
    html += `
      <div class="resultado-item">
        <div style="font-weight: 800; color: #1d66c3;">${item['Código']}</div>
        <div style="font-size: 14px;">${item['Descripción'] || 'N/A'}</div>
        <div style="display: flex; gap: 5px; margin-top: 5px;">
          <span class="item-ubicacion-badge">${item['Ubicación Principal']}</span>
          ${item['Ubicación 2'] ? '<span class="item-ubicacion-badge">' + item['Ubicación 2'] + '</span>' : ''}
          ${item['Ubicación 3'] ? '<span class="item-ubicacion-badge">' + item['Ubicación 3'] + '</span>' : ''}
        </div>
      </div>
    `;
  });
  
  if (repuestos.length > 50) {
    html += '<p style="text-align: center; color: #999; margin-top: 10px;">Mostrando primeros 50 de ' + repuestos.length + '</p>';
  }
  
  container.innerHTML = html;
}

function mostrarListaSinUbicacion(repuestos) {
  const container = document.getElementById('listaSinUbicacionDash');
  
  if (repuestos.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #999;">✅ Todos los repuestos tienen ubicación</p>';
    return;
  }
  
  let html = '';
  repuestos.slice(0, 50).forEach(item => {
    html += `
      <div class="resultado-item" onclick="asignarUbicacionDesdeEstado('${item['Código']}')">
        <div style="font-weight: 800; color: #dc3545;">${item['Código']}</div>
        <div style="font-size: 14px;">${item['Descripción'] || 'N/A'}</div>
        <span class="item-ubicacion-badge empty">❌ Sin ubicación - Click para asignar</span>
      </div>
    `;
  });
  
  if (repuestos.length > 50) {
    html += '<p style="text-align: center; color: #999; margin-top: 10px;">Mostrando primeros 50 de ' + repuestos.length + '</p>';
  }
  
  container.innerHTML = html;
}

function asignarUbicacionDesdeEstado(codigo) {
  showModulo('asignacion');
  document.getElementById('codigoAsignacion').value = codigo;
}

function mostrarTabDashboard(tab) {
  document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');
  
  if (tab === 'con-ubicacion') {
    document.getElementById('tab-con-ubicacion').style.display = 'block';
    document.getElementById('tab-sin-ubicacion').style.display = 'none';
  } else {
    document.getElementById('tab-con-ubicacion').style.display = 'none';
    document.getElementById('tab-sin-ubicacion').style.display = 'block';
  }
}

// ========================================
// ✅ VERIFICAR UBICACIÓN - INTERFAZ MEJORADA
// ========================================

function cargarUbicacionParaVerificar() {
  const ubicacion = document.getElementById('verificarUbicacionInput').value.trim();
  
  if (!ubicacion) {
    mostrarAlerta('verificarAlerta', 'Ingresa una ubicación', 'warning');
    return;
  }
  
  // Si ya hay una verificación en progreso de OTRA ubicación
  if (hayVerificacionEnProgreso() && datosVerificacion.ubicacion.toUpperCase() !== ubicacion.toUpperCase()) {
    mostrarModalConfirmacionLimpiar(
      '⚠️ Verificación en progreso',
      `Ya tienes una verificación activa en <strong>${datosVerificacion.ubicacion}</strong> con <strong>${datosVerificacion.codigosEncontrados.length}</strong> códigos validados.<br><br>¿Deseas abandonarla y empezar con <strong>${ubicacion}</strong>?`,
      () => {
        datosVerificacion = { ubicacion: '', codigosEsperados: [], codigosEncontrados: [], intrusosData: [], datosCompletos: [] };
        ejecutarCargaUbicacion(ubicacion);
      }
    );
    return;
  }
  
  ejecutarCargaUbicacion(ubicacion);
}

function ejecutarCargaUbicacion(ubicacion) {
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      if (respuesta.count > 0) {
        datosVerificacion.ubicacion = respuesta.ubicacion || ubicacion;
        datosVerificacion.codigosEsperados = respuesta.resultados.map(r => r['Código']);
        datosVerificacion.codigosEncontrados = [];
        datosVerificacion.intrusosData = [];
        datosVerificacion.datosCompletos = respuesta.resultados;
        mostrarInterfazVerificacionMejorada(respuesta.resultados);
      } else {
        mostrarAlerta('verificarAlerta', 'Ubicación vacía o no existe', 'warning');
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('verificarAlerta', 'Error: ' + error, 'error');
    })
    .buscarPorUbicacion(ubicacion);
}

function mostrarInterfazVerificacionMejorada(codigosEsperados) {
  let html = `
    <div style="background: #e8f5e9; padding: 15px; border-radius: 8px; margin-top: 15px;">
      <h4 style="color: #2e7d32; margin-bottom: 10px;">📦 Verificando: ${datosVerificacion.ubicacion}</h4>
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; font-size: 14px;">
        <div><strong>Esperados:</strong> <span id="contadorEsperados">${codigosEsperados.length}</span></div>
        <div><strong>Validados:</strong> <span id="contadorValidados" style="color: #28a745; font-weight: bold;">0</span></div>
        <div><strong>Pendientes:</strong> <span id="contadorPendientes" style="color: #ffc107; font-weight: bold;">${codigosEsperados.length}</span></div>
      </div>
    </div>
    
    <div style="margin-top: 20px;">
      <div class="input-group-custom">
        <label class="mb-2" style="font-weight: 700;">Escanea códigos encontrados</label>
        <input type="text" id="verificarCodigoInput" class="input-custom" placeholder="Código" autofocus onkeypress="if(event.key==='Enter') agregarCodigoVerificacionMejorado()">
      </div>
      <button class="btn-primary-custom" onclick="abrirScanner('verificarCodigoInput')">
        <i class="fas fa-barcode"></i> Escanear
      </button>
    </div>
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 30px;">
      <!-- COLUMNA IZQUIERDA: CÓDIGOS ESPERADOS -->
      <div>
        <h4 style="color: #1d66c3; margin-bottom: 15px; display: flex; align-items: center; gap: 10px;">
          <i class="fas fa-clipboard-list"></i> 
          Códigos Esperados (${codigosEsperados.length})
        </h4>
        <div id="listaCodigosEsperados" style="max-height: 500px; overflow-y: auto;"></div>
      </div>
      
      <!-- COLUMNA DERECHA: INTRUSOS -->
      <div>
        <h4 style="color: #dc3545; margin-bottom: 15px; display: flex; align-items: center; gap: 10px;">
          <i class="fas fa-exclamation-triangle"></i> 
          Intrusos (<span id="contadorIntrusos">0</span>)
        </h4>
        <div id="listaIntrusos" style="max-height: 500px; overflow-y: auto;">
          <p style="text-align: center; color: #999; padding: 40px;">No se han detectado intrusos</p>
        </div>
      </div>
    </div>
  `;
  
  document.getElementById('verificarResultados').innerHTML = html;
  document.getElementById('btnFinalizarVerificacion').style.display = 'block';
  
  // Renderizar lista inicial de códigos esperados
  renderizarCodigosEsperados(codigosEsperados);
}

function renderizarCodigosEsperados(codigos) {
  const container = document.getElementById('listaCodigosEsperados');
  let html = '';
  
  codigos.forEach((item, index) => {
    const codigo = item['Código'];
    const descripcion = item['Descripción'] || '';
    const encontrado = datosVerificacion.codigosEncontrados.includes(codigo);
    
    html += `
      <div id="esperado-${index}" style="
        background: ${encontrado ? '#e8f5e9' : '#ffffff'};
        border: 2px solid ${encontrado ? '#28a745' : '#ddd'};
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 10px;
        display: flex;
        align-items: start;
        gap: 12px;
        transition: all 0.3s ease;
      ">
        <div style="flex-shrink: 0; margin-top: 2px;">
          ${encontrado 
            ? '<i class="fas fa-check-circle" style="color: #28a745; font-size: 24px;"></i>'
            : '<i class="far fa-circle" style="color: #ddd; font-size: 24px;"></i>'
          }
        </div>
        <div style="flex: 1;">
          <div style="font-weight: 800; font-size: 15px; color: ${encontrado ? '#28a745' : '#1d66c3'}; margin-bottom: 4px;">
            ${codigo}
          </div>
          <div style="font-size: 13px; color: #666;">
            ${descripcion}
          </div>
          ${encontrado 
            ? '<div style="margin-top: 8px;"><span style="background: #28a745; color: white; padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 700;"><i class="fas fa-check"></i> VALIDADO</span></div>'
            : ''
          }
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
}

function renderizarIntrusos() {
  const container = document.getElementById('listaIntrusos');
  
  if (datosVerificacion.intrusosData.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">✅ No se han detectado intrusos</p>';
    return;
  }
  
  let html = '';
  
  datosVerificacion.intrusosData.forEach((intruso, index) => {
    html += `
      <div style="
        background: #fff3cd;
        border: 2px solid #ffc107;
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 10px;
      ">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
          <div style="flex: 1;">
            <div style="font-weight: 800; font-size: 15px; color: #dc3545; margin-bottom: 4px;">
              🚨 ${intruso.codigo}
            </div>
            <div style="font-size: 13px; color: #666; margin-bottom: 8px;">
              ${intruso.descripcion || 'Código no registrado en sistema'}
            </div>
          </div>
          <button onclick="eliminarIntruso(${index})" style="
            background: #dc3545;
            color: white;
            border: none;
            padding: 6px 10px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 12px;
          ">
            <i class="fas fa-times"></i>
          </button>
        </div>
        
        <div style="background: #fff; padding: 10px; border-radius: 5px; margin-bottom: 10px;">
          <p style="margin: 0 0 8px 0; font-size: 12px; color: #666;">
            <strong>¿Qué hacer con este código?</strong>
          </p>
          <div style="display: flex; gap: 5px; flex-wrap: wrap;">
            <button onclick="gestionarIntruso(${index}, 'AGREGAR_A_UBICACION')" style="
              background: #28a745;
              color: white;
              border: none;
              padding: 6px 12px;
              border-radius: 5px;
              cursor: pointer;
              font-size: 11px;
              font-weight: 700;
            ">
              <i class="fas fa-plus"></i> Agregar a Ubicación
            </button>
            <button onclick="gestionarIntruso(${index}, 'MARCAR_VALIDO')" style="
              background: #17a2b8;
              color: white;
              border: none;
              padding: 6px 12px;
              border-radius: 5px;
              cursor: pointer;
              font-size: 11px;
              font-weight: 700;
            ">
              <i class="fas fa-check"></i> Marcar Válido
            </button>
            <button onclick="gestionarIntruso(${index}, 'IGNORAR')" style="
              background: #6c757d;
              color: white;
              border: none;
              padding: 6px 12px;
              border-radius: 5px;
              cursor: pointer;
              font-size: 11px;
              font-weight: 700;
            ">
              <i class="fas fa-eye-slash"></i> Ignorar
            </button>
          </div>
        </div>
        
        <div style="font-size: 11px; color: #999; margin-top: 8px;">
          <i class="fas fa-info-circle"></i> 
          <strong>Agregar:</strong> Actualiza inventario | 
          <strong>Marcar:</strong> Solo registra como válido | 
          <strong>Ignorar:</strong> Mantiene como intruso
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
  document.getElementById('contadorIntrusos').textContent = datosVerificacion.intrusosData.length;
}

function agregarCodigoVerificacionMejorado() {
  const input = document.getElementById('verificarCodigoInput');
  const codigo = input.value.trim();
  
  // 🆕 LIMPIAR INPUT INMEDIATAMENTE
  input.value = '';
  input.focus();
  
  if (!codigo) return;
  
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      const codigoLimpio = respuesta.cleanedCode;
      
      // Verificar si ya fue escaneado
      if (datosVerificacion.codigosEncontrados.includes(codigoLimpio)) {
        mostrarAlerta('verificarAlerta', '⚠️ Código ya escaneado', 'warning');
        return;
      }
      
      // Verificar si es un código esperado
      const esEsperado = datosVerificacion.codigosEsperados.includes(codigoLimpio);
      
      if (esEsperado) {
        // ✅ CÓDIGO VÁLIDO
        datosVerificacion.codigosEncontrados.push(codigoLimpio);
        actualizarContadores();
        
        // 🆕 RE-RENDERIZAR LA LISTA CON CHECKMARKS
       renderizarCodigosEsperados(datosVerificacion.datosCompletos);
        
        mostrarAlerta('verificarAlerta', '✅ Código validado: ' + codigoLimpio, 'success');
        reproducirSonido('exito');
        
      } else {
        // 🚨 INTRUSO DETECTADO
        google.script.run
          .withSuccessHandler(validacion => {
            if (validacion.esValidado) {
              // Ya fue validado antes
              datosVerificacion.codigosEncontrados.push(codigoLimpio);
              actualizarContadores();
              
              // 🆕 RE-RENDERIZAR LA LISTA
             renderizarCodigosEsperados(datosVerificacion.datosCompletos);
              
              mostrarAlerta('verificarAlerta', `✅ ${codigoLimpio} (Validado previamente)`, 'success');
              reproducirSonido('exito');
            } else {
              // Nuevo intruso
              datosVerificacion.intrusosData = datosVerificacion.intrusosData || [];
              datosVerificacion.intrusosData.push({
                codigo: codigoLimpio,
                descripcion: respuesta.count > 0 ? respuesta.resultados[0]['Descripción'] : '',
                accionTomada: null
              });
              renderizarIntrusos();
              mostrarAlerta('verificarAlerta', '🚨 INTRUSO detectado: ' + codigoLimpio, 'error');
              reproducirSonido('error');
            }
          })
          .verificarSiIntrusoEsValido(datosVerificacion.ubicacion, codigoLimpio);
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      alert('Error: ' + error);
    })
    .buscarCodigoVerificacion(codigo);
}
function gestionarIntruso(index, accion) {
  const intruso = datosVerificacion.intrusosData[index];
  const session = usuarioActual;
  
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      
      if (respuesta.success) {
  intruso.accionTomada = accion;
  
  if (accion === 'AGREGAR_A_UBICACION') {
    mostrarAlerta('verificarAlerta', '✅ ' + respuesta.message, 'success');
  } else if (accion === 'MARCAR_VALIDO') {
    mostrarAlerta('verificarAlerta', '✅ ' + respuesta.message, 'success');
  } else {
    mostrarAlerta('verificarAlerta', respuesta.message, 'info');
  }
        
        // Remover de la lista de intrusos
        datosVerificacion.intrusosData.splice(index, 1);
        renderizarIntrusos();
      } else {
        mostrarAlerta('verificarAlerta', 'Error: ' + respuesta.message, 'error');
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('verificarAlerta', 'Error: ' + error, 'error');
    })
    .validarIntruso(datosVerificacion.ubicacion, intruso.codigo, accion, session.email);
}

function eliminarIntruso(index) {
  if (confirm('¿Eliminar este intruso de la lista?')) {
    datosVerificacion.intrusosData.splice(index, 1);
    renderizarIntrusos();
  }
}

function actualizarContadores() {
  const validados = datosVerificacion.codigosEncontrados.length;
  const esperados = datosVerificacion.codigosEsperados.length;
  const pendientes = esperados - validados;
  
  document.getElementById('contadorValidados').textContent = validados;
  document.getElementById('contadorPendientes').textContent = pendientes;
}

function finalizarVerificacion() {
  const validados = datosVerificacion.codigosEncontrados.length;
  const esperados = datosVerificacion.codigosEsperados.length;
  const ausentes = esperados - validados;
  const intrusosSinGestionar = datosVerificacion.intrusosData.filter(i => !i.accionTomada).length;
  
  // 🆕 VALIDAR UBICACIÓN VACÍA
  if (esperados === 0) {
    mostrarAlerta('verificarAlerta', '⚠️ Esta ubicación no tiene códigos esperados. No se puede verificar.', 'warning');
    return;
  }
    // 🆕 VALIDAR SIN CÓDIGOS VALIDADOS
  if (validados === 0) {
    mostrarConfirmacion(
      'Sin códigos validados',
      `⚠️ No se ha validado ningún código de ${esperados} esperados. ¿Deseas marcar esta ubicación como vacía?`,
      () => ejecutarFinalizacionVerificacion()
    );
    return;
  }
  
  // 🆕 MOSTRAR RESUMEN ANTES DE FINALIZAR
  if (ausentes > 0) {
    mostrarConfirmacion(
      'Códigos Ausentes',
      `⚠️ Hay ${ausentes} código(s) ausente(s) de ${esperados} esperados. ¿Deseas continuar?`,
      () => {
        if (intrusosSinGestionar > 0) {
          mostrarConfirmacion(
            'Intrusos Sin Gestionar',
            `Hay ${intrusosSinGestionar} intruso(s) sin gestionar. ¿Deseas finalizar de todas formas?`,
            () => ejecutarFinalizacionVerificacion()
          );
        } else {
          ejecutarFinalizacionVerificacion();
        }
      }
    );
  } else if (intrusosSinGestionar > 0) {
    mostrarConfirmacion(
      'Intrusos Sin Gestionar',
      `Hay ${intrusosSinGestionar} intruso(s) sin gestionar. ¿Deseas finalizar de todas formas?`,
      () => ejecutarFinalizacionVerificacion()
    );
  } else {
    ejecutarFinalizacionVerificacion();
  }
}

function ejecutarFinalizacionVerificacion() {
  const intrusosValidados = datosVerificacion.intrusosData
    .filter(i => i.accionTomada === 'MARCAR_VALIDO' || i.accionTomada === 'AGREGAR_A_UBICACION')
    .map(i => i.codigo);
  
  const todosLosEncontrados = [...datosVerificacion.codigosEncontrados, ...intrusosValidados];
  
  const datosFinales = {
    ubicacion: datosVerificacion.ubicacion,
    codigosEsperados: datosVerificacion.codigosEsperados,
    codigosEncontrados: todosLosEncontrados,
    sessionId: currentSessionId || localStorage.getItem('sessionId')
  };
  
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      if (respuesta.success) {
        mostrarResumenVerificacionMejorado(respuesta.metricas, respuesta.emailEnviado || false);
        setTimeout(() => limpiarModulo('verificar'), 5000);
      } else {
        mostrarAlerta('verificarAlerta', 'Error: ' + respuesta.message, 'error');
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('verificarAlerta', 'Error: ' + error, 'error');
    })
    .guardarVerificacion(datosFinales);
}

function mostrarResumenVerificacionMejorado(metricas, emailEnviado) {
  const html = `
    <div style="background: linear-gradient(135deg, #e3f2fd 0%, #e8f5e9 100%); padding: 30px; border-radius: 12px; margin-top: 20px;">
      <h3 style="color: #1d66c3; margin-bottom: 20px; text-align: center;">
        <i class="fas fa-check-circle"></i> Verificación Completada
      </h3>
      
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 20px;">
        <div style="background: white; padding: 20px; border-radius: 8px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <div style="font-size: 36px; font-weight: 800; color: #28a745; margin-bottom: 5px;">${metricas.validados}</div>
          <div style="font-size: 14px; color: #666;">✅ Validados</div>
        </div>
        <div style="background: white; padding: 20px; border-radius: 8px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <div style="font-size: 36px; font-weight: 800; color: #dc3545; margin-bottom: 5px;">${metricas.intrusos}</div>
          <div style="font-size: 14px; color: #666;">🚨 Intrusos</div>
        </div>
        <div style="background: white; padding: 20px; border-radius: 8px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <div style="font-size: 36px; font-weight: 800; color: #ffc107; margin-bottom: 5px;">${metricas.ausentes}</div>
          <div style="font-size: 14px; color: #666;">❌ Ausentes</div>
        </div>
        <div style="background: white; padding: 20px; border-radius: 8px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <div style="font-size: 36px; font-weight: 800; color: #1d66c3; margin-bottom: 5px;">${metricas.tasaExito}%</div>
          <div style="font-size: 14px; color: #666;">📈 Éxito</div>
        </div>
      </div>
      
      ${emailEnviado ? `
        <div style="background: white; padding: 15px; border-radius: 8px; text-align: center;">
          <p style="margin: 0; color: #28a745; font-size: 14px; font-weight: 700;">
            <i class="fas fa-envelope"></i> Reporte enviado por email exitosamente
          </p>
        </div>
      ` : `
        <div style="background: #fff3cd; padding: 15px; border-radius: 8px; text-align: center;">
          <p style="margin: 0; color: #856404; font-size: 14px;">
            <i class="fas fa-exclamation-triangle"></i> El reporte se guardó pero no se pudo enviar el email
          </p>
        </div>
      `}
    </div>
  `;
  
  document.getElementById('verificarResultados').innerHTML = html;
  document.getElementById('btnFinalizarVerificacion').style.display = 'none';
}

// ========================================
// 🎯 MODALES GENÉRICOS
// ========================================

function mostrarConfirmacion(titulo, mensaje, callbackConfirmar) {
  mostrarModal(
    titulo,
    mensaje,
    null,
    [
      { texto: 'Cancelar', clase: 'modal-btn-secondary', callback: cerrarModal },
      { texto: 'Confirmar', clase: 'modal-btn-danger', callback: function(e) { 
          if (e && e.target) {
            if(e.target.disabled) return;
            e.target.disabled = true;
            e.target.innerText = '⏳ Procesando...';
          }
          cerrarModal(); 
          callbackConfirmar(); 
        } 
      }
    ]
  );
}

function mostrarModal(titulo, mensaje, contenidoHTML, botones) {
  document.getElementById('modalTitle').textContent = titulo;
  document.getElementById('modalMessage').textContent = mensaje;
  
  const botonesContainer = document.getElementById('modalButtons');
  botonesContainer.innerHTML = '';
  
  botones.forEach(btn => {
    const button = document.createElement('button');
    button.className = 'modal-btn ' + btn.clase;
    button.textContent = btn.texto;
    button.onclick = btn.callback;
    botonesContainer.appendChild(button);
  });
  
  document.getElementById('modalOverlay').classList.add('active');
}

function cerrarModal() {
  document.getElementById('modalOverlay').classList.remove('active');
  
  // 🆕 Limpiar ambos contenedores
  document.getElementById('modalInput').style.display = 'none';
  document.getElementById('modalHtmlContent').style.display = 'none';
  document.getElementById('modalHtmlContent').innerHTML = '';
}
// ========================================
// 🔴 MODAL DE CONFIRMACIÓN ESTILIZADO
// ========================================

function mostrarModalConfirmacionLimpiar(titulo, mensaje, callbackConfirmar) {
  // Remover modal anterior si existe
  const existente = document.getElementById('modalConfirmacionOverlay');
  if (existente) existente.remove();
  
  const overlay = document.createElement('div');
  overlay.id = 'modalConfirmacionOverlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.75);
    z-index: 20000;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeInOverlay 0.2s ease;
  `;
  
  overlay.innerHTML = `
    <style>
      @keyframes fadeInOverlay {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideInModal {
        from { opacity: 0; transform: scale(0.9) translateY(-20px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      .modal-confirmacion-box {
        background: white;
        border-radius: 16px;
        padding: 0;
        max-width: 420px;
        width: 90%;
        box-shadow: 0 20px 60px rgba(0,0,0,0.4);
        animation: slideInModal 0.3s ease;
        overflow: hidden;
      }
      .modal-confirmacion-header {
        background: linear-gradient(135deg, #dc3545 0%, #c82333 100%);
        color: white;
        padding: 20px 25px;
        display: flex;
        align-items: center;
        gap: 15px;
      }
      .modal-confirmacion-icon {
        width: 50px;
        height: 50px;
        background: rgba(255,255,255,0.2);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
      }
      .modal-confirmacion-title {
        font-size: 1.2rem;
        font-weight: 700;
        margin: 0;
      }
      .modal-confirmacion-body {
        padding: 25px;
      }
      .modal-confirmacion-mensaje {
        background: #fff3cd;
        border-left: 4px solid #ffc107;
        padding: 15px;
        border-radius: 8px;
        margin-bottom: 20px;
      }
      .modal-confirmacion-mensaje p {
        margin: 0;
        color: #856404;
        font-size: 14px;
        line-height: 1.6;
      }
      .modal-confirmacion-tip {
        background: #e3f2fd;
        border-radius: 8px;
        padding: 12px 15px;
        display: flex;
        align-items: start;
        gap: 10px;
        margin-bottom: 20px;
      }
      .modal-confirmacion-tip i {
        color: #1d66c3;
        margin-top: 2px;
      }
      .modal-confirmacion-tip span {
        font-size: 13px;
        color: #1d66c3;
      }
      .modal-confirmacion-buttons {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
      }
      .modal-btn-cancelar {
        padding: 12px 24px;
        background: #f8f9fa;
        color: #495057;
        border: 2px solid #dee2e6;
        border-radius: 8px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s;
        font-size: 14px;
      }
      .modal-btn-cancelar:hover {
        background: #e9ecef;
        border-color: #adb5bd;
      }
      .modal-btn-confirmar {
        padding: 12px 24px;
        background: linear-gradient(135deg, #dc3545 0%, #c82333 100%);
        color: white;
        border: none;
        border-radius: 8px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .modal-btn-confirmar:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(220,53,69,0.4);
      }
    </style>
    
    <div class="modal-confirmacion-box">
      <div class="modal-confirmacion-header">
        <div class="modal-confirmacion-icon">
          <i class="fas fa-exclamation-triangle"></i>
        </div>
        <h3 class="modal-confirmacion-title">${titulo}</h3>
      </div>
      
      <div class="modal-confirmacion-body">
        <div class="modal-confirmacion-mensaje">
          <p>${mensaje}</p>
        </div>
        
        <div class="modal-confirmacion-tip">
          <i class="fas fa-lightbulb"></i>
          <span><strong>Recomendación:</strong> Finaliza el proceso actual antes de salir para guardar tu progreso.</span>
        </div>
        
        <div class="modal-confirmacion-buttons">
          <button class="modal-btn-cancelar" id="btnCancelarModal">
            <i class="fas fa-arrow-left"></i> Cancelar
          </button>
          <button class="modal-btn-confirmar" id="btnConfirmarModal">
            <i class="fas fa-trash-alt"></i> Sí, continuar
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  // Event listeners
  document.getElementById('btnCancelarModal').onclick = () => {
    overlay.style.animation = 'fadeInOverlay 0.2s ease reverse';
    setTimeout(() => overlay.remove(), 150);
  };
  
  document.getElementById('btnConfirmarModal').onclick = () => {
    overlay.remove();
    callbackConfirmar();
  };
  
  // Cerrar con ESC
  const handleEsc = (e) => {
    if (e.key === 'Escape') {
      overlay.style.animation = 'fadeInOverlay 0.2s ease reverse';
      setTimeout(() => overlay.remove(), 150);
      document.removeEventListener('keydown', handleEsc);
    }
  };
  document.addEventListener('keydown', handleEsc);
  
  // Cerrar al hacer clic fuera
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      overlay.style.animation = 'fadeInOverlay 0.2s ease reverse';
      setTimeout(() => overlay.remove(), 150);
    }
  };
}
// ========================================
// 📦 RECEPCIÓN - FUNCIONES COMPLETAS
// ========================================

function agregarARecepcionGlobal() {
  const inputCodigo = document.getElementById('recepcionCodigoInput');
  const codigo = inputCodigo.value.trim();
  
  if (!codigo) {
    mostrarAlerta('recepcionAlerta', 'Escanea o ingresa un código', 'warning');
    return;
  }
  
  const factura = document.getElementById('recepcionFactura').value.trim();
  if (!factura) {
    mostrarAlerta('recepcionAlerta', 'Primero ingresa el número de factura', 'warning');
    document.getElementById('recepcionFactura').focus();
    return;
  }
  
  // Inicializar recepción si es el primer item
  if (datosRecepcion.items.length === 0) {
    datosRecepcion.factura = factura;
    datosRecepcion.idRecepcion = 'REC-' + Date.now();
    datosRecepcion.fechaInicio = new Date().toLocaleString('es-PA');
    datosRecepcion.estado = 'en_proceso';
  }
  
  mostrarCargando(true);
  
  // Buscar el código en inventario
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      
      const codigoLimpio = respuesta.cleanedCode;
      const existeEnInventario = respuesta.count > 0;
      
      // Verificar si ya está en la lista
      const yaAgregado = datosRecepcion.items.some(item => item.codigo === codigoLimpio);
      if (yaAgregado) {
        // Incrementar cantidad
        const item = datosRecepcion.items.find(i => i.codigo === codigoLimpio);
        item.cantidad++;
        mostrarAlerta('recepcionAlerta', `Cantidad aumentada: ${codigoLimpio} (x${item.cantidad})`, 'info');
      } else {
        // Agregar nuevo item
        const nuevoItem = {
          codigo: codigoLimpio,
          cantidad: 1,
          descripcion: existeEnInventario ? respuesta.resultados[0]['Descripción'] : 'NUEVO - Sin descripción',
          marca: existeEnInventario ? respuesta.resultados[0]['Marca'] : '',
          ubicacion: existeEnInventario ? respuesta.resultados[0]['Ubicación Principal'] : '',
          ubicado: false,
          existeEnInventario: existeEnInventario
        };
        
        datosRecepcion.items.push(nuevoItem);
        mostrarAlerta('recepcionAlerta', `✅ Agregado: ${codigoLimpio}`, 'success');
      }
      
      actualizarListaRecepcion();
      marcarCambios();
      inputCodigo.value = '';
      inputCodigo.focus();
      
      // Mostrar botón finalizar si hay items
      if (datosRecepcion.items.length > 0) {
        document.getElementById('btnFinalizarRecepcion').style.display = 'block';
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('recepcionAlerta', 'Error: ' + error, 'error');
    })
    .buscarCodigoRecepcion(codigo);
}

function actualizarListaRecepcion() {
  const container = document.getElementById('recepcionLista');
  
  if (datosRecepcion.items.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No hay items agregados</p>';
    return;
  }
  
  let html = `
    <div style="background: #e8f5e9; padding: 15px; border-radius: 8px; margin-top: 15px;">
      <h4 style="color: #2e7d32; margin-bottom: 10px;">📋 Recepción en Progreso</h4>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div><strong>Factura:</strong> ${datosRecepcion.factura}</div>
        <div><strong>Items:</strong> ${datosRecepcion.items.length}</div>
        <div><strong>ID:</strong> ${datosRecepcion.idRecepcion}</div>
        <div><strong>Inicio:</strong> ${datosRecepcion.fechaInicio}</div>
      </div>
    </div>
    
    <h4 style="margin-top: 20px; margin-bottom: 10px;">Items escaneados:</h4>
  `;
  
  datosRecepcion.items.forEach((item, index) => {
    const estadoClass = item.existeEnInventario ? 'success' : 'warning';
    const estadoIcono = item.existeEnInventario ? '✅' : '⚠️ NUEVO';
    const ubicacionBadge = item.ubicacion 
      ? `<span class="item-ubicacion-badge">${item.ubicacion}</span>` 
      : `<span class="item-ubicacion-badge empty">Sin ubicación</span>`;
    
    html += `
      <div class="resultado-item" style="border-left-color: ${item.existeEnInventario ? '#28a745' : '#ffc107'};">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
          <div>
            <div style="font-weight: 800; font-size: 16px; color: #1d66c3;">${item.codigo}</div>
            <div style="font-size: 14px; color: #666; margin-top: 3px;">${item.descripcion}</div>
            <div style="font-size: 12px; color: #999;">${item.marca || 'Sin marca'}</div>
          </div>
          <button onclick="eliminarItemRecepcion(${index})" style="background: #dc3545; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer;">
            <i class="fas fa-trash"></i>
          </button>
        </div>
        
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
          <div>
            <span style="background: #e3f2fd; color: #1d66c3; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 700;">
              ${estadoIcono} Cantidad: ${item.cantidad}
            </span>
            ${ubicacionBadge}
          </div>
          <div style="display: flex; gap: 5px;">
            <button onclick="aumentarCantidad(${index})" style="background: #28a745; color: white; border: none; padding: 5px 10px; border-radius: 5px; cursor: pointer; font-size: 12px;">
              <i class="fas fa-plus"></i>
            </button>
            <button onclick="disminuirCantidad(${index})" style="background: #ffc107; color: #000; border: none; padding: 5px 10px; border-radius: 5px; cursor: pointer; font-size: 12px;">
              <i class="fas fa-minus"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
}

function aumentarCantidad(index) {
  datosRecepcion.items[index].cantidad++;
  actualizarListaRecepcion();
  marcarCambios();
}

function disminuirCantidad(index) {
  if (datosRecepcion.items[index].cantidad > 1) {
    datosRecepcion.items[index].cantidad--;
    actualizarListaRecepcion();
    marcarCambios();
  } else {
    mostrarConfirmacion(
      '¿Eliminar item?',
      '¿Deseas eliminar este item de la recepción?',
      () => eliminarItemRecepcion(index)
    );
  }
}

function eliminarItemRecepcion(index) {
  datosRecepcion.items.splice(index, 1);
  actualizarListaRecepcion();
  marcarCambios();
  
  if (datosRecepcion.items.length === 0) {
    document.getElementById('btnFinalizarRecepcion').style.display = 'none';
  }
}

function finalizarRecepcion() {
  if (datosRecepcion.items.length === 0) {
    mostrarAlerta('recepcionAlerta', 'No hay items para recibir', 'warning');
    return;
  }
  
  const factura = document.getElementById('recepcionFactura').value.trim();
  if (!factura) {
    mostrarAlerta('recepcionAlerta', 'Ingresa el número de factura', 'warning');
    return;
  }
  
  mostrarConfirmacion(
    'Finalizar Recepción',
    `¿Confirmar recepción de ${datosRecepcion.items.length} items de la factura ${factura}?`,
    () => {
      ejecutarFinalizacionRecepcion();
    }
  );
}

function ejecutarFinalizacionRecepcion() {
  datosRecepcion.fechaCierre = new Date().toLocaleString('es-PA');
  datosRecepcion.estado = 'completado';
  datosRecepcion.sessionId = currentSessionId || localStorage.getItem('sessionId');
  
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      
      if (respuesta.success) {
        cambiosPendientes = false;
        mostrarReporteRecepcion(respuesta);
        
        // Verificar si hay items por ubicar
        const itemsSinUbicacion = datosRecepcion.items.filter(item => !item.ubicacion || item.ubicacion === '');
        
        if (itemsSinUbicacion.length > 0) {
          setTimeout(() => {
            mostrarConfirmacion(
              'Items por ubicar',
              `Hay ${itemsSinUbicacion.length} items sin ubicación. ¿Deseas ubicarlos ahora?`,
              () => {
                abrirModuloPorUbicar(itemsSinUbicacion);
              }
            );
          }, 1000);
        }
      } else {
        mostrarAlerta('recepcionAlerta', 'Error: ' + respuesta.message, 'error');
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('recepcionAlerta', 'Error de conexión: ' + error, 'error');
    })
    .guardarRecepcion(datosRecepcion);
}

function mostrarReporteRecepcion(respuesta) {
  const totalItems = respuesta.totalItems || datosRecepcion.items.length;
  const totalCantidad = datosRecepcion.items.reduce((sum, item) => sum + item.cantidad, 0);
  
  const html = `
    <div style="background: #d4edda; padding: 20px; border-radius: 8px; border-left: 4px solid #28a745; margin-top: 20px;">
      <h3 style="color: #155724; margin-bottom: 15px;">✅ Recepción Completada</h3>
      
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
        <div>
          <strong>ID Recepción:</strong><br>
          <span style="color: #1d66c3; font-weight: 700;">${respuesta.idRecepcion}</span>
        </div>
        <div>
          <strong>Factura:</strong><br>
          <span style="font-weight: 700;">${datosRecepcion.factura}</span>
        </div>
        <div>
          <strong>Items únicos:</strong><br>
          <span style="font-weight: 700;">${totalItems}</span>
        </div>
        <div>
          <strong>Cantidad total:</strong><br>
          <span style="font-weight: 700;">${totalCantidad}</span>
        </div>
      </div>
      
      <div style="background: white; padding: 10px; border-radius: 5px; margin-top: 10px;">
        <p style="margin: 0; font-size: 14px;">
          <i class="fas fa-info-circle" style="color: #17a2b8;"></i> 
          Se ha enviado un reporte por email a los destinatarios configurados.
        </p>
      </div>
    </div>
  `;
  
  document.getElementById('recepcionReporte').innerHTML = html;
  document.getElementById('btnFinalizarRecepcion').style.display = 'none';
}

function abrirModuloPorUbicar(itemsSinUbicacion) {
  showModulo('por-ubicar');
  cargarModuloPorUbicar(itemsSinUbicacion);
}

// ========================================
// 📍 POR UBICAR - MÓDULO COMPLETO
// ========================================

let itemsPorUbicar = [];
let itemActualIndex = 0;

function cargarModuloPorUbicar(items) {
  itemsPorUbicar = items;
  itemActualIndex = 0;
  mostrarFormularioUbicacion();
}

function mostrarFormularioUbicacion() {
  if (itemActualIndex >= itemsPorUbicar.length) {
    finalizarPorUbicar();
    return;
  }
  
  const item = itemsPorUbicar[itemActualIndex];
  const progreso = `${itemActualIndex + 1} / ${itemsPorUbicar.length}`;
  
  const html = `
    <div style="background: #fff3cd; padding: 15px; border-radius: 8px; border-left: 4px solid #ffc107; margin-bottom: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <h4 style="color: #856404; margin: 0;">Ubicando items (${progreso})</h4>
        <span style="background: #ffc107; color: #000; padding: 5px 15px; border-radius: 20px; font-weight: 700; font-size: 12px;">
          Faltan ${itemsPorUbicar.length - itemActualIndex}
        </span>
      </div>
      
      <div class="resultado-item" style="background: white;">
        <div style="font-weight: 800; font-size: 18px; color: #1d66c3; margin-bottom: 5px;">${item.codigo}</div>
        <div style="font-size: 14px; margin-bottom: 3px;">${item.descripcion}</div>
        <div style="font-size: 12px; color: #666;">${item.marca || 'Sin marca'}</div>
        <span style="background: #e3f2fd; color: #1d66c3; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 700; margin-top: 8px; display: inline-block;">
          Cantidad: ${item.cantidad}
        </span>
      </div>
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Escanea o ingresa la ubicación</label>
      <input type="text" id="porUbicarInput" class="input-custom" placeholder="B-1-A-01-A" autofocus onkeypress="if(event.key==='Enter') guardarUbicacionActual()">
    </div>
    
    <button class="btn-primary-custom" onclick="abrirScanner('porUbicarInput')">
      <i class="fas fa-barcode"></i> Escanear Ubicación
    </button>
    <button class="btn-success-custom" onclick="guardarUbicacionActual()">
      <i class="fas fa-check"></i> Guardar y Continuar
    </button>
    <button class="btn-secondary-custom" onclick="saltarItem()">
      <i class="fas fa-forward"></i> Saltar (ubicar después)
    </button>
  `;
  
  document.getElementById('porUbicarFormulario').innerHTML = html;
  document.getElementById('porUbicarInput').focus();
}

function guardarUbicacionActual() {
  const ubicacion = document.getElementById('porUbicarInput').value.trim();
  
  if (!ubicacion) {
    mostrarAlerta('porUbicarAlerta', 'Ingresa una ubicación', 'warning');
    return;
  }
  
  const item = itemsPorUbicar[itemActualIndex];
  
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      
      if (respuesta.success) {
        item.ubicacion = ubicacion;
        item.ubicado = true;
        mostrarAlerta('porUbicarAlerta', `✅ Ubicación asignada: ${ubicacion}`, 'success');
        
        setTimeout(() => {
          itemActualIndex++;
          mostrarFormularioUbicacion();
        }, 800);
      } else {
        mostrarAlerta('porUbicarAlerta', 'Error: ' + respuesta.message, 'error');
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('porUbicarAlerta', 'Error: ' + error, 'error');
    })
    .asignarUbicacionCodigo(item.codigo, ubicacion);
}

function saltarItem() {
  itemActualIndex++;
  mostrarFormularioUbicacion();
}

function finalizarPorUbicar() {
  const ubicados = itemsPorUbicar.filter(i => i.ubicado).length;
  const pendientes = itemsPorUbicar.length - ubicados;
  
  const html = `
    <div style="background: #d4edda; padding: 20px; border-radius: 8px; text-align: center;">
      <h3 style="color: #155724; margin-bottom: 15px;">✅ Proceso Completado</h3>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; max-width: 400px; margin: 0 auto;">
        <div style="background: white; padding: 15px; border-radius: 8px;">
          <div style="font-size: 32px; font-weight: 800; color: #28a745;">${ubicados}</div>
          <div style="font-size: 14px; color: #666;">Ubicados</div>
        </div>
        <div style="background: white; padding: 15px; border-radius: 8px;">
          <div style="font-size: 32px; font-weight: 800; color: #ffc107;">${pendientes}</div>
          <div style="font-size: 14px; color: #666;">Pendientes</div>
        </div>
      </div>
      <button onclick="volverAlMenu()" style="margin-top: 20px; background: #1d66c3; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-weight: 700; cursor: pointer; width: 100%;">
        <i class="fas fa-home"></i> Volver al Menú
      </button>
    </div>
  `;
  
  document.getElementById('porUbicarFormulario').innerHTML = html;
  ocultarAlerta('porUbicarAlerta');
}
// ========================================
// 🔴 AUDITORÍA - FUNCIONES COMPLETAS
// ========================================

function buscarParaAuditoriaGlobal() {
  const codigo = document.getElementById('auditoriaCodigoInput').value.trim();
  
  if (!codigo) {
    mostrarAlerta('auditoriaAlerta', 'Ingresa un código', 'warning');
    return;
  }
  
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      
      if (respuesta.count > 0) {
        const item = respuesta.resultados[0];
        mostrarFormularioAuditoria(item, respuesta.cleanedCode);
      } else {
        mostrarAlerta('auditoriaAlerta', `Código no encontrado: ${respuesta.cleanedCode}`, 'warning');
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('auditoriaAlerta', 'Error: ' + error, 'error');
    })
    .buscarCodigoAuditoria(codigo);
}

function mostrarFormularioAuditoria(item, codigoLimpio) {
  const html = `
    <div class="resultado-item" style="margin-top: 20px;">
      <h4 style="color: #1d66c3; margin-bottom: 10px;">📦 Item a Auditar</h4>
      <div style="font-weight: 800; font-size: 16px; margin-bottom: 5px;">${item['Código']}</div>
      <div style="margin-bottom: 5px;">${item['Descripción'] || 'N/A'}</div>
      <div style="color: #666; font-size: 14px; margin-bottom: 5px;">${item['Marca'] || 'N/A'}</div>
      <span class="item-ubicacion-badge">${item['Ubicación Principal'] || 'Sin ubicación'}</span>
    </div>
    
    <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin-top: 20px;">
      <h4 style="color: #856404; margin-bottom: 15px;">Estado del Item</h4>
      
      <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 15px;">
        <label style="display: flex; align-items: center; padding: 10px; background: white; border: 2px solid #ddd; border-radius: 8px; cursor: pointer; font-weight: 600;">
          <input type="radio" name="estadoAuditoria" value="Dañado" style="margin-right: 10px; width: 20px; height: 20px;">
          <span>🔴 Dañado - Item presenta daños físicos</span>
        </label>
        
        <label style="display: flex; align-items: center; padding: 10px; background: white; border: 2px solid #ddd; border-radius: 8px; cursor: pointer; font-weight: 600;">
          <input type="radio" name="estadoAuditoria" value="Faltante" style="margin-right: 10px; width: 20px; height: 20px;">
          <span>⚠️ Faltante - Item no encontrado físicamente</span>
        </label>
        
        <label style="display: flex; align-items: center; padding: 10px; background: white; border: 2px solid #ddd; border-radius: 8px; cursor: pointer; font-weight: 600;">
          <input type="radio" name="estadoAuditoria" value="Excedente" style="margin-right: 10px; width: 20px; height: 20px;">
          <span>✅ Excedente - Más unidades de las esperadas</span>
        </label>
        
        <label style="display: flex; align-items: center; padding: 10px; background: white; border: 2px solid #ddd; border-radius: 8px; cursor: pointer; font-weight: 600;">
          <input type="radio" name="estadoAuditoria" value="Mal Ubicado" style="margin-right: 10px; width: 20px; height: 20px;">
          <span>📍 Mal Ubicado - En ubicación incorrecta</span>
        </label>
      </div>
      
      <div class="input-group-custom">
        <label class="mb-2" style="font-weight: 700;">Cantidad Encontrada (opcional)</label>
        <input type="number" id="auditoriacantidad" class="input-custom" placeholder="Ej: 5" min="0">
      </div>
      
      <div class="input-group-custom">
        <label class="mb-2" style="font-weight: 700;">Notas / Observaciones</label>
        <textarea id="auditoriaNotas" class="input-custom" rows="3" placeholder="Describe el problema encontrado..."></textarea>
      </div>
      
      <div class="input-group-custom">
        <label class="mb-2" style="font-weight: 700;">Fotos (opcional)</label>
        <input type="file" id="auditoriaFotos" accept="image/*" multiple class="input-custom" style="padding: 8px;">
        <small style="color: #666; font-size: 12px;">Puedes seleccionar múltiples fotos</small>
      </div>
      
      <button class="btn-success-custom" onclick="agregarItemAuditoria('${codigoLimpio}')">
        <i class="fas fa-plus"></i> Agregar a Auditoría
      </button>
    </div>
  `;
  
  document.getElementById('auditoriaFormulario').innerHTML = html;
}

function agregarItemAuditoria(codigo) {
  const estadoSeleccionado = document.querySelector('input[name="estadoAuditoria"]:checked');
  
  if (!estadoSeleccionado) {
    mostrarAlerta('auditoriaAlerta', 'Selecciona un estado', 'warning');
    return;
  }
  
  const cantidad = document.getElementById('auditoriacantidad').value;
  const notas = document.getElementById('auditoriaNotas').value.trim();
  const inputFotos = document.getElementById('auditoriaFotos');
  
  // Procesar fotos si hay
  const fotos = [];
  if (inputFotos.files.length > 0) {
    Array.from(inputFotos.files).forEach(file => {
      const reader = new FileReader();
      reader.onload = function(e) {
        fotos.push(e.target.result); // Base64
      };
      reader.readAsDataURL(file);
    });
  }
  
  const itemAuditoria = {
    codigo: codigo,
    estado: estadoSeleccionado.value,
    cantidad: cantidad || '',
    notas: notas,
    fotos: fotos,
    timestamp: new Date().toLocaleString('es-PA')
  };
  
  datosAuditoria.items.push(itemAuditoria);
  
  mostrarAlerta('auditoriaAlerta', `✅ Item agregado a auditoría: ${codigo}`, 'success');
  
  // Limpiar formulario
  document.getElementById('auditoriaCodigoInput').value = '';
  document.getElementById('auditoriaFormulario').innerHTML = '';
  
  // Actualizar lista
  actualizarListaAuditoria();
  
  // Mostrar botón finalizar
  document.getElementById('btnFinalizarAuditoria').style.display = 'block';
}

function actualizarListaAuditoria() {
  const container = document.getElementById('auditoriaLista');
  
  if (datosAuditoria.items.length === 0) {
    container.innerHTML = '';
    return;
  }
  
  let html = `
    <div style="background: #e8f5e9; padding: 15px; border-radius: 8px; margin-top: 20px;">
      <h4 style="color: #2e7d32; margin-bottom: 10px;">📋 Items en Auditoría (${datosAuditoria.items.length})</h4>
    </div>
  `;
  
  datosAuditoria.items.forEach((item, index) => {
    const estadoColor = {
      'Dañado': '#dc3545',
      'Faltante': '#ffc107',
      'Excedente': '#28a745',
      'Mal Ubicado': '#17a2b8'
    }[item.estado] || '#6c757d';
    
    const estadoIcono = {
      'Dañado': '🔴',
      'Faltante': '⚠️',
      'Excedente': '✅',
      'Mal Ubicado': '📍'
    }[item.estado] || '❓';
    
    html += `
      <div class="resultado-item" style="border-left-color: ${estadoColor}; margin-top: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: start;">
          <div style="flex: 1;">
            <div style="font-weight: 800; font-size: 16px; color: #1d66c3; margin-bottom: 5px;">${item.codigo}</div>
            <div style="display: inline-block; background: ${estadoColor}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 700; margin-bottom: 8px;">
              ${estadoIcono} ${item.estado}
            </div>
            ${item.cantidad ? `<div style="font-size: 14px; margin-bottom: 5px;"><strong>Cantidad:</strong> ${item.cantidad}</div>` : ''}
            ${item.notas ? `<div style="font-size: 14px; color: #666; margin-top: 5px;"><strong>Notas:</strong> ${item.notas}</div>` : ''}
            ${item.fotos && item.fotos.length > 0 ? `<div style="font-size: 12px; color: #999; margin-top: 5px;"><i class="fas fa-camera"></i> ${item.fotos.length} foto(s)</div>` : ''}
            <div style="font-size: 11px; color: #999; margin-top: 5px;">${item.timestamp}</div>
          </div>
          <button onclick="eliminarItemAuditoria(${index})" style="background: #dc3545; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer;">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
}

function eliminarItemAuditoria(index) {
  mostrarConfirmacion(
    '¿Eliminar item?',
    '¿Deseas eliminar este item de la auditoría?',
    () => {
      datosAuditoria.items.splice(index, 1);
      actualizarListaAuditoria();
      
      if (datosAuditoria.items.length === 0) {
        document.getElementById('btnFinalizarAuditoria').style.display = 'none';
      }
    }
  );
}

function finalizarAuditoria() {
  if (datosAuditoria.items.length === 0) {
    mostrarAlerta('auditoriaAlerta', 'No hay items en la auditoría', 'warning');
    return;
  }
  
  mostrarConfirmacion(
    'Enviar Auditoría',
    `¿Confirmar envío de auditoría con ${datosAuditoria.items.length} items?`,
    () => {
      ejecutarEnvioAuditoria();
    }
  );
}

function ejecutarEnvioAuditoria() {
  mostrarCargando(true);
  
  // Enviar cada item por separado
  let enviados = 0;
  let errores = 0;
  
  const promesas = datosAuditoria.items.map(item => {
    return new Promise((resolve) => {
      const itemConSession = Object.assign({}, item, { sessionId: currentSessionId || localStorage.getItem('sessionId') });
      google.script.run
        .withSuccessHandler(respuesta => {
          if (respuesta.success) {
            enviados++;
            console.log('✅ Auditoría guardada:', respuesta.idAuditoria);
          } else {
            errores++;
            console.error('❌ Error:', respuesta.message);
          }
          resolve();
        })
        .withFailureHandler((error) => {
          errores++;
          console.error('❌ Error:', error);
          resolve();
        })
        .guardarAuditoriaCompleta(itemConSession);  // ← CAMBIO AQUÍ
    });
  });
  
  // Esperar a que todos terminen
  Promise.all(promesas).then(() => {
    mostrarCargando(false);
    
    if (errores === 0) {
      mostrarAlerta('auditoriaAlerta', `✅ Auditoría enviada exitosamente (${enviados} items) - Reporte generado y enviado por email`, 'success');
      
      setTimeout(() => {
        limpiarModulo('auditoria');
        datosAuditoria = { items: [] };
      }, 2000);
    } else {
      mostrarAlerta('auditoriaAlerta', `⚠️ Enviados: ${enviados}, Errores: ${errores}`, 'warning');
    }
  });
}
// ========================================
// 📦 DESPACHO - CON PERSISTENCIA DE PICKING
// ========================================

// ✅ CLAVE PARA LOCALSTORAGE
const STORAGE_KEY_DESPACHO = 'partfinder_despacho_activo';

// Estado del despacho actual
let datosDespachoActual = {
  cliente: '',
  items: [],
  tiempoInicio: null,
  filtroActual: 'todos',
  faseActual: 'captura' // captura, validacion, picking, resumen
};

// ========================================
// 🔄 FUNCIONES DE PERSISTENCIA
// ========================================

/**
 * Guardar estado actual en localStorage
 */
function guardarEstadoDespacho() {
  try {
    const estado = {
      ...datosDespachoActual,
      tiempoInicio: datosDespachoActual.tiempoInicio ? datosDespachoActual.tiempoInicio.toISOString() : null,
      timestamp: new Date().toISOString()
    };
    
    localStorage.setItem(STORAGE_KEY_DESPACHO, JSON.stringify(estado));
    console.log('💾 Estado de despacho guardado');
  } catch (error) {
    console.error('❌ Error guardando estado:', error);
  }
}

/**
 * Cargar estado desde localStorage
 */
function cargarEstadoDespacho() {
  try {
    const estadoGuardado = localStorage.getItem(STORAGE_KEY_DESPACHO);
    
    if (!estadoGuardado) {
      console.log('📭 No hay despacho activo guardado');
      return false;
    }
    
    const estado = JSON.parse(estadoGuardado);
    
    // Reconstruir objetos Date
    if (estado.tiempoInicio) {
      estado.tiempoInicio = new Date(estado.tiempoInicio);
    }
    
    datosDespachoActual = estado;
    console.log('✅ Estado de despacho cargado:', estado.faseActual);
    return true;
    
  } catch (error) {
    console.error('❌ Error cargando estado:', error);
    return false;
  }
}

/**
 * Limpiar despacho guardado
 */
function limpiarEstadoDespacho() {
  try {
    localStorage.removeItem(STORAGE_KEY_DESPACHO);
    console.log('🗑️ Estado de despacho eliminado');
  } catch (error) {
    console.error('❌ Error limpiando estado:', error);
  }
}

/**
 * Verificar si hay un picking activo
 */
function hayPickingActivo() {
  const estadoGuardado = localStorage.getItem(STORAGE_KEY_DESPACHO);
  if (!estadoGuardado) return false;
  
  try {
    const estado = JSON.parse(estadoGuardado);
    return estado.faseActual === 'picking' && estado.items && estado.items.length > 0;
  } catch {
    return false;
  }
}

// ========================================
// 🚀 INICIALIZACIÓN AL CARGAR MÓDULO
// ========================================

/**
 * Restaurar despacho si existe uno activo
 */
function inicializarModuloDespacho() {
  console.log('🔍 Verificando si hay picking activo...');
  
  if (cargarEstadoDespacho()) {
    // Hay un despacho guardado - preguntar si quiere continuar
    mostrarDialogoReanudarPicking();
  } else {
    // No hay nada guardado - mostrar fase de captura normal
    mostrarFaseCaptura();
  }
}

/**
 * Mostrar diálogo para reanudar picking
 */
function mostrarDialogoReanudarPicking() {
  const completados = datosDespachoActual.items.filter(i => i.recogido).length;
  const total = datosDespachoActual.items.filter(i => i.encontrado).length;
  
  const mensaje = `
    🔄 Tienes un Picking en curso:
    
    Cliente: ${datosDespachoActual.cliente}
    Progreso: ${completados}/${total} items recogidos
    
    ¿Deseas continuar?
  `;
  
  if (confirm(mensaje)) {
    // Continuar con el picking
    restaurarFaseDespacho();
  } else {
    // Empezar nuevo
    if (confirm('⚠️ ¿Seguro que quieres DESCARTAR este picking?')) {
      limpiarEstadoDespacho();
      nuevoDespacho();
    } else {
      // Usuario canceló - restaurar de todas formas
      restaurarFaseDespacho();
    }
  }
}

/**
 * Restaurar la fase correspondiente del despacho
 */
function restaurarFaseDespacho() {
  // Ocultar todas las fases
  document.getElementById('despachoFaseCaptura').style.display = 'none';
  document.getElementById('despachoFaseValidacion').style.display = 'none';
  document.getElementById('despachoFasePicking').style.display = 'none';
  document.getElementById('despachoFaseResumen').style.display = 'none';
  
  switch (datosDespachoActual.faseActual) {
    case 'validacion':
      mostrarResultadoValidacion({
        success: true,
        items: datosDespachoActual.items,
        resumen: calcularResumenValidacion()
      });
      break;
      
    case 'picking':
      iniciarPicking();
      break;
      
    case 'resumen':
      mostrarFaseResumen();
      break;
      
    default:
      mostrarFaseCaptura();
  }
}

/**
 * Calcular resumen para fase de validación
 */
function calcularResumenValidacion() {
  const total = datosDespachoActual.items.length;
  const encontrados = datosDespachoActual.items.filter(i => i.encontrado).length;
  const noEncontrados = total - encontrados;
  
  return { total, encontrados, noEncontrados };
}

// ========================================
// 📸 PROCESAMIENTO DE IMAGEN (MODIFICADO)
// ========================================

function procesarImagenDespacho(input) {
  if (!input.files || !input.files[0]) return;
  
  const file = input.files[0];
  const preview = document.getElementById('despachoImagePreview');
  
  const reader = new FileReader();
  reader.onload = function(e) {
    preview.src = e.target.result;
    preview.style.display = 'block';
    
    mostrarCargando(true);
    google.script.run
      .withSuccessHandler(function(respuesta) {
        mostrarCargando(false);
        if (respuesta.success) {
          datosDespachoActual.cliente = document.getElementById('despachoCliente').value || 'N/A';
          datosDespachoActual.tiempoInicio = new Date();
          datosDespachoActual.faseActual = 'validacion';
          
          // ✅ GUARDAR ESTADO
          guardarEstadoDespacho();
          
          validarItemsContraInventario(respuesta.items);
        } else {
          alert('❌ Error: ' + respuesta.error);
        }
      })
      .withFailureHandler(function(error) {
        mostrarCargando(false);
        alert('❌ Error: ' + error.message);
      })
      .procesarImagenOrden(e.target.result);
  };
  reader.readAsDataURL(file);
}

// ========================================
// ✍️ PROCESAMIENTO MANUAL (MODIFICADO)
// ========================================

function procesarCodigosManual() {
  const texto = document.getElementById('despachoCodigos').value.trim();
  if (!texto) {
    alert('Ingresa al menos un código');
    return;
  }
  
  const lineas = texto.split('\n').map(l => l.trim()).filter(l => l);
  if (lineas.length === 0) {
    alert('No se encontraron códigos válidos');
    return;
  }
  
  const items = lineas.map(codigo => ({
    cantidad: 1,
    codigo: codigo,
    descripcion: ''
  }));
  
  datosDespachoActual.cliente = document.getElementById('despachoCliente').value || 'N/A';
  datosDespachoActual.tiempoInicio = new Date();
  datosDespachoActual.faseActual = 'validacion';
  
  // ✅ GUARDAR ESTADO
  guardarEstadoDespacho();
  
  validarItemsContraInventario(items);
}

// ========================================
// ✅ VALIDACIÓN (SIN CAMBIOS)
// ========================================

function validarItemsContraInventario(items) {
  mostrarCargando(true);
  google.script.run
    .withSuccessHandler(function(respuesta) {
      mostrarCargando(false);
      if (respuesta.success) {
        datosDespachoActual.items = respuesta.items;
        
        // ✅ GUARDAR ESTADO
        guardarEstadoDespacho();
        
        mostrarResultadoValidacion(respuesta);
      } else {
        alert('❌ Error: ' + respuesta.error);
      }
    })
    .withFailureHandler(function(error) {
      mostrarCargando(false);
      alert('❌ Error: ' + error.message);
    })
    .validarItemsDespacho(items);
}

// ========================================
// 📋 MOSTRAR RESULTADOS (MODIFICADO)
// ========================================

function mostrarResultadoValidacion(respuesta) {
  document.getElementById('despachoFaseCaptura').style.display = 'none';
  document.getElementById('despachoFaseValidacion').style.display = 'block';
  
  const r = respuesta.resumen;
  let html = `
    <div style="margin: 20px 0;">
      <div style="display: flex; justify-content: center; gap: 20px; flex-wrap: wrap;">
        <div style="background: #e3f2fd; padding: 20px; border-radius: 8px; min-width: 120px; text-align: center;">
          <div style="font-size: 36px; font-weight: bold; color: #2196F3;">${r.total}</div>
          <div style="font-size: 14px; color: #666;">Total Items</div>
        </div>
        <div style="background: #e8f5e9; padding: 20px; border-radius: 8px; min-width: 120px; text-align: center;">
          <div style="font-size: 36px; font-weight: bold; color: #4CAF50;">✓ ${r.encontrados}</div>
          <div style="font-size: 14px; color: #666;">Encontrados</div>
        </div>
        ${r.noEncontrados > 0 ? `
          <div style="background: #ffebee; padding: 20px; border-radius: 8px; min-width: 120px; text-align: center;">
            <div style="font-size: 36px; font-weight: bold; color: #f44336;">✗ ${r.noEncontrados}</div>
            <div style="font-size: 14px; color: #666;">No Encontrados</div>
          </div>
        ` : ''}
      </div>
    </div>
  `;

  if (r.encontrados > 0) {
    html += `
      <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h4 style="color: #1d66c3; margin-bottom: 15px;">
          <i class="fas fa-check-circle"></i> Items Encontrados en Inventario
        </h4>
        <p style="font-size: 13px; color: #666; margin-bottom: 15px;">
          Revisa y ajusta las cantidades antes de continuar
        </p>
        <div id="listaItemsValidacion"></div>
      </div>
    `;
  }

  if (r.noEncontrados > 0) {
    html += `
      <div style="background: #fff3f3; padding: 15px; border-radius: 8px; border-left: 4px solid #f44336; margin: 20px 0;">
        <h4 style="margin: 0 0 10px 0; color: #f44336;">
          <i class="fas fa-exclamation-triangle"></i> Códigos No Encontrados:
        </h4>
        <ul style="margin: 0; padding-left: 20px;">
    `;
    
    respuesta.items.filter(i => !i.encontrado).forEach(item => {
      html += `<li style="margin: 5px 0;"><strong>${item.codigo}</strong>`;
      if (item.descripcionOrden) html += ` - ${item.descripcionOrden}`;
      html += ` <span style="color: #666;">(x${item.cantidad})</span></li>`;
    });
    
    html += `
        </ul>
      </div>
    `;
  }

  html += `
    <div style="text-align: center; margin-top: 30px;">
      <button class="btn-primary-custom" onclick="iniciarPicking()" style="padding: 15px 40px; font-size: 16px;">
        <i class="fas fa-arrow-right"></i> INICIAR PICKING
      </button>
      <button class="btn-secondary-custom" onclick="cancelarDespachoActual()" style="margin-left: 10px;">
        <i class="fas fa-times"></i> Cancelar
      </button>
    </div>
  `;
  
  document.getElementById('despachoResultadoValidacion').innerHTML = html;
  renderizarItemsValidacion();
}

// ========================================
// 🔢 VALIDACIÓN - AJUSTAR CANTIDADES
// ========================================

function renderizarItemsValidacion() {
  const container = document.getElementById('listaItemsValidacion');
  if (!container) return;
  
  let html = '';
  
  datosDespachoActual.items.filter(i => i.encontrado).forEach((item, index) => {
    html += `
      <div style="background: white; border: 2px solid #e0e0e0; border-radius: 8px; padding: 15px; margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          <div style="flex: 1; min-width: 200px;">
            <div style="font-weight: 800; font-size: 16px; color: #1d66c3; margin-bottom: 5px;">
              ${item.codigo}
            </div>
            <div style="font-size: 14px; color: #666;">
              ${item.descripcionInventario || 'Sin descripción'}
            </div>
            <div style="font-size: 13px; color: #999; margin-top: 3px;">
              <i class="fas fa-map-marker-alt"></i> ${item.ubicacionPrincipal || 'Sin ubicación'}
            </div>
          </div>
          
          <div style="display: flex; align-items: center; gap: 10px;">
            <button onclick="ajustarCantidadValidacion(${index}, -1)" 
                    style="background: #ffc107; color: #000; border: none; width: 35px; height: 35px; border-radius: 5px; cursor: pointer; font-weight: bold; font-size: 18px;"
                    ${item.cantidad <= 1 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>
              −
            </button>
            
            <div style="background: #667eea; color: white; padding: 8px 20px; border-radius: 20px; font-weight: bold; min-width: 60px; text-align: center; font-size: 18px;">
              ${item.cantidad}
            </div>
            
            <button onclick="ajustarCantidadValidacion(${index}, 1)" 
                    style="background: #28a745; color: white; border: none; width: 35px; height: 35px; border-radius: 5px; cursor: pointer; font-weight: bold; font-size: 18px;">
              +
            </button>
          </div>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
}

function ajustarCantidadValidacion(index, cambio) {
  const itemsEncontrados = datosDespachoActual.items.filter(i => i.encontrado);
  const item = itemsEncontrados[index];
  
  if (!item) return;
  
  item.cantidad += cambio;
  if (item.cantidad < 1) item.cantidad = 1;
  
  // ✅ GUARDAR ESTADO
  guardarEstadoDespacho();
  
  renderizarItemsValidacion();
}

// ========================================
// 📦 INICIAR PICKING (MODIFICADO)
// ========================================

function iniciarPicking() {
  datosDespachoActual.faseActual = 'picking';
  
  // ✅ GUARDAR ESTADO
  guardarEstadoDespacho();
  
  document.getElementById('despachoFaseValidacion').style.display = 'none';
  document.getElementById('despachoFasePicking').style.display = 'block';
  
  document.getElementById('despachoTituloCliente').textContent = datosDespachoActual.cliente;
  document.getElementById('despachoSubtitulo').textContent = 
    datosDespachoActual.items.filter(i => i.encontrado).length + ' items';
  
  renderizarListaPicking();
  actualizarContadoresDespacho();
}

// ========================================
// 📋 RENDERIZAR LISTA PICKING (SIN CAMBIOS)
// ========================================

function renderizarListaPicking() {
  const container = document.getElementById('despachoListaItems');
  let html = '';
  
  const itemsPorZona = {};
  
  datosDespachoActual.items.forEach(item => {
    if (!item.encontrado) return;
    
    const zona = item.ubicacionPrincipal ? 
      item.ubicacionPrincipal.split('-').slice(0, 2).join('-') : 'SIN-ZONA';
    if (!itemsPorZona[zona]) itemsPorZona[zona] = [];
    itemsPorZona[zona].push(item);
  });
  
  const zonasOrdenadas = Object.keys(itemsPorZona).sort();
  
  zonasOrdenadas.forEach(zona => {
    const items = itemsPorZona[zona];
    
    html += `
      <div class="despacho-zona-header">
        <i class="fas fa-map-marker-alt"></i> ${zona} (${items.length} items)
      </div>
    `;
    
    items.forEach((item, idx) => {
      const itemId = 'despacho-item-' + item.codigo.replace(/[^a-zA-Z0-9]/g, '_');
      const claseItem = item.recogido ? 'despacho-item completado' : 'despacho-item';
      const estado = item.recogido ? 'completado' : 'pendiente';
      
      html += `
        <div class="${claseItem}" id="${itemId}" data-estado="${estado}">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
            <div style="flex: 1;">
              <div style="font-weight: 800; font-size: 16px; color: ${item.recogido ? '#28a745' : '#333'};">
                ${item.recogido ? '✅' : '⬜'} ${item.codigo}
              </div>
              <div style="font-size: 13px; color: #666; margin-top: 5px;">
                ${item.descripcionInventario || item.descripcionOrden || 'Sin descripción'}
              </div>
            </div>
            
            <div style="display: flex; align-items: center; gap: 8px; margin-left: 10px;">
              <button onclick="ajustarCantidadPicking('${item.codigo}', -1)" 
                      style="background: #ffc107; color: #000; border: none; width: 30px; height: 30px; border-radius: 5px; cursor: pointer; font-weight: bold;"
                      ${item.cantidad <= 1 ? 'disabled style="opacity: 0.5;"' : ''}>
                −
              </button>
              <div style="background: #667eea; color: white; padding: 6px 15px; border-radius: 20px; font-weight: bold; min-width: 50px; text-align: center;">
                x${item.cantidad}
              </div>
              <button onclick="ajustarCantidadPicking('${item.codigo}', 1)" 
                      style="background: #28a745; color: white; border: none; width: 30px; height: 30px; border-radius: 5px; cursor: pointer; font-weight: bold;">
                +
              </button>
            </div>
          </div>
          
          <div style="display: flex; align-items: center; gap: 10px; margin: 10px 0;">
            <i class="fas fa-map-marker-alt" style="color: #667eea;"></i>
            <div>
              <strong>${item.ubicacionPrincipal || 'Sin ubicación'}</strong>
              ${item.ubicaciones && item.ubicaciones.length > 1 ? 
                '<div style="font-size: 12px; color: #666;">Alt: ' + item.ubicaciones.slice(1).join(', ') + '</div>' 
                : ''}
            </div>
          </div>
          
          ${!item.recogido ? `
            <button class="btn-success-custom" onclick="marcarRecogido('${item.codigo}')" style="width: 100%; margin-top: 10px;">
              <i class="fas fa-check"></i> MARCAR COMO RECOGIDO
            </button>
          ` : `
            <button class="btn-secondary-custom" onclick="desmarcarRecogido('${item.codigo}')" style="width: 100%; margin-top: 10px;">
              <i class="fas fa-undo"></i> Desmarcar
            </button>
          `}
        </div>
      `;
    });
  });
  
  container.innerHTML = html;
}

// ========================================
// ✅ MARCAR/DESMARCAR (MODIFICADO)
// ========================================

function ajustarCantidadPicking(codigo, cambio) {
  const item = datosDespachoActual.items.find(i => i.codigo === codigo);
  if (!item) return;
  
  item.cantidad += cambio;
  if (item.cantidad < 1) item.cantidad = 1;
  
  // ✅ GUARDAR ESTADO
  guardarEstadoDespacho();
  
  renderizarListaPicking();
  aplicarFiltro(datosDespachoActual.filtroActual);
}

function marcarRecogido(codigo) {
  const item = datosDespachoActual.items.find(i => i.codigo === codigo);
  if (item) {
    item.recogido = true;
    
    // ✅ GUARDAR ESTADO
    guardarEstadoDespacho();
    
    renderizarListaPicking();
    actualizarContadoresDespacho();
    aplicarFiltro(datosDespachoActual.filtroActual);
  }
}

function desmarcarRecogido(codigo) {
  const item = datosDespachoActual.items.find(i => i.codigo === codigo);
  if (item) {
    item.recogido = false;
    
    // ✅ GUARDAR ESTADO
    guardarEstadoDespacho();
    
    renderizarListaPicking();
    actualizarContadoresDespacho();
    aplicarFiltro(datosDespachoActual.filtroActual);
  }
}

// ========================================
// 📊 CONTADORES Y FILTROS (SIN CAMBIOS)
// ========================================

function actualizarContadoresDespacho() {
  const total = datosDespachoActual.items.filter(i => i.encontrado).length;
  const completados = datosDespachoActual.items.filter(i => i.recogido).length;
  const pendientes = total - completados;
  
  document.getElementById('despachoContador').textContent = `${completados}/${total}`;
  document.getElementById('despachoProgreso').style.width = (total > 0 ? (completados / total * 100) : 0) + '%';
  document.getElementById('countTodos').textContent = total;
  document.getElementById('countPendientes').textContent = pendientes;
  document.getElementById('countCompletados').textContent = completados;
}

function filtrarDespacho(filtro) {
  datosDespachoActual.filtroActual = filtro;
  document.querySelectorAll('.btn-filter').forEach(btn => btn.classList.remove('active'));
  document.querySelector(`[data-filter="${filtro}"]`).classList.add('active');
  aplicarFiltro(filtro);
}

function aplicarFiltro(filtro) {
  document.querySelectorAll('.despacho-item').forEach(item => {
    const estado = item.getAttribute('data-estado');
    if (filtro === 'todos' || 
        (filtro === 'pendientes' && estado === 'pendiente') ||
        (filtro === 'completados' && estado === 'completado')) {
      item.style.display = 'block';
    } else {
      item.style.display = 'none';
    }
  });
}

// ========================================
// ✅ FINALIZAR DESPACHO (MODIFICADO)
// ========================================

function finalizarDespacho() {
  const completados = datosDespachoActual.items.filter(i => i.recogido).length;
  if (completados === 0) {
    alert('⚠️ No has marcado ningún item');
    return;
  }
  
  const tiempoFin = new Date();
  const tiempoTotal = Math.round((tiempoFin - datosDespachoActual.tiempoInicio) / 60000);
  
  datosDespachoActual.tiempoTotal = tiempoTotal;
  
  mostrarCargando(true);
  google.script.run
    .withSuccessHandler(function(respuesta) {
      mostrarCargando(false);
      if (respuesta.success) {
        // ✅ LIMPIAR ESTADO GUARDADO AL FINALIZAR
        limpiarEstadoDespacho();
        
        mostrarResumenFinalDespacho(respuesta.id, tiempoTotal);
      } else {
        alert('❌ Error: ' + respuesta.error);
      }
    })
    .guardarDespacho(datosDespachoActual);
}

// ========================================
// 📄 RESUMEN FINAL (MODIFICADO)
// ========================================

function mostrarResumenFinalDespacho(idDespacho, tiempoTotal) {
  datosDespachoActual.faseActual = 'resumen';
  
  document.getElementById('despachoFasePicking').style.display = 'none';
  document.getElementById('despachoFaseResumen').style.display = 'block';
  
  const despachados = datosDespachoActual.items.filter(i => i.recogido).length;
  let html = `
    <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
      <div><strong>ID:</strong> ${idDespacho}</div>
      <div><strong>Cliente:</strong> ${datosDespachoActual.cliente}</div>
      <div><strong>Tiempo:</strong> ${tiempoTotal} min</div>
      <div><strong>Items despachados:</strong> ${despachados}</div>
    </div>
  `;
  document.getElementById('despachoResumenContenido').innerHTML = html;
}

// ========================================
// 🆕 NUEVO DESPACHO (MODIFICADO)
// ========================================

function nuevoDespacho() {
  // ✅ LIMPIAR ESTADO GUARDADO
  limpiarEstadoDespacho();
  
  datosDespachoActual = { 
    cliente: '', 
    items: [], 
    tiempoInicio: null, 
    filtroActual: 'todos',
    faseActual: 'captura'
  };
  
  document.getElementById('despachoCliente').value = '';
  document.getElementById('despachoCodigos').value = '';
  document.getElementById('despachoImageInput').value = '';
  document.getElementById('despachoImagePreview').style.display = 'none';
  
  mostrarFaseCaptura();
}

function cancelarDespachoActual() {
  if (confirm('⚠️ ¿Seguro que quieres cancelar este despacho?')) {
    nuevoDespacho();
  }
}

// ========================================
// 🎨 MOSTRAR FASES
// ========================================

function mostrarFaseCaptura() {
  document.getElementById('despachoFaseCaptura').style.display = 'block';
  document.getElementById('despachoFaseValidacion').style.display = 'none';
  document.getElementById('despachoFasePicking').style.display = 'none';
  document.getElementById('despachoFaseResumen').style.display = 'none';
}

function mostrarFaseResumen() {
  document.getElementById('despachoFaseCaptura').style.display = 'none';
  document.getElementById('despachoFaseValidacion').style.display = 'none';
  document.getElementById('despachoFasePicking').style.display = 'none';
  document.getElementById('despachoFaseResumen').style.display = 'block';
}

// ========================================
// 🚀 AUTO-INICIALIZACIÓN
// ========================================

// ✅ LLAMAR AL CAMBIAR AL MÓDULO DESPACHO
function alCambiarAModuloDespacho() {
  inicializarModuloDespacho();
}
// ========================================
// ✏️ EDITAR - FUNCIONES COMPLETAS
// ========================================

function buscarParaEditarGlobal() {
  const codigo = document.getElementById('editarCodigoInput').value.trim();
  
  if (!codigo) {
    mostrarAlerta('editarAlerta', 'Ingresa un código', 'warning');
    return;
  }
  
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      
      if (respuesta.count > 0) {
        const item = respuesta.resultados[0];
        mostrarFormularioEdicion(item, respuesta.cleanedCode);
      } else {
        mostrarFormularioAgregarNuevo(respuesta.cleanedCode);
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('editarAlerta', 'Error: ' + error, 'error');
    })
    .buscarCodigoEditar(codigo);
}

function mostrarFormularioEdicion(item, codigoLimpio) {
  // Obtener la marca actual para preseleccionar
  const marcaActual = (item['Marca'] || '').toUpperCase().trim();
  
  const html = `
    <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin-top: 20px; margin-bottom: 15px;">
      <h4 style="color: #1d66c3; margin-bottom: 5px;">✏️ Editando Item</h4>
      <p style="font-size: 14px; color: #666; margin: 0;">Modifica los campos que necesites actualizar</p>
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Código (No editable)</label>
      <input type="text" id="editCodigo" class="input-custom" value="${item['Código']}" readonly style="background: #f5f5f5;">
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Descripción</label>
      <textarea id="editDescripcion" class="input-custom" rows="2">${item['Descripción'] || ''}</textarea>
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Marca</label>
      <select id="editMarca" class="input-custom">
        <option value="">Selecciona una marca...</option>
        <option value="SUZUKI" ${marcaActual === 'SUZUKI' ? 'selected' : ''}>Suzuki</option>
        <option value="LONCIN" ${marcaActual === 'LONCIN' ? 'selected' : ''}>Loncin</option>
        <option value="SYM" ${marcaActual === 'SYM' ? 'selected' : ''}>SYM</option>
        <option value="FUEGO" ${marcaActual === 'FUEGO' ? 'selected' : ''}>Fuego</option>
        <option value="CLUB CAR" ${marcaActual === 'CLUB CAR' ? 'selected' : ''}>Club Car</option>
        <option value="OTRAS" ${marcaActual === 'OTRAS' || (marcaActual && !['SUZUKI', 'LONCIN', 'SYM', 'FUEGO', 'CLUB CAR'].includes(marcaActual)) ? 'selected' : ''}>Otras</option>
      </select>
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Ubicación Principal</label>
      <input type="text" id="editUbicacion1" class="input-custom" placeholder="B-1-A-01-A" value="${item['Ubicación Principal'] || ''}">
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Ubicación 2 (opcional)</label>
      <input type="text" id="editUbicacion2" class="input-custom" placeholder="B-2-C-05-B" value="${item['Ubicación 2'] || ''}">
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Ubicación 3 (opcional)</label>
      <input type="text" id="editUbicacion3" class="input-custom" placeholder="C-1-A-03-A" value="${item['Ubicación 3'] || ''}">
    </div>

    <div class="input-group-custom">
     <label class="mb-2" style="font-weight: 700;">Ubicación 4 (opcional)</label>
     <input type="text" id="editUbicacion4" class="input-custom" placeholder="D-1-B-02-C" value="${item['Ubicación 4'] || ''}">
   </div>

   <div class="input-group-custom">
    <label class="mb-2" style="font-weight: 700;">Ubicación 5 (opcional)</label>
    <input type="text" id="editUbicacion5" class="input-custom" placeholder="E-2-A-04-D" value="${item['Ubicación 5'] || ''}">
  </div>
    
    <button class="btn-success-custom" onclick="guardarEdicion('${codigoLimpio}')">
      <i class="fas fa-save"></i> Guardar Cambios
    </button>
    
    <button class="btn-warning-custom" onclick="confirmarEliminacion('${codigoLimpio}')">
      <i class="fas fa-trash"></i> Eliminar Item
    </button>
    
    <button class="btn-secondary-custom" onclick="limpiarModulo('editar')">
      <i class="fas fa-times"></i> Cancelar
    </button>
  `;
  
  document.getElementById('editarFormulario').innerHTML = html;
}

function mostrarFormularioAgregarNuevo(codigoLimpio) {
  mostrarAlerta('editarAlerta', `⚠️ Código no encontrado: ${codigoLimpio}. Puedes agregarlo como nuevo item.`, 'warning');
  
  const html = `
    <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin-top: 20px; margin-bottom: 15px;">
      <h4 style="color: #856404; margin-bottom: 5px;">➕ Agregar Nuevo Item</h4>
      <p style="font-size: 14px; color: #666; margin: 0;">El código escaneado no existe. Completa la información para agregarlo.</p>
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Código</label>
      <input type="text" id="nuevoCodigo" class="input-custom" value="${codigoLimpio}" readonly style="background: #f5f5f5;">
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Descripción *</label>
      <textarea id="nuevaDescripcion" class="input-custom" rows="2" placeholder="Descripción del repuesto"></textarea>
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Marca *</label>
      <select id="nuevaMarca" class="input-custom">
        <option value="">Selecciona una marca...</option>
        <option value="SUZUKI">Suzuki</option>
        <option value="LONCIN">Loncin</option>
        <option value="SYM">SYM</option>
        <option value="FUEGO">Fuego</option>
        <option value="CLUB CAR">Club Car</option>
        <option value="OTRAS">Otras</option>
      </select>
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Ubicación (opcional)</label>
      <input type="text" id="nuevaUbicacion" class="input-custom" placeholder="B-1-A-01-A">
    </div>
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
      <button class="btn-success-custom" onclick="agregarNuevoItemCompleto()">
        <i class="fas fa-plus"></i> Agregar al Inventario
      </button>
      <button class="btn-primary-custom" onclick="abrirAsistenteIA(document.getElementById('nuevoCodigo').value, document.getElementById('nuevaMarca').value)">
        <i class="fas fa-brain"></i> Preguntar al AI
      </button>
    </div>

    <button class="btn-secondary-custom" onclick="limpiarModulo('editar')">
      <i class="fas fa-times"></i> Cancelar
    </button>
  `;
  
  document.getElementById('editarFormulario').innerHTML = html;
}
function guardarEdicion(codigo) {
  const data = {
    'Descripción': document.getElementById('editDescripcion').value.trim(),
    'Marca': document.getElementById('editMarca').value.trim(),
    'Ubicación Principal': document.getElementById('editUbicacion1').value.trim(),
    'Ubicación 2': document.getElementById('editUbicacion2').value.trim(),
    'Ubicación 3': document.getElementById('editUbicacion3').value.trim(),
    'Ubicación 4': document.getElementById('editUbicacion4').value.trim(),
    'Ubicación 5': document.getElementById('editUbicacion5').value.trim()
  };
  
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      
      if (respuesta.success) {
        mostrarAlerta('editarAlerta', '✅ Cambios guardados exitosamente', 'success');
        setTimeout(() => {
          limpiarModulo('editar');
        }, 1500);
      } else {
        mostrarAlerta('editarAlerta', 'Error: ' + respuesta.message, 'error');
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('editarAlerta', 'Error de conexión: ' + error, 'error');
    })
    .guardarEdicionEnSheet(codigo, data);
}

function agregarNuevoItemCompleto() {
  const codigo = document.getElementById('nuevoCodigo').value.trim();
  const descripcion = document.getElementById('nuevaDescripcion').value.trim();
  const marca = document.getElementById('nuevaMarca').value;
  const ubicacion = document.getElementById('nuevaUbicacion').value.trim();
  
  if (!descripcion) {
    mostrarAlerta('editarAlerta', 'La descripción es obligatoria', 'warning');
    return;
  }
  
  if (!marca) {
    mostrarAlerta('editarAlerta', 'Selecciona una marca', 'warning');
    return;
  }
  
  const data = {
    codigo: codigo,
    descripcion: descripcion,
    marca: marca,
    ubicacion1: ubicacion,
    ubicacion2: '',
    ubicacion3: '',
    ubicacion4: '',
    ubicacion5: ''
  };
  
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      
      if (respuesta.success) {
        mostrarAlerta('editarAlerta', '✅ Item agregado al inventario', 'success');
        setTimeout(() => {
          limpiarModulo('editar');
        }, 1500);
      } else {
        mostrarAlerta('editarAlerta', 'Error: ' + respuesta.message, 'error');
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('editarAlerta', 'Error de conexión: ' + error, 'error');
    })
    .agregarNuevoItem(data);
}

function confirmarEliminacion(codigo) {
  mostrarModal(
    '⚠️ Eliminar Item',
    `¿Estás seguro de eliminar el item ${codigo}? Esta acción moverá el item a la papelera.`,
    null,
    [
      { texto: 'Cancelar', clase: 'modal-btn-secondary', callback: cerrarModal },
      { 
        texto: 'Eliminar', 
        clase: 'modal-btn-danger', 
        callback: () => { 
          cerrarModal(); 
          solicitarMotivoEliminacion(codigo);
        } 
      }
    ]
  );
}

function solicitarMotivoEliminacion(codigo) {
  const html = `
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Motivo de eliminación</label>
      <textarea id="motivoEliminacion" class="input-custom" rows="3" placeholder="Describe por qué se elimina este item..."></textarea>
    </div>
  `;
  
  mostrarModal(
    'Motivo de Eliminación',
    'Por favor indica el motivo para eliminar este item:',
    html,
    [
      { texto: 'Cancelar', clase: 'modal-btn-secondary', callback: cerrarModal },
      { 
        texto: 'Confirmar Eliminación', 
        clase: 'modal-btn-danger', 
        callback: () => { 
          const motivo = document.getElementById('motivoEliminacion').value.trim();
          cerrarModal();
          ejecutarEliminacion(codigo, motivo);
        } 
      }
    ]
  );
  
  // Mostrar el input después de que el modal se renderice
setTimeout(() => {
  document.getElementById('modalInput').style.display = 'none';
  const htmlContainer = document.getElementById('modalHtmlContent');
  htmlContainer.style.display = 'block';
  htmlContainer.innerHTML = html;
}, 100);
}

function ejecutarEliminacion(codigo, motivo) {
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      
      if (respuesta.success) {
        mostrarAlerta('editarAlerta', '✅ Item eliminado y movido a papelera', 'success');
        setTimeout(() => {
          limpiarModulo('editar');
        }, 1500);
      } else {
        mostrarAlerta('editarAlerta', 'Error: ' + respuesta.message, 'error');
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('editarAlerta', 'Error de conexión: ' + error, 'error');
    })
    .eliminarItem(codigo, motivo);
}
// ========================================
// 📊 DASHBOARD JEFE - FUNCIONES COMPLETAS
// ========================================

function cargarDatosJefe() {
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(datos => {
      mostrarCargando(false);
      
      if (datos.success) {
        // Actualizar cards de estadísticas
        document.getElementById('totalArticulosCard').textContent = datos.stats.totalArticulos || '0';
        document.getElementById('totalUbicacionesCard').textContent = datos.stats.totalUbicaciones || '0';
        document.getElementById('totalAuditoriasCard').textContent = datos.stats.totalAuditorias || '0';
        document.getElementById('totalRecepcionesCard').textContent = datos.stats.totalRecepciones || '0';
        
        // Actualizar barra de progreso de verificaciones
        const progreso = datos.stats.progresoVerificacion || 0;
        document.getElementById('barrProgreso').style.width = progreso + '%';
        document.getElementById('barrProgreso').textContent = progreso + '%';
        document.getElementById('verificacionesCompletadas').textContent = datos.stats.verificacionesCompletadas || '0';
        document.getElementById('verificacionesTotales').textContent = datos.stats.verificacionesTotales || '0';
        
        // Mostrar tabla de rendimiento de almacenistas
        mostrarRendimientoAlmacenistas(datos.rendimientoAlmacenistas);
        
        mostrarAlerta('dashboardJefeAlerta', '✅ Datos actualizados correctamente', 'success');
      } else {
        mostrarAlerta('dashboardJefeAlerta', 'Error: ' + datos.message, 'error');
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('dashboardJefeAlerta', 'Error de conexión: ' + error, 'error');
    })
    .obtenerDatosJefeBodega();
}

function mostrarRendimientoAlmacenistas(rendimiento) {
  if (!rendimiento || rendimiento.length === 0) {
    return;
  }
  
  // Buscar o crear contenedor para la tabla
  let container = document.getElementById('rendimientoAlmacenistas');
  if (!container) {
    // Crear contenedor si no existe
    const cardBody = document.querySelector('#modulo-dashboard-jefe .card-body-custom');
    container = document.createElement('div');
    container.id = 'rendimientoAlmacenistas';
    container.style.marginTop = '30px';
    cardBody.insertBefore(container, cardBody.children[2]); // Insertar después de las stats
  }
  
  let html = `
    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
      <h4 style="color: #1d66c3; margin-bottom: 15px; font-weight: 800;">
        <i class="fas fa-users"></i> Rendimiento de Almacenistas (Últimos 7 días)
      </h4>
      
      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: #1d66c3; color: white;">
              <th style="padding: 12px; text-align: left; border-radius: 8px 0 0 0;">Almacenista</th>
              <th style="padding: 12px; text-align: center;">Códigos/Hora</th>
              <th style="padding: 12px; text-align: center;">Precisión</th>
              <th style="padding: 12px; text-align: center;">Intrusos</th>
              <th style="padding: 12px; text-align: center; border-radius: 0 8px 0 0;">Estado</th>
            </tr>
          </thead>
          <tbody>
  `;
  
  rendimiento.forEach((persona, index) => {
    const bgColor = index % 2 === 0 ? '#ffffff' : '#f8f9fa';
    const precisionNum = parseFloat(persona.precision);
    const precisionColor = precisionNum >= 95 ? '#28a745' : precisionNum >= 85 ? '#ffc107' : '#dc3545';
    
    html += `
      <tr style="background: ${bgColor};">
        <td style="padding: 12px; border-bottom: 1px solid #dee2e6;">
          <strong>${persona.usuario}</strong>
        </td>
        <td style="padding: 12px; text-align: center; border-bottom: 1px solid #dee2e6;">
          <span style="background: #e3f2fd; color: #1d66c3; padding: 4px 12px; border-radius: 12px; font-weight: 700;">
            ${persona.codigosPorHora}
          </span>
        </td>
        <td style="padding: 12px; text-align: center; border-bottom: 1px solid #dee2e6;">
          <span style="background: ${precisionColor}; color: white; padding: 4px 12px; border-radius: 12px; font-weight: 700;">
            ${persona.precision}
          </span>
        </td>
        <td style="padding: 12px; text-align: center; border-bottom: 1px solid #dee2e6;">
          <span style="color: ${persona.intrusos > 5 ? '#dc3545' : '#28a745'}; font-weight: 700;">
            ${persona.intrusos}
          </span>
        </td>
        <td style="padding: 12px; text-align: center; border-bottom: 1px solid #dee2e6;">
          ${persona.estado}
        </td>
      </tr>
    `;
  });
  
  html += `
          </tbody>
        </table>
      </div>
      
      <div style="margin-top: 15px; padding: 10px; background: #e3f2fd; border-radius: 5px;">
        <small style="color: #1d66c3;">
          <i class="fas fa-info-circle"></i> 
          <strong>Códigos/Hora:</strong> Promedio de códigos procesados por hora de trabajo |
          <strong>Precisión:</strong> % de códigos correctamente identificados |
          <strong>Intrusos:</strong> Códigos encontrados en ubicaciones incorrectas
        </small>
      </div>
    </div>
  `;
  
  container.innerHTML = html;
}

function descargarReportePDF() {
  mostrarAlerta('dashboardJefeAlerta', 'Generando reporte PDF...', 'info');
  
  // Recopilar datos actuales
  const stats = {
    totalArticulos: document.getElementById('totalArticulosCard').textContent,
    totalUbicaciones: document.getElementById('totalUbicacionesCard').textContent,
    totalAuditorias: document.getElementById('totalAuditoriasCard').textContent,
    totalRecepciones: document.getElementById('totalRecepcionesCard').textContent,
    verificacionesCompletadas: document.getElementById('verificacionesCompletadas').textContent,
    verificacionesTotales: document.getElementById('verificacionesTotales').textContent,
    progreso: document.getElementById('barrProgreso').textContent
  };
  
  // Generar HTML para el reporte
  const htmlReporte = `
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; padding: 30px; }
        .header { background: #1d66c3; color: white; padding: 20px; text-align: center; margin-bottom: 30px; }
        .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 30px; }
        .stat-box { border: 2px solid #1d66c3; padding: 15px; text-align: center; border-radius: 8px; }
        .stat-value { font-size: 36px; font-weight: bold; color: #1d66c3; }
        .stat-label { font-size: 14px; color: #666; margin-top: 5px; }
        .footer { text-align: center; margin-top: 50px; font-size: 12px; color: #999; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>PartFinder SukiMotor</h1>
        <p>Reporte Ejecutivo - Dashboard Jefe de Bodega</p>
        <p>Generado: ${new Date().toLocaleString('es-PA')}</p>
      </div>
      
      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-value">${stats.totalArticulos}</div>
          <div class="stat-label">Total Artículos</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">${stats.totalUbicaciones}</div>
          <div class="stat-label">Ubicaciones</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">${stats.totalAuditorias}</div>
          <div class="stat-label">Auditorías</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">${stats.totalRecepciones}</div>
          <div class="stat-label">Recepciones</div>
        </div>
      </div>
      
      <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 30px;">
        <h3 style="color: #1d66c3;">Progreso de Verificaciones</h3>
        <p style="font-size: 18px;">
          <strong>${stats.verificacionesCompletadas}</strong> de <strong>${stats.verificacionesTotales}</strong> ubicaciones verificadas 
          (<strong>${stats.progreso}</strong>)
        </p>
        <div style="background: #ddd; height: 30px; border-radius: 15px; overflow: hidden;">
          <div style="background: #28a745; height: 100%; width: ${stats.progreso}; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;">
            ${stats.progreso}
          </div>
        </div>
      </div>
      
      <div class="footer">
        <p>© 2025 SZ Motor - Sistema PartFinder</p>
        <p>Documento generado automáticamente</p>
      </div>
    </body>
    </html>
  `;
  
  // Abrir en nueva ventana para imprimir/guardar como PDF
  const ventana = window.open('', '_blank');
  ventana.document.write(htmlReporte);
  ventana.document.close();
  
  // Auto-abrir diálogo de impresión
  setTimeout(() => {
    ventana.print();
  }, 500);
  
  mostrarAlerta('dashboardJefeAlerta', '✅ Reporte abierto en nueva ventana. Usa "Guardar como PDF" en el diálogo de impresión.', 'success');
}
// ========================================
// ⚙️ PANEL ADMIN - FUNCIONES COMPLETAS
// ========================================

function cargarPanelAdmin() {
  console.log("✅ Iniciando cargarPanelAdmin");
  
  const html = `
    <div class="tab-buttons">
      <button class="tab-button active" onclick="mostrarTabAdmin('usuarios')">
        <i class="fas fa-users"></i> Usuarios
      </button>
      <button class="tab-button" onclick="mostrarTabAdmin('logs')">
        <i class="fas fa-list"></i> Logs del Sistema
      </button>
      <button class="tab-button" onclick="mostrarTabAdmin('config')">
        <i class="fas fa-cog"></i> Configuración
      </button>
    </div>
    
    <div id="admin-tab-usuarios" style="display: block;">
      <div style="margin-bottom: 15px;">
        <button class="btn-success-custom" onclick="mostrarFormularioNuevoUsuario()">
          <i class="fas fa-user-plus"></i> Agregar Usuario
        </button>
        <button class="btn-primary-custom" onclick="cargarUsuariosAdmin()">
          <i class="fas fa-sync"></i> Actualizar Lista
        </button>
      </div>
      <div id="listaUsuarios">
        <div style="text-align: center; padding: 40px;">
          <i class="fas fa-spinner fa-spin" style="font-size: 48px; color: #1d66c3;"></i>
          <p style="margin-top: 15px; color: #666;">Cargando usuarios...</p>
        </div>
      </div>
    </div>
    
    <div id="admin-tab-logs" style="display: none;">
      <div class="input-group-custom">
        <label class="mb-2">Filtrar por usuario</label>
        <input type="text" id="filtroUsuarioLogs" class="input-custom" placeholder="Email del usuario">
      </div>
      <button class="btn-primary-custom" onclick="cargarLogsAdmin()">
        <i class="fas fa-search"></i> Buscar Logs
      </button>
      <div id="listaLogs"></div>
    </div>
    
    <div id="admin-tab-config" style="display: none;">
      <div style="padding: 30px; text-align: center;">
        <i class="fas fa-tools" style="font-size: 48px; color: #1d66c3; margin-bottom: 15px;"></i>
        <h4>Configuración del Sistema</h4>
        <p style="color: #666;">Panel de configuración en desarrollo</p>
      </div>
    </div>
  `;
  
  // Reemplazar el contenido placeholder
  const adminCard = document.querySelector('#modulo-admin .card-body-custom');
  
  if (!adminCard) {
    console.error("❌ No se encontró el contenedor #modulo-admin .card-body-custom");
    alert("Error: No se pudo cargar el panel admin. Revisa la consola.");
    return;
  }
  
  adminCard.innerHTML = html;
  console.log("✅ HTML del panel admin insertado");
  
  // ⭐ ESPERAR A QUE EL DOM SE ACTUALICE ANTES DE CARGAR USUARIOS
  setTimeout(() => {
    console.log("🔄 Verificando que el container existe...");
    const container = document.getElementById('listaUsuarios');
    if (container) {
      console.log("✅ Container encontrado, cargando usuarios...");
      cargarUsuariosAdmin();
    } else {
      console.error("❌ Container 'listaUsuarios' no encontrado después de insertar HTML");
    }
  }, 300);
}

function mostrarTabAdmin(tab) {
  // Actualizar botones
  document.querySelectorAll('#modulo-admin .tab-button').forEach(btn => btn.classList.remove('active'));
  event.target.closest('.tab-button').classList.add('active');
  
  // Mostrar tab correspondiente
  document.getElementById('admin-tab-usuarios').style.display = 'none';
  document.getElementById('admin-tab-logs').style.display = 'none';
  document.getElementById('admin-tab-config').style.display = 'none';
  
  document.getElementById('admin-tab-' + tab).style.display = 'block';
  
  // Cargar datos según tab
  if (tab === 'usuarios') {
    cargarUsuariosAdmin();
  } else if (tab === 'logs') {
    cargarLogsAdmin();
  } else if (tab === 'config') {  // ✅ ESTA LÍNEA ES NUEVA
    cargarConfiguracionAdmin();   // ✅ ESTA LÍNEA ES NUEVA
  }                                // ✅ ESTA LÍNEA ES NUEVA
}

// ========================================
// 👥 TAB USUARIOS
// ========================================

function cargarUsuariosAdmin() {
  console.log("📥 Iniciando cargarUsuariosAdmin");
  
  // Mostrar mensaje de carga
  const container = document.getElementById('listaUsuarios');
  if (container) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px;">
        <i class="fas fa-spinner fa-spin" style="font-size: 48px; color: #1d66c3;"></i>
        <p style="margin-top: 15px; color: #666;">Cargando usuarios...</p>
      </div>
    `;
  }
  
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      console.log("📦 Respuesta recibida:", respuesta);
      mostrarCargando(false);
      
      // ✅ VALIDACIÓN ROBUSTA
      if (!respuesta) {
        console.error("❌ Respuesta es null o undefined");
        mostrarErrorCargaUsuarios("El servidor no devolvió datos");
        return;
      }
      
      if (respuesta.success === true) {
        console.log(`✅ ${respuesta.usuarios.length} usuarios encontrados`);
        mostrarListaUsuarios(respuesta.usuarios);
      } else {
        console.error("❌ Error en respuesta:", respuesta.message);
        mostrarErrorCargaUsuarios(respuesta.message || "Error desconocido");
      }
    })
    .withFailureHandler(error => {
      console.error("💥 Error de conexión:", error);
      mostrarCargando(false);
      mostrarErrorCargaUsuarios("Error de conexión: " + error.message);
    })
    .obtenerUsuarios();
}

// Función auxiliar para mostrar errores
function mostrarErrorCargaUsuarios(mensaje) {
  const container = document.getElementById('listaUsuarios');
  if (container) {
    container.innerHTML = `
      <div style="background: #f8d7da; border-left: 4px solid #dc3545; padding: 20px; border-radius: 8px;">
        <h4 style="color: #721c24; margin: 0 0 10px 0;">
          <i class="fas fa-exclamation-triangle"></i> Error al cargar usuarios
        </h4>
        <p style="color: #721c24; margin: 0;">${mensaje}</p>
        <button onclick="cargarUsuariosAdmin()" style="margin-top: 15px; background: #dc3545; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer;">
          <i class="fas fa-sync"></i> Reintentar
        </button>
      </div>
    `;
  }
}

function mostrarListaUsuarios(usuarios) {
  console.log("🖼️ Renderizando lista de usuarios:", usuarios);
  
  const container = document.getElementById('listaUsuarios');
  
  if (!container) {
    console.error("❌ Container 'listaUsuarios' no encontrado");
    alert("Error: No se encontró el contenedor de usuarios");
    return;
  }
  
  if (!usuarios || usuarios.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px;">
        <i class="fas fa-users" style="font-size: 48px; color: #999; margin-bottom: 15px;"></i>
        <p style="color: #999; font-size: 16px;">No hay usuarios registrados</p>
        <button onclick="mostrarFormularioNuevoUsuario()" style="margin-top: 15px; background: #28a745; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer;">
          <i class="fas fa-user-plus"></i> Crear Primer Usuario
        </button>
      </div>
    `;
    return;
  }
  
  let html = `
    <div style="margin-bottom: 20px;">
      <h4 style="color: #1d66c3; margin: 0;">
        <i class="fas fa-users"></i> Usuarios del Sistema (${usuarios.length})
      </h4>
    </div>
  `;
  
  usuarios.forEach(usuario => {
    const estadoColor = usuario.activo ? '#28a745' : '#dc3545';
    const estadoIcono = usuario.activo ? '✅' : '❌';
    const estadoTexto = usuario.activo ? 'Activo' : 'Inactivo';
    
    // Formatear fecha
    let fechaAcceso = "Nunca";
    if (usuario.ultimoAcceso && usuario.ultimoAcceso !== "Nunca") {
      try {
        const fecha = new Date(usuario.ultimoAcceso);
        fechaAcceso = fecha.toLocaleString('es-PA');
      } catch (e) {
        fechaAcceso = usuario.ultimoAcceso;
      }
    }
    
    html += `
      <div class="resultado-item" style="border-left-color: ${estadoColor}; margin-bottom: 15px;">
        <div style="display: flex; justify-content: space-between; align-items: start;">
          <div style="flex: 1;">
            <div style="font-weight: 800; font-size: 16px; color: #1d66c3; margin-bottom: 8px;">
              <i class="fas fa-user"></i> ${usuario.email}
            </div>
            <div style="margin-bottom: 10px;">
              <span style="background: #e3f2fd; color: #1d66c3; padding: 5px 12px; border-radius: 12px; font-size: 12px; font-weight: 700; margin-right: 8px;">
                <i class="fas fa-id-badge"></i> ${usuario.rol}
              </span>
              <span style="background: ${estadoColor}; color: white; padding: 5px 12px; border-radius: 12px; font-size: 12px; font-weight: 700;">
                ${estadoIcono} ${estadoTexto}
              </span>
            </div>
            <div style="font-size: 13px; color: #666;">
              <i class="fas fa-clock"></i> Último acceso: ${fechaAcceso}
            </div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button onclick="editarUsuarioAdmin('${usuario.email}')" style="background: #ffc107; color: #000; border: none; padding: 10px 15px; border-radius: 5px; cursor: pointer; font-weight: 700;" title="Editar permisos">
              <i class="fas fa-edit"></i> Editar
            </button>
            <button onclick="eliminarUsuarioAdmin('${usuario.email}')" style="background: #dc3545; color: white; border: none; padding: 10px 15px; border-radius: 5px; cursor: pointer; font-weight: 700;" title="Eliminar">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
  console.log("✅ Lista de usuarios renderizada correctamente");
}

// ========================================
// ➕ CREAR NUEVO USUARIO
// ========================================

function mostrarFormularioNuevoUsuario() {
  const html = `
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Email *</label>
      <input type="email" id="nuevoUsuarioEmail" class="input-custom" placeholder="usuario@suz.com.pa">
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">PIN (4 dígitos) *</label>
      <input type="password" id="nuevoUsuarioPIN" class="input-custom" placeholder="1234" maxlength="4">
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Rol *</label>
      <select id="nuevoUsuarioRol" class="input-custom">
        <option value="">Selecciona un rol...</option>
        <option value="Admin">Admin - Acceso total</option>
        <option value="Jefe Bodega">Jefe Bodega - Gestión y reportes</option>
        <option value="Almacenista">Almacenista - Operaciones básicas</option>
        <option value="Visualizador">Visualizador - Solo lectura</option>
      </select>
    </div>
    
    <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
      <h5 style="color: #1d66c3; margin-bottom: 10px; font-weight: 700;">Permisos del usuario:</h5>
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
        <label style="display: flex; align-items: center; cursor: pointer;">
          <input type="checkbox" id="perm_buscar" style="margin-right: 8px; width: 18px; height: 18px;" checked>
          <span>Buscar</span>
        </label>
        <label style="display: flex; align-items: center; cursor: pointer;">
          <input type="checkbox" id="perm_ubicaciones" style="margin-right: 8px; width: 18px; height: 18px;" checked>
          <span>Ubicaciones</span>
        </label>
        <label style="display: flex; align-items: center; cursor: pointer;">
          <input type="checkbox" id="perm_verificar" style="margin-right: 8px; width: 18px; height: 18px;" checked>
          <span>Verificar</span>
        </label>
        <label style="display: flex; align-items: center; cursor: pointer;">
          <input type="checkbox" id="perm_recepcion" style="margin-right: 8px; width: 18px; height: 18px;">
          <span>Recepción</span>
        </label>
        <label style="display: flex; align-items: center; cursor: pointer;">
          <input type="checkbox" id="perm_auditoria" style="margin-right: 8px; width: 18px; height: 18px;">
          <span>Auditoría</span>
        </label>
        <label style="display: flex; align-items: center; cursor: pointer;">
          <input type="checkbox" id="perm_editar" style="margin-right: 8px; width: 18px; height: 18px;">
          <span>Editar</span>
        </label>
        <label style="display: flex; align-items: center; cursor: pointer;">
    <input type="checkbox" id="perm_despacho" style="margin-right: 8px; width: 18px; height: 18px;">
    <span>Despacho</span>
  </label>
        <label style="display: flex; align-items: center; cursor: pointer;">
          <input type="checkbox" id="perm_dashboard" style="margin-right: 8px; width: 18px; height: 18px;">
          <span>Dashboard</span>
        </label>
        <label style="display: flex; align-items: center; cursor: pointer;">
          <input type="checkbox" id="perm_admin" style="margin-right: 8px; width: 18px; height: 18px;">
          <span>Admin</span>
        </label>
        <label style="display: flex; align-items: center; cursor: pointer;">
          <input type="checkbox" id="perm_conteo" style="margin-right: 8px; width: 18px; height: 18px;">
          <span>Conteo Físico</span>
        </label>
      </div>
    </div>
  `;

  mostrarModal(
    'Agregar Nuevo Usuario',
    'Completa la información del nuevo usuario:',
    html,
    [
      { texto: 'Cancelar', clase: 'modal-btn-secondary', callback: cerrarModal },
      { 
        texto: 'Crear Usuario', 
        clase: 'modal-btn-success', 
        callback: () => ejecutarCrearUsuario()
      }
    ]
  );
  
  // Mostrar el HTML en el modal
setTimeout(() => {
  document.getElementById('modalInput').style.display = 'none';
  const htmlContainer = document.getElementById('modalHtmlContent');
  htmlContainer.style.display = 'block';
  htmlContainer.innerHTML = html;
}, 100);
}

function ejecutarCrearUsuario() {
  const email = document.getElementById('nuevoUsuarioEmail').value.trim();
  const pin = document.getElementById('nuevoUsuarioPIN').value.trim();
  const rol = document.getElementById('nuevoUsuarioRol').value;
  
  if (!email || !pin || !rol) {
    alert('Completa todos los campos obligatorios');
    return;
  }
  
  if (pin.length !== 4 || isNaN(pin)) {
    alert('El PIN debe ser de 4 dígitos numéricos');
    return;
  }
  
  const permisos = {
    buscar: document.getElementById('perm_buscar').checked,
    ubicaciones: document.getElementById('perm_ubicaciones').checked,
    verificar: document.getElementById('perm_verificar').checked,
    recepcion: document.getElementById('perm_recepcion').checked,
    auditoria: document.getElementById('perm_auditoria').checked,
    editar: document.getElementById('perm_editar').checked,
    dashboard: document.getElementById('perm_dashboard').checked,
    admin: document.getElementById('perm_admin').checked,
    conteo: document.getElementById('perm_conteo').checked
  };

  cerrarModal();
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      
      if (respuesta.success) {
        mostrarAlerta('adminAlerta', '✅ Usuario creado exitosamente', 'success');
        cargarUsuariosAdmin();
      } else {
        mostrarAlerta('adminAlerta', 'Error: ' + respuesta.message, 'error');
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('adminAlerta', 'Error: ' + error, 'error');
    })
    .agregarUsuario(email, pin, rol, permisos);
}

// ========================================
// ✏️ EDITAR USUARIO
// ========================================

function editarUsuarioAdmin(email) {
  if (!email || email.trim() === '') {
    mostrarAlerta('adminAlerta', '❌ Email de usuario no válido', 'error');
    return;
  }
  
  console.log("🔍 Editando usuario:", email);
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      console.log("📥 Respuesta recibida:", respuesta);
      
      // Validar que respuesta no sea null
      if (!respuesta) {
        console.error("💥 Respuesta es null");
        mostrarAlerta('adminAlerta', '❌ Error: El servidor no devolvió datos', 'error');
        return;
      }
      
      // Validar que tenga la propiedad success
      if (typeof respuesta.success === 'undefined') {
        console.error("💥 Respuesta sin propiedad success:", respuesta);
        mostrarAlerta('adminAlerta', '❌ Error: Respuesta del servidor inválida', 'error');
        return;
      }
      
      // Procesar según resultado
      if (respuesta.success) {
        if (respuesta.data) {
          console.log("✅ Usuario encontrado:", respuesta.data);
          mostrarFormularioEditarUsuario(respuesta.data);
        } else {
          console.error("💥 Success true pero sin data");
          mostrarAlerta('adminAlerta', '❌ Error: Usuario sin datos', 'error');
        }
      } else {
        console.error("❌ Error del servidor:", respuesta.message);
        mostrarAlerta('adminAlerta', '❌ Error: ' + (respuesta.message || 'Error desconocido'), 'error');
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      console.error("💥 Error de conexión:", error);
      mostrarAlerta('adminAlerta', '❌ Error de conexión: ' + error.message, 'error');
    })
    .obtenerUsuarioPorEmail(email);
}

function mostrarFormularioEditarUsuario(usuario) {
  const permisos = usuario.permisos || {};
  
  const html = `
    <div style="margin-bottom: 20px;">
      <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
        <strong style="color: #1d66c3;">Email:</strong> ${usuario.email}
      </div>
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Rol</label>
      <select id="editarUsuarioRol" class="input-custom">
        <option value="Admin" ${usuario.rol === 'Admin' ? 'selected' : ''}>Admin - Acceso total</option>
        <option value="Jefe Bodega" ${usuario.rol === 'Jefe Bodega' ? 'selected' : ''}>Jefe Bodega - Gestión y reportes</option>
        <option value="Almacenista" ${usuario.rol === 'Almacenista' ? 'selected' : ''}>Almacenista - Operaciones básicas</option>
        <option value="Visualizador" ${usuario.rol === 'Visualizador' ? 'selected' : ''}>Visualizador - Solo lectura</option>
      </select>
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Estado</label>
      <select id="editarUsuarioActivo" class="input-custom">
        <option value="true" ${usuario.activo ? 'selected' : ''}>✅ Activo - Puede acceder al sistema</option>
        <option value="false" ${!usuario.activo ? 'selected' : ''}>❌ Inactivo - Sin acceso</option>
      </select>
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Nuevo PIN (opcional)</label>
      <input type="password" id="editarUsuarioPIN" class="input-custom" placeholder="Dejar vacío para mantener el actual" maxlength="4">
      <small style="color: #666; font-size: 12px;">Solo completa si deseas cambiar el PIN del usuario</small>
    </div>
    
    <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-top: 15px;">
      <h5 style="color: #1d66c3; margin-bottom: 10px; font-weight: 700;">Permisos del usuario:</h5>
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
        <label style="display: flex; align-items: center; cursor: pointer;">
          <input type="checkbox" id="edit_perm_buscar" style="margin-right: 8px; width: 18px; height: 18px;" ${permisos.buscar ? 'checked' : ''}>
          <span>Buscar</span>
        </label>
        <label style="display: flex; align-items: center; cursor: pointer;">
          <input type="checkbox" id="edit_perm_ubicaciones" style="margin-right: 8px; width: 18px; height: 18px;" ${permisos.ubicaciones ? 'checked' : ''}>
          <span>Ubicaciones</span>
        </label>
        <label style="display: flex; align-items: center; cursor: pointer;">
          <input type="checkbox" id="edit_perm_verificar" style="margin-right: 8px; width: 18px; height: 18px;" ${permisos.verificar ? 'checked' : ''}>
          <span>Verificar</span>
        </label>
        <label style="display: flex; align-items: center; cursor: pointer;">
          <input type="checkbox" id="edit_perm_recepcion" style="margin-right: 8px; width: 18px; height: 18px;" ${permisos.recepcion ? 'checked' : ''}>
          <span>Recepción</span>
        </label>
        <label style="display: flex; align-items: center; cursor: pointer;">
          <input type="checkbox" id="edit_perm_auditoria" style="margin-right: 8px; width: 18px; height: 18px;" ${permisos.auditoria ? 'checked' : ''}>
          <span>Auditoría</span>
        </label>
        <label style="display: flex; align-items: center; cursor: pointer;">
          <input type="checkbox" id="edit_perm_editar" style="margin-right: 8px; width: 18px; height: 18px;" ${permisos.editar ? 'checked' : ''}>
          <span>Editar</span>
        </label>
        <label style="display: flex; align-items: center; cursor: pointer;">
          <input type="checkbox" id="edit_perm_dashboard" style="margin-right: 8px; width: 18px; height: 18px;" ${permisos.dashboard ? 'checked' : ''}>
          <span>Dashboard</span>
        </label>
        <label style="display: flex; align-items: center; cursor: pointer;">
          <input type="checkbox" id="edit_perm_admin" style="margin-right: 8px; width: 18px; height: 18px;" ${permisos.admin ? 'checked' : ''}>
          <span>Admin</span>
        </label>
        <label style="display: flex; align-items: center; cursor: pointer;">
          <input type="checkbox" id="edit_perm_despacho" style="margin-right: 8px; width: 18px; height: 18px;" ${permisos.despacho ? 'checked' : ''}>
          <span>Despacho</span>
        </label>
        <label style="display: flex; align-items: center; cursor: pointer;">
          <input type="checkbox" id="edit_perm_conteo" style="margin-right: 8px; width: 18px; height: 18px;" ${permisos.conteo ? 'checked' : ''}>
          <span>Conteo Físico</span>
        </label>
      </div>
    </div>

    <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; border-radius: 5px; margin-top: 15px;">
      <small style="color: #856404;">
        <i class="fas fa-info-circle"></i>
        <strong>Nota:</strong> El usuario deberá cerrar sesión y volver a iniciar para ver los cambios aplicados.
      </small>
    </div>
  `;
  
  mostrarModal(
    'Editar Usuario',
    'Modifica los datos del usuario:',
    html,
    [
      { texto: 'Cancelar', clase: 'modal-btn-secondary', callback: cerrarModal },
      { 
        texto: 'Guardar Cambios', 
        clase: 'modal-btn-success', 
        callback: () => ejecutarEditarUsuario(usuario.email)
      }
    ]
  );
  
setTimeout(() => {
  document.getElementById('modalInput').style.display = 'none';
  const htmlContainer = document.getElementById('modalHtmlContent');
  htmlContainer.style.display = 'block';
  htmlContainer.innerHTML = html;
}, 100);
}

function ejecutarEditarUsuario(email) {
  const rol = document.getElementById('editarUsuarioRol').value;
  const activoStr = document.getElementById('editarUsuarioActivo').value;
  const nuevoPin = document.getElementById('editarUsuarioPIN').value.trim();
  
  // ✅ CORRECCIÓN: Convertir explícitamente a booleano
  const activo = (activoStr === 'true' || activoStr === true);
  
  if (nuevoPin && (nuevoPin.length !== 4 || isNaN(nuevoPin))) {
    alert('El PIN debe ser de 4 dígitos numéricos');
    return;
  }
  
  const permisos = {
    buscar: document.getElementById('edit_perm_buscar').checked,
    ubicaciones: document.getElementById('edit_perm_ubicaciones').checked,
    verificar: document.getElementById('edit_perm_verificar').checked,
    recepcion: document.getElementById('edit_perm_recepcion').checked,
    auditoria: document.getElementById('edit_perm_auditoria').checked,
    editar: document.getElementById('edit_perm_editar').checked,
    despacho: document.getElementById('edit_perm_despacho').checked,
    dashboard: document.getElementById('edit_perm_dashboard').checked,
    admin: document.getElementById('edit_perm_admin').checked,
    conteo: document.getElementById('edit_perm_conteo').checked
  };
  
  const datosActualizados = {
    email: email,
    rol: rol,
    activo: activo,  // ✅ Ahora es un booleano limpio
    permisos: permisos,
    nuevoPin: nuevoPin || null
  };
  
  cerrarModal();
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      
      if (respuesta.success) {
        mostrarAlerta('adminAlerta', '✅ Usuario actualizado exitosamente', 'success');
        cargarUsuariosAdmin();
      } else {
        mostrarAlerta('adminAlerta', 'Error: ' + respuesta.message, 'error');
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('adminAlerta', 'Error: ' + error, 'error');
    })
    .actualizarUsuario(datosActualizados);
}

// ========================================
// 🗑️ ELIMINAR USUARIO
// ========================================

function eliminarUsuarioAdmin(email) {
  mostrarConfirmacion(
    '⚠️ Eliminar Usuario',
    `¿Estás seguro de eliminar el usuario ${email}? Esta acción no se puede deshacer.`,
    () => {
      ejecutarEliminarUsuario(email);
    }
  );
}

function ejecutarEliminarUsuario(email) {
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      
      if (respuesta.success) {
        mostrarAlerta('adminAlerta', '✅ Usuario eliminado', 'success');
        cargarUsuariosAdmin();
      } else {
        mostrarAlerta('adminAlerta', 'Error: ' + respuesta.message, 'error');
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('adminAlerta', 'Error: ' + error, 'error');
    })
    .eliminarUsuario(email);
}

function cargarLogsAdmin() {
  const filtroUsuario = document.getElementById('filtroUsuarioLogs').value.trim();
  
  const filtros = {
    usuario: filtroUsuario,
    limite: 100
  };
  
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      
      if (respuesta.success) {
        mostrarListaLogs(respuesta.logs);
      } else {
        mostrarAlerta('adminAlerta', 'Error: ' + respuesta.message, 'error');
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('adminAlerta', 'Error: ' + error, 'error');
    })
    .obtenerLogs(filtros);
}

function mostrarListaLogs(logs) {
  const container = document.getElementById('listaLogs');
  
  if (logs.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No hay logs registrados</p>';
    return;
  }
  
  let html = '<h4 style="margin-top: 20px; margin-bottom: 15px;">📋 Logs del Sistema (últimos ' + logs.length + ')</h4>';
  
  logs.forEach(log => {
    const estadoColor = log.estado === 'OK' ? '#28a745' : '#dc3545';
    const estadoIcono = log.estado === 'OK' ? '✅' : '❌';
    
    html += `
      <div class="resultado-item" style="border-left-color: ${estadoColor};">
        <div style="display: flex; justify-content: between; align-items: start; margin-bottom: 8px;">
          <div style="flex: 1;">
            <div style="font-size: 12px; color: #999; margin-bottom: 5px;">
              <i class="fas fa-clock"></i> ${log.timestamp}
            </div>
            <div style="font-weight: 700; color: #1d66c3; margin-bottom: 5px;">
              ${log.usuario}
            </div>
            <div style="font-size: 14px; margin-bottom: 5px;">
              <strong>Acción:</strong> ${log.accion}
            </div>
            ${log.detalles ? '<div style="font-size: 13px; color: #666;">' + log.detalles + '</div>' : ''}
          </div>
          <span style="background: ${estadoColor}; color: white; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 700;">
            ${estadoIcono} ${log.estado}
          </span>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
}
// ========================================
// 👁️ VISUALIZADOR - FUNCIONES COMPLETAS
// ========================================

function cargarVisualizador() {
  const html = `
    <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
      <h4 style="color: #1d66c3; margin-bottom: 10px;">
        <i class="fas fa-chart-line"></i> Visualizador de Reportes y Tendencias
      </h4>
      <p style="margin: 0; font-size: 14px; color: #666;">
        Analiza el rendimiento del almacén y las operaciones realizadas
      </p>
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Fecha Inicio</label>
      <input type="date" id="visualizadorFechaInicio" class="input-custom" value="${getFechaHace30Dias()}">
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Fecha Fin</label>
      <input type="date" id="visualizadorFechaFin" class="input-custom" value="${getFechaHoy()}">
    </div>
    
    <div class="input-group-custom">
      <label class="mb-2" style="font-weight: 700;">Filtrar por Usuario (opcional)</label>
      <input type="text" id="visualizadorUsuario" class="input-custom" placeholder="usuario@suz.com.pa">
    </div>
    
    <button class="btn-primary-custom" onclick="generarReporteVisualizado()">
      <i class="fas fa-chart-bar"></i> Generar Reporte
    </button>
    
    <div id="visualizadorResultados"></div>
  `;
  
  // Reemplazar contenido placeholder
  const visualizadorCard = document.querySelector('#modulo-visualizador .card-body-custom');
  visualizadorCard.innerHTML = html;
}

function getFechaHace30Dias() {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - 30);
  return fecha.toISOString().split('T')[0];
}

function getFechaHoy() {
  return new Date().toISOString().split('T')[0];
}

function generarReporteVisualizado() {
  const fechaInicio = document.getElementById('visualizadorFechaInicio').value;
  const fechaFin = document.getElementById('visualizadorFechaFin').value;
  const usuario = document.getElementById('visualizadorUsuario').value.trim();
  
  if (!fechaInicio || !fechaFin) {
    mostrarAlerta('visualizadorAlerta', 'Selecciona el rango de fechas', 'warning');
    return;
  }
  
  const filtros = {
    fechaInicio: fechaInicio,
    fechaFin: fechaFin,
    usuario: usuario
  };
  
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      
      if (respuesta.success) {
        mostrarResultadosVisualizador(respuesta);
      } else {
        mostrarAlerta('visualizadorAlerta', 'Error: ' + respuesta.message, 'error');
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('visualizadorAlerta', 'Error: ' + error, 'error');
    })
    .obtenerDatosVisualizador(filtros);
}

function mostrarResultadosVisualizador(datos) {
  const container = document.getElementById('visualizadorResultados');
  
  let html = `
    <div style="margin-top: 30px;">
      <h4 style="color: #1d66c3; margin-bottom: 20px; font-weight: 800;">
        📊 Resultados del Análisis
      </h4>
      
      <div class="stats-grid" style="margin-bottom: 30px;">
        <div class="stat-card">
          <div class="stat-value">${datos.stats.verificaciones}</div>
          <div class="stat-label">Verificaciones</div>
        </div>
        <div class="stat-card" style="background: linear-gradient(135deg, #17a2b8 0%, #00bcd4 100%);">
          <div class="stat-value">${datos.stats.recepciones}</div>
          <div class="stat-label">Recepciones</div>
        </div>
        <div class="stat-card" style="background: linear-gradient(135deg, #fd7e14 0%, #ff6c00 100%);">
          <div class="stat-value">${datos.stats.auditorias}</div>
          <div class="stat-label">Auditorías</div>
        </div>
        <div class="stat-card" style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%);">
          <div class="stat-value">${datos.stats.precision}</div>
          <div class="stat-label">Precisión Promedio</div>
        </div>
      </div>
      
      <div style="background: #f8f9fa; padding: 20px; border-radius: 8px;">
        <h5 style="color: #1d66c3; margin-bottom: 15px; font-weight: 700;">
          📋 Detalle de Operaciones (últimas 100)
        </h5>
        
        ${datos.detalle.length === 0 ? '<p style="text-align: center; color: #999;">No hay operaciones en este período</p>' : ''}
        
        <div style="max-height: 400px; overflow-y: auto;">
  `;
  
  datos.detalle.forEach(operacion => {
    const tipoColor = {
      'Verificación': '#1d66c3',
      'Recepción': '#17a2b8',
      'Auditoría': '#fd7e14'
    }[operacion.tipo] || '#6c757d';
    
    html += `
      <div style="background: white; padding: 12px; border-radius: 8px; margin-bottom: 10px; border-left: 4px solid ${tipoColor};">
        <div style="display: flex; justify-content: space-between; align-items: start;">
          <div style="flex: 1;">
            <div style="font-size: 12px; color: #999; margin-bottom: 3px;">
              <i class="fas fa-clock"></i> ${operacion.fecha}
            </div>
            <div style="font-weight: 700; color: ${tipoColor}; margin-bottom: 3px;">
              ${operacion.tipo}
            </div>
            <div style="font-size: 14px; color: #666;">
              <strong>Usuario:</strong> ${operacion.usuario}
            </div>
            <div style="font-size: 14px; color: #666;">
              <strong>Código/Ubicación:</strong> ${operacion.codigo}
            </div>
            ${operacion.estado ? '<div style="font-size: 13px; color: #28a745; margin-top: 3px;">' + operacion.estado + '</div>' : ''}
          </div>
        </div>
      </div>
    `;
  });
  
  html += `
        </div>
      </div>
      
      <div style="margin-top: 20px; text-align: center;">
        <button onclick="exportarReporteCSV()" style="background: #28a745; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-weight: 700; cursor: pointer; margin-right: 10px;">
          <i class="fas fa-file-csv"></i> Exportar a CSV
        </button>
        <button onclick="imprimirReporte()" style="background: #6c757d; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-weight: 700; cursor: pointer;">
          <i class="fas fa-print"></i> Imprimir
        </button>
      </div>
    </div>
  `;
  container.innerHTML = html;
}

function exportarReporteCSV() {
  mostrarAlerta('visualizadorAlerta', 'Exportar a CSV estará disponible próximamente', 'info');
}

let cfLoteActual = null;
let cfFotosBase64 = [];

// ========================================
// 📋 CONTEO FÍSICO DE INVENTARIO
// ========================================

function cargarUbicacionParaConteo() {
  const ubicacion = document.getElementById('conteoUbicacionInput').value.trim();
  if (!ubicacion) {
    mostrarAlerta('conteoAlerta', 'Ingresa una ubicación', 'warning');
    return;
  }
  if (hayConteoEnProgreso() && datosConteoFisico.ubicacion.toUpperCase() !== ubicacion.toUpperCase()) {
    const totalContados = Object.keys(datosConteoFisico.cantidadesContadas).length;
    mostrarModalConfirmacionLimpiar(
      '⚠️ Conteo en progreso',
      `Ya tienes un conteo activo en <strong>${datosConteoFisico.ubicacion}</strong> con <strong>${totalContados}</strong> códigos contados.<br><br>¿Deseas abandonarlo y empezar con <strong>${ubicacion}</strong>?`,
      () => {
        datosConteoFisico = { ubicacion: '', codigosEsperados: [], cantidadesContadas: {}, cantidadesNoEsperadas: {}, datosCompletos: [] };
        ejecutarCargaUbicacionConteo(ubicacion);
      }
    );
    return;
  }
  ejecutarCargaUbicacionConteo(ubicacion);
}

function ejecutarCargaUbicacionConteo(ubicacion) {
  mostrarCargando(true);
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      if (respuesta.count > 0) {
        datosConteoFisico.ubicacion = respuesta.ubicacion || ubicacion;
        datosConteoFisico.codigosEsperados = respuesta.resultados.map(r => r['Código']);
        datosConteoFisico.cantidadesContadas = {};
        datosConteoFisico.cantidadesNoEsperadas = {};
        datosConteoFisico.datosCompletos = respuesta.resultados;
        mostrarInterfazConteoFisico(respuesta.resultados);
      } else {
        mostrarAlerta('conteoAlerta', 'Ubicación vacía o no existe', 'warning');
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('conteoAlerta', 'Error: ' + error, 'error');
    })
    .buscarPorUbicacion(ubicacion);
}

function mostrarInterfazConteoFisico(items) {
  const html = `
    <div style="background: #fff8e1; padding: 15px; border-radius: 8px; margin-top: 15px;">
      <h4 style="color: #856404; margin-bottom: 10px;">📋 Contando: ${datosConteoFisico.ubicacion}</h4>
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; font-size: 14px;">
        <div><strong>Esperados:</strong> <span id="conteoCtEsperados">${items.length}</span></div>
        <div><strong>Contados:</strong> <span id="conteoCtContados" style="color:#28a745; font-weight:bold;">0</span></div>
        <div><strong>Pendientes:</strong> <span id="conteoCtPendientes" style="color:#dc3545; font-weight:bold;">${items.length}</span></div>
        <div><strong>No esperados:</strong> <span id="conteoCtExtras" style="color:#e65100; font-weight:bold;">0</span></div>
      </div>
    </div>
    <div style="margin-top: 20px;">
      <div class="input-group-custom">
        <label class="mb-2" style="font-weight: 700;">Escanea los códigos físicamente presentes</label>
        <input type="text" id="conteoCodigoInput" class="input-custom" placeholder="Código"
               autofocus onkeypress="if(event.key==='Enter') agregarCodigoConteoFisico()">
      </div>
      <button class="btn-primary-custom" onclick="abrirScanner('conteoCodigoInput')">
        <i class="fas fa-barcode"></i> Escanear
      </button>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 30px;">
      <div>
        <h4 style="color: #1d66c3; margin-bottom: 15px;">
          <i class="fas fa-clipboard-list"></i> Códigos Esperados
        </h4>
        <div id="conteoListaEsperados" style="max-height: 500px; overflow-y: auto;"></div>
      </div>
      <div>
        <h4 style="color: #e65100; margin-bottom: 15px;">
          <i class="fas fa-exclamation-circle"></i> No Esperados (<span id="conteoCtExtras2">0</span>)
        </h4>
        <div id="conteoListaNoEsperados" style="max-height: 500px; overflow-y: auto;">
          <p style="text-align:center; color:#999; padding:30px;">No se han encontrado códigos fuera de lista</p>
        </div>
      </div>
    </div>
  `;
  document.getElementById('conteoResultados').innerHTML = html;
  document.getElementById('btnFinalizarConteo').style.display = 'block';
  renderizarListaConteoEsperados();
}

function renderizarListaConteoEsperados() {
  const container = document.getElementById('conteoListaEsperados');
  if (!container) return;
  let html = '';
  datosConteoFisico.datosCompletos.forEach((item) => {
    const codigo = item['Código'];
    const descripcion = item['Descripción'] || '';
    const qty = datosConteoFisico.cantidadesContadas[codigo] || 0;
    const contado = qty > 0;
    html += `
      <div style="background:${contado ? '#e8f5e9' : '#fff'}; border:2px solid ${contado ? '#28a745' : '#ddd'};
                  border-radius:8px; padding:12px; margin-bottom:10px; display:flex; align-items:start; gap:12px; transition:all 0.3s;">
        <div style="flex-shrink:0; margin-top:2px;">
          ${contado
            ? '<i class="fas fa-check-circle" style="color:#28a745;font-size:24px;"></i>'
            : '<i class="far fa-circle" style="color:#ddd;font-size:24px;"></i>'}
        </div>
        <div style="flex:1;">
          <div style="font-weight:800;font-size:15px;color:${contado ? '#28a745' : '#1d66c3'};margin-bottom:4px;">${codigo}</div>
          <div style="font-size:13px;color:#666;">${descripcion}</div>
          ${contado ? `<div style="margin-top:8px;">
            <span style="background:#28a745;color:white;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;"><i class="fas fa-check"></i> CONTADO</span>
            <span style="background:#1d66c3;color:white;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;margin-left:6px;">x${qty} unidad${qty > 1 ? 'es' : ''}</span>
          </div>` : ''}
        </div>
      </div>`;
  });
  container.innerHTML = html;
}

function renderizarListaNoEsperados() {
  const container = document.getElementById('conteoListaNoEsperados');
  if (!container) return;
  const noEsperados = Object.entries(datosConteoFisico.cantidadesNoEsperadas);
  if (noEsperados.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:#999;padding:30px;">No se han encontrado códigos fuera de lista</p>';
    return;
  }
  let html = '';
  noEsperados.forEach(([codigo, qty]) => {
    html += `
      <div style="background:#fff3cd;border:2px solid #ffc107;border-radius:8px;padding:12px;margin-bottom:10px;">
        <div style="font-weight:800;font-size:15px;color:#e65100;margin-bottom:4px;">🔍 ${codigo}</div>
        <div style="font-size:12px;color:#666;margin-bottom:8px;">Encontrado físicamente — no registrado en esta ubicación</div>
        <div>
          <span style="background:#e65100;color:white;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;">NO ESPERADO</span>
          <span style="background:#856404;color:white;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;margin-left:6px;">x${qty} unidad${qty > 1 ? 'es' : ''}</span>
        </div>
      </div>`;
  });
  container.innerHTML = html;
}

function actualizarContadoresConteo() {
  const esperados = datosConteoFisico.codigosEsperados.length;
  const contados = Object.keys(datosConteoFisico.cantidadesContadas).length;
  const extras = Object.keys(datosConteoFisico.cantidadesNoEsperadas).length;
  const pendientes = Math.max(0, esperados - contados);
  if (document.getElementById('conteoCtContados')) document.getElementById('conteoCtContados').textContent = contados;
  if (document.getElementById('conteoCtPendientes')) document.getElementById('conteoCtPendientes').textContent = pendientes;
  if (document.getElementById('conteoCtExtras')) document.getElementById('conteoCtExtras').textContent = extras;
  if (document.getElementById('conteoCtExtras2')) document.getElementById('conteoCtExtras2').textContent = extras;
}

// ==============================================
// 🧹 FUNCIÓN DE LIMPIEZA DE CÓDIGO (FRONTEND)
// Debe ser idéntica a cleanPartCode del backend
// ==============================================
function cleanCodeConteo(qrData) {
  if (!qrData || typeof qrData !== 'string') {
    return { clean: "", isValid: false, info: "Entrada inválida" };
  }
  let codigo = qrData.trim();
  const original = codigo;
  
  // 1️⃣ Convertir comillas simples ' a guiones -
  codigo = codigo.replace(/'/g, '-');
  
  // 2️⃣ Si contiene COMAS - extraer el segmento válido
  if (codigo.includes(',')) {
    const partes = codigo.split(',');
    
    // PRIORIDAD 1: Buscar segmento de ~14 caracteres (caso LONCIN)
    for (let parte of partes) {
      parte = parte.trim();
      const longitudValida = parte.length >= 12 && parte.length <= 15;
      
      if (longitudValida && /^[A-Z0-9\-]{12,15}$/.test(parte.toUpperCase())) {
        codigo = parte.toUpperCase();
        break;
      }
    }
    
    // PRIORIDAD 2: Validación normal para otros casos
    if (codigo.includes(',')) {
      for (let parte of partes) {
        parte = parte.trim();
        if (parte && /^[A-Z0-9\-]{5,17}$/.test(parte.toUpperCase())) {
          codigo = parte.toUpperCase();
          break;
        }
      }
    }
  }
  
  // 3️⃣ Si contiene CORCHETES [] - tomar solo lo que está ANTES
  if (codigo.includes('[')) {
    codigo = codigo.split('[')[0].trim();
  }
  
  // 4️⃣ Mayúsculas y limpiar espacios
  codigo = codigo.toUpperCase().replace(/\s+/g, '');
  
  // 5️⃣ VALIDACIÓN SYM - DEBE IR ANTES DE LIMPIAR CARACTERES
  const patternSYM17 = /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{2}$/;      // 20 chars (5-5-5-2)
  const patternSYM14 = /^[A-Z0-9]{5}-[A-Z0-9]{3}-[A-Z0-9]{4}-[A-Z0-9]{2}$/;      // 17 chars (5-3-4-2)
  const patternSYM_5_3_3 = /^[A-Z0-9]{5}-[A-Z0-9]{3}-[A-Z0-9]{3}$/;              // 13 chars (5-3-3)
  const patternSYM_5_3_3_2 = /^[A-Z0-9]{5}-[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{2}$/; // 16 chars (5-3-3-2)
  const patternSYM_4_3_4_1_2 = /^[A-Z0-9]{4}-[A-Z0-9]{3}-[A-Z0-9]{4}-[A-Z0-9]{1}-[A-Z0-9]{2}$/; // 🆕 18 chars (4-3-4-1-2)
  
  if (patternSYM17.test(codigo) || 
      patternSYM14.test(codigo) || 
      patternSYM_5_3_3.test(codigo) || 
      patternSYM_5_3_3_2.test(codigo) ||
      patternSYM_4_3_4_1_2.test(codigo)) {
    
    // TRUNCAR A 20 CARACTERES SI EXCEDE (cambiado de 17 a 20)
    let needsManualReview = false;
    if (codigo.length > 20) {
      codigo = codigo.substring(0, 20);
      needsManualReview = true;
    }
    
    return {
      clean: codigo,
      isValid: true,
      isSYM: true,
      manualReview: needsManualReview,
      info: needsManualReview ? "SYM truncado a 20 caracteres" : "SYM válido"
    };
  }
  
  // 6️⃣ Remover caracteres inválidos
  codigo = codigo.replace(/[^A-Z0-9\-]/g, '');
  codigo = codigo.replace(/\-+/g, '-').replace(/^-+|-+$/g, '');
  
  // 7️⃣ Si es > 15 caracteres, truncar y marcar para revisión
  let needsManualReview = false;
  if (codigo.length > 15) {
    codigo = codigo.substring(0, 15);
    needsManualReview = true;
  }
  
  // 8️⃣ Validación mínima (5+ caracteres)
  if (codigo.length < 5) {
    return {
      clean: codigo,
      isValid: false,
      manualReview: true,
      info: "Código muy corto"
    };
  }
  
  return {
    clean: codigo,
    isValid: true,
    isSYM: false,
    manualReview: needsManualReview,
    info: needsManualReview ? "Truncado a 15 caracteres" : "OK"
  };
}

// FUNCIÓN AUXILIAR PARA INTENTAR FORMATEAR CÓDIGOS SYM SIN GUIONES
function agregarGuionesSYM(codigo) {
  // Intentar formato 17 caracteres: XXXXX-XXXXX-XXXXX-XX
  if (codigo.length === 17) {
    const formateado = `${codigo.substring(0, 5)}-${codigo.substring(5, 10)}-${codigo.substring(10, 15)}-${codigo.substring(15, 17)}`;
    const patternSYM17 = /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{2}$/;
    
    if (patternSYM17.test(formateado)) {
      return { esSYM: true, codigo: formateado };
    }
  }
  
  // Intentar formato 14 caracteres: XXXXX-XXX-XXXX-XX
  if (codigo.length === 14) {
    const formateado = `${codigo.substring(0, 5)}-${codigo.substring(5, 8)}-${codigo.substring(8, 12)}-${codigo.substring(12, 14)}`;
    const patternSYM14 = /^[A-Z0-9]{5}-[A-Z0-9]{3}-[A-Z0-9]{4}-[A-Z0-9]{2}$/;
    
    if (patternSYM14.test(formateado)) {
      return { esSYM: true, codigo: formateado };
    }
  }
  
  return { esSYM: false, codigo: codigo };
}

function cargarArticuloConteoFisico() {
  const input = document.getElementById('cfArticuloInput');
  const codigoRaw = input.value.trim();
  input.value = '';
  if (!codigoRaw) return;

  const resultadoLimpieza = cleanCodeConteo(codigoRaw);
  const codigo = resultadoLimpieza.clean;

  if (!codigo || !resultadoLimpieza.isValid) {
    mostrarAlerta('cfAlerta', 'Código inválido o muy corto', 'warning');
    return;
  }

  mostrarCargando(true);
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      cfLoteActual = { codigo: codigo, descripcion: '', marca: '', ubicaciones: [] };
      cfFotosBase64 = [];
      document.getElementById('cfPreviewFotos').innerHTML = '';
      document.getElementById('cfLoteFotos').value = '';
      
      document.getElementById('cfLoteSistema').value = "0";
      document.getElementById('cfLoteFisico').value = "0";
      document.getElementById('cfLoteDefectuoso').value = "0";
      document.getElementById('cfLoteFaltante').textContent = "0";
      document.getElementById('cfLoteSobrante').textContent = "0";

      if (respuesta.count > 0) {
        const item = respuesta.resultados[0];
        cfLoteActual.descripcion = item['Descripción'] || '';
        cfLoteActual.marca = item['Marca'] || '';
        
        const ubicacionesSet = new Set();
        respuesta.resultados.forEach(res => {
          ['Ubicación Principal','Ubicación 2','Ubicación 3','Ubicación 4','Ubicación 5'].forEach(col => {
            const ubic = (res[col] || '').toString().trim();
            if (ubic && ubic !== '') ubicacionesSet.add(ubic);
          });
        });
        cfLoteActual.ubicaciones = Array.from(ubicacionesSet);
      } else {
        mostrarAlerta('cfAlerta', "⚠️ Código no encontrado en inventario del sistema.", "warning");
      }

      document.getElementById('cfLoteCodigo').textContent = codigo;
      document.getElementById('cfLoteDesc').textContent = cfLoteActual.descripcion + (cfLoteActual.marca ? ' - ' + cfLoteActual.marca : '');
      
      const sugeridasCont = document.getElementById('cfUbicacionesSugeridas');
      sugeridasCont.innerHTML = '';
      if(cfLoteActual.ubicaciones.length > 0) {
        document.getElementById('cfLoteUbicacion').value = cfLoteActual.ubicaciones[0];
        cfLoteActual.ubicaciones.forEach(ub => {
          sugeridasCont.innerHTML += `<span style="cursor:pointer; background:#e3f2fd; padding:3px 8px; border-radius:4px; border:1px solid #1d66c3;" onclick="document.getElementById('cfLoteUbicacion').value='${ub}'">${ub}</span>`;
        });
      } else {
        document.getElementById('cfLoteUbicacion').value = '';
        sugeridasCont.innerHTML = '<i>Sin ubicaciones previas</i>';
      }

      document.getElementById('cfPanelBusqueda').style.display = 'none';
      document.getElementById('cfPanelLotes').style.display = 'none';
      document.getElementById('cfPanelFormulario').style.display = 'block';
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('cfAlerta', 'Error de red: ' + error, 'error');
    })
    .buscarCodigo(codigo);
}

function calcularDiscrepanciasCF() {
  const sistema = parseInt(document.getElementById('cfLoteSistema').value) || 0;
  const fisica = parseInt(document.getElementById('cfLoteFisico').value) || 0;
  
  let sobrante = fisica > sistema ? fisica - sistema : 0;
  let faltante = sistema > fisica ? sistema - fisica : 0;
  
  document.getElementById('cfLoteSobrante').textContent = sobrante;
  document.getElementById('cfLoteFaltante').textContent = faltante;
}

function procesarFotosCF(inputEl) {
  if(!inputEl.files) return;
  if(inputEl.files.length > 3) {
    alert("Máximo 3 fotos permitidas.");
    inputEl.value = "";
    cfFotosBase64 = [];
    document.getElementById('cfPreviewFotos').innerHTML = '';
    return;
  }
  
  cfFotosBase64 = [];
  document.getElementById('cfPreviewFotos').innerHTML = '';
  
  Array.from(inputEl.files).forEach(file => {
    const reader = new FileReader();
    reader.onload = function(e) {
      cfFotosBase64.push(e.target.result);
      const img = document.createElement('img');
      img.src = e.target.result;
      img.style.height = '60px';
      img.style.borderRadius = '4px';
      img.style.border = '1px solid #ccc';
      document.getElementById('cfPreviewFotos').appendChild(img);
    };
    reader.readAsDataURL(file);
  });
}

function cancelarLoteCF() {
  document.getElementById('cfPanelFormulario').style.display = 'none';
  document.getElementById('cfPanelLotes').style.display = 'none';
  document.getElementById('cfPanelBusqueda').style.display = 'block';
}

function guardarLotePreliminarAction() {
  const ubi = document.getElementById('cfLoteUbicacion').value.trim();
  if(!ubi) {
    alert("Debes asignar una ubicación actual para el lote.");
    return;
  }

  const datosReq = {
    sessionId: currentSessionId || localStorage.getItem('sessionId'),
    codigo: cfLoteActual.codigo,
    descripcion: cfLoteActual.descripcion,
    marca: cfLoteActual.marca,
    ubicacion: ubi,
    cantSistema: parseInt(document.getElementById('cfLoteSistema').value) || 0,
    cantFisica: parseInt(document.getElementById('cfLoteFisico').value) || 0,
    defectuoso: parseInt(document.getElementById('cfLoteDefectuoso').value) || 0,
    fotos: cfFotosBase64
  };

  mostrarCargando(true);
  google.script.run
    .withSuccessHandler(res => {
      mostrarCargando(false);
      if(res.success) {
        mostrarAlerta('cfAlerta', "✅ Lote guardado provisionalmente.", "success");
        setTimeout(() => ocultarAlerta('cfAlerta'), 3000);
        verMisLotesActivosCF();
      } else {
        alert("Error: " + res.message);
      }
    })
    .withFailureHandler(err => {
      mostrarCargando(false);
      alert("Error: " + err);
    })
    .guardarLotePreliminar(datosReq);
}

function verMisLotesActivosCF() {
  document.getElementById('cfPanelFormulario').style.display = 'none';
  document.getElementById('cfPanelBusqueda').style.display = 'none';
  document.getElementById('cfPanelLotes').style.display = 'block';
  
  const container = document.getElementById('cfListaLotes');
  container.innerHTML = '<div style="text-align:center;"><i class="fas fa-spinner fa-spin"></i> Cargando mis lotes...</div>';
  
  const sId = currentSessionId || localStorage.getItem('sessionId');
  google.script.run
    .withSuccessHandler(res => {
      if(res.success) {
        if(res.lotes.length === 0) {
           container.innerHTML = '<p style="text-align:center; color:#666;">No tienes lotes preliminares abiertos.</p>';
           return;
        }
        
        let html = '';
        res.lotes.forEach(l => {
          html += `
            <div style="background:#f8f9fa; border-left:4px solid #ffc107; padding:10px; margin-bottom:10px; border-radius:4px; display:flex; justify-content:space-between; align-items:center;">
              <div>
                <b style="color:#1d66c3;">${l.codigo}</b> <span style="font-size:12px;color:#666;">(${l.timestamp})</span><br>
                <span style="font-size:12px;">Ubi: ${l.ubicacion} | Sist: ${l.sistema} | Fís: <b>${l.fisica}</b></span>
              </div>
              <button onclick="cerrarLoteProvisionalCF('${l.loteID}')" style="background:#1d66c3; color:white; border:none; padding:6px 10px; border-radius:4px; font-weight:bold; cursor:pointer;"><i class="fas fa-check"></i> Cerrar Lote</button>
            </div>
          `;
        });
        container.innerHTML = html;
      } else {
        container.innerHTML = `<p style="color:red;">Error: ${res.message}</p>`;
      }
    })
    .withFailureHandler(err => {
      container.innerHTML = `<p style="color:red;">Error de conexión: ${err}</p>`;
    })
    .obtenerMisLotesActivos(sId);
}

function volverEscanearCF() {
  document.getElementById('cfPanelLotes').style.display = 'none';
  document.getElementById('cfPanelBusqueda').style.display = 'block';
}

function cerrarLoteProvisionalCF(loteId) {
  mostrarConfirmacion("Cerrar Lote", `¿Estás seguro de cerrar el lote ${loteId}? Ya no podrás editarlo pero aún no se enviará el correo (podrás enviar el lote con los demás al dar clic a "Finalizar y Reportar").`, () => {
    mostrarCargando(true);
    google.script.run
      .withSuccessHandler(res => {
        mostrarCargando(false);
        if(res.success) {
          verMisLotesActivosCF(); // Refrescar lista
        } else {
          alert("Error: " + res.message);
        }
      })
      .withFailureHandler(err => {
        mostrarCargando(false);
        alert("Error de red: " + err);
      })
      .cerrarLoteConteoFisico({ sessionId: currentSessionId || localStorage.getItem('sessionId'), loteID: loteId });
  });
}

function enviarReportesCerradosCF() {
  mostrarConfirmacion("Reportar Lotes Cerrados", "Se generará un CSV con todos tus lotes cerrados y se enviará al Jefe de Bodega. ¿Deseas enviar y reiniciar la tanda de lotes actual?", () => {
    mostrarCargando(true);
    google.script.run
      .withSuccessHandler(res => {
        mostrarCargando(false);
        if(res.success) {
          alert("Reporte enviado y CSV generado con éxito.");
          volverEscanearCF(); // Returns to main view. 
        } else {
          alert("Aviso: " + res.message);
        }
      })
      .withFailureHandler(err => {
        mostrarCargando(false);
        alert("Error de red: " + err);
      })
      .enviarReporteLotes(currentSessionId || localStorage.getItem('sessionId'));
  });
}

// ========================================
// 🔐 NAVEGACIÓN Y PERMISOS (VERSIÓN ÚNICA Y CORREGIDA)
// ========================================

function showModulo(modulo) {
  // 1. VALIDAR PERMISOS Y SESIÓN
  if (modulo !== 'login' && modulo !== 'menu') {
    if (!usuarioActual) {
      mostrarAlerta('loginError', 'Sesión expirada. Por favor inicia sesión nuevamente.', 'warning');
      document.querySelectorAll('.modulo').forEach(m => m.classList.remove('active'));
      document.getElementById('modulo-login').classList.add('active');
      return;
    }
    
    // Mapeo de módulos a permisos
    const permisoRequerido = {
      'buscar': 'buscar',
      'ubicaciones': 'ubicaciones',
      'indice-ubicaciones': 'ubicaciones',
      'asignacion': 'ubicaciones',
      'Estado de Ubicaciones': 'ubicaciones',
      'verificar': 'verificar',
      'recepcion': 'recepcion',
      'por-ubicar': 'recepcion',
      'auditoria': 'auditoria',
      'editar': 'editar',
      'despacho': 'despacho',
      'conteo-fisico': 'conteo',
      'conteo-referencia': 'conteo',
      'dashboard-jefe': 'dashboard',
      'admin': 'admin',
      'visualizador': 'dashboard'
    }[modulo];
    
    if (permisoRequerido && !usuarioActual.permisos[permisoRequerido] && !usuarioActual.permisos.admin) {
      alert('⛔ No tienes permiso para acceder a este módulo');
      document.querySelectorAll('.modulo').forEach(m => m.classList.remove('active'));
      document.getElementById('modulo-menu').classList.add('active');
      return;
    }
  }
  
  // 2. CAMBIAR DE MÓDULO
  document.querySelectorAll('.modulo').forEach(m => m.classList.remove('active'));
  const moduloDOM = document.getElementById('modulo-' + modulo);
  if (moduloDOM) {
    moduloDOM.classList.add('active');
  } else {
    console.error("Error: No se encontró el módulo: " + modulo);
    document.getElementById('modulo-menu').classList.add('active');
    return;
  }
  
  // 3. CARGAR DATOS ESPECIALES - USAR setTimeout PARA EVITAR PROBLEMAS
  if (modulo === 'Estado de Ubicaciones') {
    setTimeout(() => cargarDashboard(), 100);
  } else if (modulo === 'dashboard-jefe') {
    setTimeout(() => cargarDatosJefe(), 100);
  } else if (modulo === 'admin') {
    console.log("🔧 Cargando panel admin...");
    setTimeout(() => cargarPanelAdmin(), 100);
  } else if (modulo === 'visualizador') {
    setTimeout(() => cargarVisualizador(), 100);
  }
  else if (modulo === 'despacho') {
  setTimeout(() => inicializarModuloDespacho(), 100);
}
}

// ========================================
// ⚙️ TAB CONFIGURACIÓN - IMPLEMENTACIÓN COMPLETA
// ========================================

function cargarConfiguracionAdmin() {
  const html = `
    <div style="max-width: 900px; margin: 0 auto;">
      
      <!-- HEADER -->
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 8px; margin-bottom: 30px; text-align: center;">
        <i class="fas fa-cog" style="font-size: 48px; margin-bottom: 15px;"></i>
        <h2 style="margin: 0 0 10px 0;">Configuración del Sistema</h2>
        <p style="margin: 0; opacity: 0.9;">Gestiona la configuración general de PartFinder</p>
      </div>
      
      <!-- SECCIÓN: INFORMACIÓN DEL SISTEMA -->
      <div class="card-modulo" style="margin-bottom: 20px;">
        <div class="card-header-custom">
          <i class="fas fa-info-circle"></i> Información del Sistema
        </div>
        <div class="card-body-custom">
          <div style="display: grid; grid-template-columns: 200px 1fr; gap: 15px; font-size: 14px;">
            <div><strong>Versión:</strong></div>
            <div>PartFinder v2.0 Ultra</div>
            
            <div><strong>Base de Datos:</strong></div>
            <div id="configSheetId">Cargando...</div>
            
            <div><strong>Usuario Actual:</strong></div>
            <div id="configUsuario">Cargando...</div>
            
            <div><strong>Última Actualización:</strong></div>
            <div id="configUltimaActualizacion">Cargando...</div>
          </div>
        </div>
      </div>
      
      <!-- SECCIÓN: CONFIGURACIÓN DE EMAILS -->
      <div class="card-modulo" style="margin-bottom: 20px;">
        <div class="card-header-custom">
          <i class="fas fa-envelope"></i> Configuración de Emails
        </div>
        <div class="card-body-custom">
          <p style="margin-bottom: 15px;">Gestiona los destinatarios de reportes automáticos</p>
          
          <button class="btn-primary-custom" onclick="verConfiguracionEmails()">
            <i class="fas fa-list"></i> Ver Destinatarios Configurados
          </button>
          
          <button class="btn-success-custom" onclick="agregarDestinatarioEmail()">
            <i class="fas fa-plus"></i> Agregar Destinatario
          </button>
          
          <div id="listaDestinatariosEmails" style="margin-top: 20px;"></div>
        </div>
      </div>
      
      <!-- SECCIÓN: TRIGGERS AUTOMÁTICOS -->
      <div class="card-modulo" style="margin-bottom: 20px;">
        <div class="card-header-custom">
          <i class="fas fa-clock"></i> Tareas Programadas (Triggers)
        </div>
        <div class="card-body-custom">
          <p style="margin-bottom: 15px;">Gestiona las tareas automáticas del sistema</p>
          
          <button class="btn-primary-custom" onclick="verTriggers()">
            <i class="fas fa-list"></i> Ver Triggers Activos
          </button>
          
          <button class="btn-success-custom" onclick="configurarTodosTriggers()">
            <i class="fas fa-sync"></i> Configurar Todos los Triggers
          </button>
          
          <button class="btn-warning-custom" onclick="eliminarTodosTriggers()">
            <i class="fas fa-trash"></i> Eliminar Todos los Triggers
          </button>
          
          <div id="listaTriggersActivos" style="margin-top: 20px;"></div>
        </div>
      </div>
      
      <!-- SECCIÓN: CACHÉ Y RENDIMIENTO -->
      <div class="card-modulo" style="margin-bottom: 20px;">
        <div class="card-header-custom">
          <i class="fas fa-tachometer-alt"></i> Caché y Rendimiento
        </div>
        <div class="card-body-custom">
          <p style="margin-bottom: 15px;">Limpia la caché para refrescar datos</p>
          
          <button class="btn-warning-custom" onclick="limpiarCacheManual()">
            <i class="fas fa-sync"></i> Limpiar Caché Ahora
          </button>
          
          <div id="estadoCacheInfo" style="margin-top: 15px; padding: 15px; background: #f8f9fa; border-radius: 8px;">
            <p style="margin: 0; font-size: 14px;">
              <i class="fas fa-info-circle" style="color: #17a2b8;"></i>
              La caché se limpia automáticamente cada 6 horas para mantener los datos actualizados.
            </p>
          </div>
        </div>
      </div>
      
      <!-- SECCIÓN: RESPALDO Y RESTAURACIÓN -->
      <div class="card-modulo" style="margin-bottom: 20px;">
        <div class="card-header-custom">
          <i class="fas fa-database"></i> Respaldo y Restauración
        </div>
        <div class="card-body-custom">
          <p style="margin-bottom: 15px;">Crea copias de seguridad de la base de datos</p>
          
          <button class="btn-success-custom" onclick="crearBackupManual()">
            <i class="fas fa-download"></i> Crear Backup Ahora
          </button>
          
          <button class="btn-primary-custom" onclick="verBackupsDisponibles()">
            <i class="fas fa-history"></i> Ver Backups Disponibles
          </button>
          
          <div id="infoBackups" style="margin-top: 15px;"></div>
        </div>
      </div>
      
      <!-- SECCIÓN: MANTENIMIENTO -->
      <div class="card-modulo" style="margin-bottom: 20px;">
        <div class="card-header-custom">
          <i class="fas fa-broom"></i> Mantenimiento
        </div>
        <div class="card-body-custom">
          <p style="margin-bottom: 15px;">Herramientas de limpieza y mantenimiento</p>
          
          <button class="btn-warning-custom" onclick="limpiarLogsManual()">
            <i class="fas fa-trash"></i> Limpiar Logs Antiguos (>90 días)
          </button>
          
          <button class="btn-warning-custom" onclick="limpiarAuditoriaEmailsManual()">
            <i class="fas fa-trash"></i> Limpiar Auditoría Emails (>60 días)
          </button>
          
          <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; border-radius: 5px; margin-top: 15px;">
            <strong style="color: #856404;">⚠️ Precaución:</strong>
            <p style="margin: 5px 0 0 0; color: #856404; font-size: 14px;">
              Estas acciones eliminarán datos permanentemente. Asegúrate de tener un backup reciente.
            </p>
          </div>
        </div>
      </div>
      
      <!-- SECCIÓN: ESTADÍSTICAS DEL SISTEMA -->
      <div class="card-modulo">
        <div class="card-header-custom">
          <i class="fas fa-chart-pie"></i> Estadísticas del Sistema
        </div>
        <div class="card-body-custom">
          <button class="btn-primary-custom" onclick="cargarEstadisticasSistema()">
            <i class="fas fa-sync"></i> Actualizar Estadísticas
          </button>
          
          <div id="estadisticasSistema" style="margin-top: 20px;">
            <div class="stats-grid">
              <div class="stat-card">
                <div class="stat-value" id="statTotalRepuestos">-</div>
                <div class="stat-label">Total Repuestos</div>
              </div>
              <div class="stat-card" style="background: linear-gradient(135deg, #17a2b8 0%, #00bcd4 100%);">
                <div class="stat-value" id="statTotalUsuarios">-</div>
                <div class="stat-label">Usuarios</div>
              </div>
              <div class="stat-card" style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%);">
                <div class="stat-value" id="statTotalVerificaciones">-</div>
                <div class="stat-label">Verificaciones</div>
              </div>
              <div class="stat-card" style="background: linear-gradient(135deg, #fd7e14 0%, #ff6c00 100%);">
                <div class="stat-value" id="statTotalRecepciones">-</div>
                <div class="stat-label">Recepciones</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
    </div>
  `;
  
  document.getElementById('admin-tab-config').innerHTML = html;
  
  // Cargar información inicial
  cargarInfoSistema();
  cargarEstadisticasSistema();
}

// ========================================
// 📧 FUNCIONES: CONFIGURACIÓN DE EMAILS
// ========================================

function verConfiguracionEmails() {
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      
      if (respuesta.success) {
        mostrarListaDestinatariosEmails(respuesta.destinatarios);
      } else {
        mostrarAlerta('adminAlerta', 'Error: ' + respuesta.message, 'error');
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('adminAlerta', 'Error: ' + error, 'error');
    })
    .obtenerConfiguracionEmails();
}

function mostrarListaDestinatariosEmails(destinatarios) {
  const container = document.getElementById('listaDestinatariosEmails');
  
  if (destinatarios.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #999;">No hay destinatarios configurados</p>';
    return;
  }
  
  let html = '<h4 style="margin-top: 20px;">📧 Destinatarios Configurados</h4>';
  
  destinatarios.forEach(dest => {
    const activoColor = dest.activo ? '#28a745' : '#dc3545';
    const activoIcono = dest.activo ? '✅' : '❌';
    
    html += `
      <div class="resultado-item" style="border-left-color: ${activoColor};">
        <div style="display: flex; justify-content: space-between; align-items: start;">
          <div>
            <div style="font-weight: 800; color: #1d66c3;">${dest.email}</div>
            <div style="font-size: 14px; margin-top: 5px;">
              <strong>Nombre:</strong> ${dest.nombre} | 
              <strong>Rol:</strong> ${dest.rol} | 
              <strong>Tipo:</strong> ${dest.tipoReporte}
            </div>
          </div>
          <span style="background: ${activoColor}; color: white; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 700;">
            ${activoIcono} ${dest.activo ? 'Activo' : 'Inactivo'}
          </span>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
}

function agregarDestinatarioEmail() {
  const html = `
    <div class="input-group-custom">
      <label>Email</label>
      <input type="email" id="nuevoDestEmail" class="input-custom" placeholder="usuario@suz.com.pa">
    </div>
    <div class="input-group-custom">
      <label>Nombre</label>
      <input type="text" id="nuevoDestNombre" class="input-custom" placeholder="Juan Pérez">
    </div>
    <div class="input-group-custom">
      <label>Rol</label>
      <input type="text" id="nuevoDestRol" class="input-custom" placeholder="Gerente">
    </div>
    <div class="input-group-custom">
      <label>Tipo de Reporte</label>
      <select id="nuevoDestTipo" class="input-custom">
        <option value="DIARIO">DIARIO - Reportes diarios</option>
        <option value="SEMANAL">SEMANAL - Reportes semanales</option>
        <option value="TODOS">TODOS - Todos los emails</option>
        <option value="ALERTAS">ALERTAS - Solo alertas</option>
        <option value="CONTEO_FISICO">CONTEO_FISICO - Conteos físicos</option>
      </select>
    </div>
  `;
  
  mostrarModal(
    'Agregar Destinatario',
    'Completa la información del nuevo destinatario:',
    html,
    [
      { texto: 'Cancelar', clase: 'modal-btn-secondary', callback: cerrarModal },
      { texto: 'Agregar', clase: 'modal-btn-success', callback: ejecutarAgregarDestinatario }
    ]
  );
  
setTimeout(() => {
  document.getElementById('modalInput').style.display = 'none';
  const htmlContainer = document.getElementById('modalHtmlContent');
  htmlContainer.style.display = 'block';
  htmlContainer.innerHTML = html;
}, 100);
}

function ejecutarAgregarDestinatario() {
  const email = document.getElementById('nuevoDestEmail').value.trim();
  const nombre = document.getElementById('nuevoDestNombre').value.trim();
  const rol = document.getElementById('nuevoDestRol').value.trim();
  const tipo = document.getElementById('nuevoDestTipo').value;
  
  if (!email || !nombre || !rol) {
    alert('Completa todos los campos');
    return;
  }
  
  cerrarModal();
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      if (respuesta.success) {
        mostrarAlerta('adminAlerta', '✅ Destinatario agregado', 'success');
        verConfiguracionEmails();
      } else {
        mostrarAlerta('adminAlerta', 'Error: ' + respuesta.message, 'error');
      }
    })
    .agregarDestinatarioEmail(email, nombre, rol, tipo);
}

// ========================================
// ⏰ FUNCIONES: TRIGGERS
// ========================================

function verTriggers() {
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(triggers => {
      mostrarCargando(false);
      mostrarListaTriggers(triggers);
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('adminAlerta', 'Error: ' + error, 'error');
    })
    .listarTriggers();
}

function mostrarListaTriggers(triggers) {
  const container = document.getElementById('listaTriggersActivos');
  
  if (triggers.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No hay triggers configurados</p>';
    return;
  }
  
  let html = '<h4 style="margin-top: 20px;">⏰ Triggers Activos (' + triggers.length + ')</h4>';
  
  triggers.forEach((trigger, index) => {
    html += `
      <div class="resultado-item">
        <div style="font-weight: 700; color: #1d66c3; margin-bottom: 5px;">
          ${index + 1}. ${trigger.funcion}
        </div>
        <div style="font-size: 13px; color: #666;">
          <strong>Tipo:</strong> ${trigger.tipo}
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
}

function configurarTodosTriggers() {
  mostrarConfirmacion(
    'Configurar Triggers',
    '¿Deseas configurar todos los triggers automáticos del sistema?',
    () => {
      mostrarCargando(true);
      
      google.script.run
        .withSuccessHandler(respuesta => {
          mostrarCargando(false);
          if (respuesta.success) {
            mostrarAlerta('adminAlerta', '✅ Triggers configurados exitosamente', 'success');
            verTriggers();
          } else {
            mostrarAlerta('adminAlerta', 'Error: ' + respuesta.message, 'error');
          }
        })
        .configurarTodosLosTriggers();
    }
  );
}

function eliminarTodosTriggers() {
  mostrarConfirmacion(
    '⚠️ Eliminar Todos los Triggers',
    'ADVERTENCIA: Esto eliminará todas las tareas programadas. ¿Estás seguro?',
    () => {
      mostrarCargando(true);
      
      google.script.run
        .withSuccessHandler(respuesta => {
          mostrarCargando(false);
          if (respuesta.success) {
            mostrarAlerta('adminAlerta', `✅ Se eliminaron ${respuesta.eliminados} triggers`, 'success');
            verTriggers();
          }
        })
        .eliminarTodosLosTriggers();
    }
  );
}

// ========================================
// 💾 FUNCIONES: CACHÉ, BACKUPS, MANTENIMIENTO
// ========================================

function limpiarCacheManual() {
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      if (respuesta.success) {
        mostrarAlerta('adminAlerta', '✅ Caché limpiado exitosamente', 'success');
      }
    })
    .limpiarCacheGlobal();
}

function crearBackupManual() {
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      if (respuesta.success) {
        mostrarAlerta('adminAlerta', `✅ Backup creado: ${respuesta.nombre}`, 'success');
      } else {
        mostrarAlerta('adminAlerta', 'Error: ' + respuesta.message, 'error');
      }
    })
    .crearBackupAutomatico();
}

function verBackupsDisponibles() {
  mostrarAlerta('adminAlerta', 'Función en desarrollo. Los backups se guardan en Google Drive.', 'info');
}

function limpiarLogsManual() {
  mostrarConfirmacion(
    'Limpiar Logs',
    '¿Eliminar logs mayores a 90 días?',
    () => {
      mostrarCargando(true);
      
      google.script.run
        .withSuccessHandler(respuesta => {
          mostrarCargando(false);
          if (respuesta.success) {
            mostrarAlerta('adminAlerta', `✅ Se eliminaron ${respuesta.eliminadas} registros`, 'success');
          }
        })
        .limpiarLogsAntiguos();
    }
  );
}

function limpiarAuditoriaEmailsManual() {
  mostrarConfirmacion(
    'Limpiar Auditoría',
    '¿Eliminar registros de emails exitosos mayores a 60 días?',
    () => {
      mostrarCargando(true);
      
      google.script.run
        .withSuccessHandler(respuesta => {
          mostrarCargando(false);
          if (respuesta.success) {
            mostrarAlerta('adminAlerta', `✅ Se eliminaron ${respuesta.eliminadas} registros`, 'success');
          }
        })
        .limpiarAuditoriaEmailsAntigua();
    }
  );
}

// ========================================
// 📊 FUNCIONES: INFORMACIÓN Y ESTADÍSTICAS
// ========================================

function cargarInfoSistema() {
  if (usuarioActual) {
    document.getElementById('configUsuario').textContent = usuarioActual.email + ' (' + usuarioActual.rol + ')';
  }
  
  google.script.run
    .withSuccessHandler(info => {
      document.getElementById('configSheetId').textContent = info.sheetId;
      document.getElementById('configUltimaActualizacion').textContent = new Date().toLocaleString('es-PA');
    })
    .obtenerInfoSistema();
}

function cargarEstadisticasSistema() {
  mostrarCargando(true);
  
  google.script.run
    .withSuccessHandler(stats => {
      mostrarCargando(false);
      
      document.getElementById('statTotalRepuestos').textContent = stats.totalRepuestos || '0';
      document.getElementById('statTotalUsuarios').textContent = stats.totalUsuarios || '0';
      document.getElementById('statTotalVerificaciones').textContent = stats.totalVerificaciones || '0';
      document.getElementById('statTotalRecepciones').textContent = stats.totalRecepciones || '0';
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      console.error('Error:', error);
    })
    .obtenerEstadisticasSistemaAdmin();
}
// ========================================
// 🤖 ASISTENTE IA - FUNCIONES FRONTEND
// ========================================

function abrirAsistenteIA(codigo, marca = "") {
  if (!codigo || codigo.trim() === '') {
    alert('❌ Primero ingresa un código');
    return;
  }
  
  console.log("🤖 Abriendo asistente IA para:", codigo, marca);
  
  // Abrir modal
  document.getElementById('asistentModal').classList.add('active');
  
  // Estado de carga
  document.getElementById('asistentTitle').textContent = '🤖 Consultando IA...';
  document.getElementById('asistentMessage').textContent = `Analizando código ${codigo}...`;
  document.getElementById('asistentCargando').style.display = 'block';
  document.getElementById('asistentResultado').style.display = 'none';
  document.getElementById('asistentBotones').innerHTML = '';
  
  console.log("📡 Llamando a backend...");
  
  // Llamar backend
  google.script.run
    .withSuccessHandler(function(respuesta) {
      console.log("📥 Respuesta recibida:", respuesta);
      mostrarResultadoAsistenteIA(respuesta, codigo);
    })
    .withFailureHandler(function(error) {
      console.error("💥 Error:", error);
      mostrarErrorAsistenteIA(error.message || error.toString());
    })
    .obtenerDescripcionConGemini(codigo, marca);
}

function mostrarResultadoAsistenteIA(respuesta, codigo) {
  console.log("📊 Mostrando resultado:", respuesta);
  
  document.getElementById('asistentCargando').style.display = 'none';
  
  if (!respuesta || !respuesta.success) {
    mostrarErrorAsistenteIA(respuesta.error || "Error desconocido");
    return;
  }
  
  // Actualizar contenido
  document.getElementById('asistentTitle').textContent = '✅ Análisis Completado';
  document.getElementById('asistentMessage').textContent = `Resultados para ${codigo}:`;
  document.getElementById('asistentResultado').style.display = 'block';
  
  // Llenar datos
  document.getElementById('asistentDesc').textContent = respuesta.descripcion;
  document.getElementById('asistentMarca').textContent = respuesta.marca;
  document.getElementById('asistentNotas').textContent = respuesta.notas;
  
  // Color confianza
  const confianzaEl = document.getElementById('asistentConfianza');
  const colores = {
    'alta': '#28a745',
    'media': '#ffc107',
    'baja': '#dc3545'
  };
  const color = colores[respuesta.confianza.toLowerCase()] || '#6c757d';
  
  confianzaEl.innerHTML = `
    <span style="background: ${color}; color: white; padding: 4px 12px; border-radius: 12px; font-weight: 700;">
      ${respuesta.confianza.toUpperCase()}
    </span>
  `;
  
  // Botones
  const descEscapada = respuesta.descripcion.replace(/'/g, "\\'").replace(/"/g, '\\"');
  const marcaEscapada = respuesta.marca.replace(/'/g, "\\'").replace(/"/g, '\\"');
  
  document.getElementById('asistentBotones').innerHTML = `
    <button class="modal-btn modal-btn-secondary" onclick="cerrarAsistenteIA()">
      Cerrar
    </button>
    <button class="modal-btn modal-btn-success" onclick="aplicarSugerenciaIA('${descEscapada}', '${marcaEscapada}')">
      Aplicar Sugerencia
    </button>
  `;
}

function mostrarErrorAsistenteIA(error) {
  console.error("❌ Mostrando error:", error);
  
  document.getElementById('asistentCargando').style.display = 'none';
  document.getElementById('asistentResultado').style.display = 'none';
  
  document.getElementById('asistentTitle').textContent = '❌ Error';
  document.getElementById('asistentMessage').innerHTML = `
    <div style="background: #f8d7da; padding: 15px; border-radius: 8px; border-left: 4px solid #dc3545;">
      <strong>No se pudo consultar la IA:</strong><br>
      <span style="font-size: 14px;">${error}</span>
    </div>
    <div style="background: #fff3cd; padding: 10px; border-radius: 5px; margin-top: 10px;">
      <strong>Posibles causas:</strong>
      <ul style="margin: 5px 0 0 20px; font-size: 13px;">
        <li>API Key no configurada</li>
        <li>Sin conexión a internet</li>
        <li>Límite de consultas alcanzado</li>
      </ul>
    </div>
  `;
  
  document.getElementById('asistentBotones').innerHTML = `
    <button class="modal-btn modal-btn-secondary" onclick="cerrarAsistenteIA()">
      Cerrar
    </button>
  `;
}

function cerrarAsistenteIA() {
  document.getElementById('asistentModal').classList.remove('active');
}

function aplicarSugerenciaIA(descripcion, marca) {
  console.log("✏️ Aplicando sugerencia:", descripcion, marca);
  
  const descInput = document.getElementById('nuevaDescripcion');
  const marcaSelect = document.getElementById('nuevaMarca');
  
  if (descInput && marcaSelect) {
    descInput.value = descripcion;
    
    // Intentar seleccionar la marca sugerida por la IA
    const marcaNormalizada = marca.toUpperCase().trim();
    
    // Buscar si la marca coincide con alguna opción
    let marcaEncontrada = false;
    for (let option of marcaSelect.options) {
      if (option.value === marcaNormalizada || 
          option.value.includes(marcaNormalizada) || 
          marcaNormalizada.includes(option.value)) {
        marcaSelect.value = option.value;
        marcaEncontrada = true;
        break;
      }
    }
    
    // Si no se encontró, seleccionar "OTRAS"
    if (!marcaEncontrada && marca) {
      marcaSelect.value = 'OTRAS';
    }
    
    cerrarAsistenteIA();
    mostrarAlerta('editarAlerta', '✅ Sugerencia aplicada', 'success');
  } else {
    alert('Error: Campos no encontrados');
  }
}
function reproducirSonido(tipo) {
  // Crear contexto de audio
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const oscilador = audioContext.createOscillator();
  const ganancia = audioContext.createGain();
  
  oscilador.connect(ganancia);
  ganancia.connect(audioContext.destination);
  
  if (tipo === 'exito') {
    // Sonido de éxito: DO alto
    oscilador.frequency.value = 523.25;
    ganancia.gain.value = 0.3;
    oscilador.start();
    oscilador.stop(audioContext.currentTime + 0.1);
  } else if (tipo === 'error') {
    // Sonido de error: nota baja
    oscilador.frequency.value = 200;
    ganancia.gain.value = 0.3;
    oscilador.start();
    oscilador.stop(audioContext.currentTime + 0.2);
  }
}
// ========================================
// 🚀 INICIALIZACIÓN
// ========================================

window.addEventListener('DOMContentLoaded', () => {
  verificarSesion();
});

window.addEventListener('beforeunload', (e) => {
  if (hayDatosSinGuardar()) {
    e.preventDefault();
    e.returnValue = '¡Tienes datos sin guardar! ¿Seguro que quieres salir?';
    return e.returnValue;
  }
});

console.log('✅ PartFinder SukiMotor Ultra - Sistema Completo Cargado');

// ========================================
// 🏷️ CONTEO POR REFERENCIA
// ========================================

const CR_MAX_CODIGOS = 20;

function crActualizarBarra() {
  const total = Object.keys(datosConteoReferencia).length;
  const barra = document.getElementById('crBarra');
  const texto = document.getElementById('crBarraTexto');
  const contador = document.getElementById('crBarraContador');
  if (!barra) return;
  if (total === 0) {
    barra.style.display = 'none';
  } else {
    barra.style.display = 'flex';
    texto.textContent = `${total} referencia${total > 1 ? 's' : ''} cargada${total > 1 ? 's' : ''}`;
    contador.textContent = `${total}/${CR_MAX_CODIGOS}`;
    contador.style.background = total >= CR_MAX_CODIGOS ? '#dc3545' : '#1d66c3';
  }
  // Mostrar / ocultar botón finalizar
  const btnFin = document.getElementById('btnFinalizarConteoRef');
  if (btnFin) btnFin.style.display = total > 0 ? 'block' : 'none';
}

function crRenderizarChips() {
  const container = document.getElementById('crChips');
  if (!container) return;
  const codigos = Object.keys(datosConteoReferencia);
  if (codigos.length === 0) {
    container.innerHTML = '<span style="color:#999;font-size:13px;">Sin códigos agregados</span>';
    return;
  }
  container.innerHTML = codigos.map(cod => {
    const ref = datosConteoReferencia[cod];
    const color = ref.loading ? '#999' : '#1d66c3';
    return `
      <div style="display:inline-flex;align-items:center;gap:6px;background:#e3f2fd;border:2px solid ${color};
                  padding:4px 10px;border-radius:20px;font-size:13px;font-weight:700;color:${color};">
        ${ref.loading ? '<i class="fas fa-spinner fa-spin" style="font-size:11px;"></i>' : ''}
        ${cod}
        <button onclick="crEliminarCodigo('${cod}')"
                style="background:none;border:none;color:#dc3545;cursor:pointer;font-size:14px;padding:0;line-height:1;"
                title="Eliminar">✕</button>
      </div>`;
  }).join('');
}

function crRenderizarContenido() {
  const container = document.getElementById('crContenido');
  if (!container) return;
  const codigos = Object.keys(datosConteoReferencia);
  if (codigos.length === 0) {
    container.innerHTML = '';
    return;
  }

  let html = '';
  codigos.forEach(cod => {
    const ref = datosConteoReferencia[cod];
    const total = ref.ubicaciones.reduce((s, u) => s + (parseInt(u.cantidadFisica) || 0), 0);

    if (ref.loading) {
      html += `
        <div style="background:#f8f9fa;border:2px solid #ddd;border-radius:10px;padding:20px;margin-bottom:15px;text-align:center;">
          <i class="fas fa-spinner fa-spin" style="font-size:28px;color:#1d66c3;"></i>
          <p style="margin-top:10px;color:#666;">Buscando ubicaciones de <strong>${cod}</strong>…</p>
        </div>`;
      return;
    }

    if (ref.ubicaciones.length === 0) {
      html += `
        <div style="background:#fff3cd;border:2px solid #ffc107;border-radius:10px;padding:15px;margin-bottom:15px;">
          <div style="font-weight:800;font-size:15px;color:#856404;margin-bottom:4px;">⚠️ ${cod}</div>
          ${ref.descripcion ? `<div style="font-size:13px;color:#666;">${ref.descripcion}${ref.marca ? ' · ' + ref.marca : ''}</div>` : ''}
          <div style="font-size:13px;color:#dc3545;margin-top:8px;">No se encontraron ubicaciones para este código.</div>
        </div>`;
      return;
    }

    const filasUbicaciones = ref.ubicaciones.map((u, idx) => `
      <tr style="border-bottom:1px solid #e0e0e0;">
        <td style="padding:10px 12px;font-weight:700;color:#1d66c3;">${u.ubicacion}</td>
        <td style="padding:8px 12px;text-align:center;">
          <div style="display:flex;align-items:center;justify-content:center;gap:8px;">
            <button onclick="crAjustarCantidad('${cod}',${idx},-1)"
                    style="width:30px;height:30px;background:#e0e0e0;border:none;border-radius:6px;font-size:18px;cursor:pointer;font-weight:bold;">−</button>
            <input type="number" min="0"
                   id="crQty_${cod.replace(/[^A-Z0-9]/g,'_')}_${idx}"
                   value="${u.cantidadFisica}"
                   oninput="crActualizarCantidad('${cod}',${idx},this.value)"
                   style="width:60px;text-align:center;font-size:16px;font-weight:800;border:2px solid #1d66c3;border-radius:6px;padding:4px;">
            <button onclick="crAjustarCantidad('${cod}',${idx},+1)"
                    style="width:30px;height:30px;background:#e0e0e0;border:none;border-radius:6px;font-size:18px;cursor:pointer;font-weight:bold;">+</button>
          </div>
        </td>
      </tr>`).join('');

    html += `
      <div style="background:white;border:2px solid #1d66c3;border-radius:10px;margin-bottom:20px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#1d66c3 0%,#155ab5 100%);color:white;padding:15px 20px;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:17px;font-weight:800;letter-spacing:0.5px;">${cod}</div>
            ${ref.descripcion ? `<div style="font-size:12px;opacity:0.9;margin-top:2px;">${ref.descripcion}${ref.marca ? ' · ' + ref.marca : ''}</div>` : ''}
          </div>
          <div style="text-align:right;">
            <div style="font-size:26px;font-weight:900;" id="crTotal_${cod.replace(/[^A-Z0-9]/g,'_')}">${total}</div>
            <div style="font-size:11px;opacity:0.85;">Total físico</div>
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#f0f7ff;">
              <th style="padding:10px 12px;text-align:left;font-size:13px;color:#546e7a;">Ubicación</th>
              <th style="padding:10px 12px;text-align:center;font-size:13px;color:#546e7a;">Cantidad Física</th>
            </tr>
          </thead>
          <tbody>${filasUbicaciones}</tbody>
          <tfoot>
            <tr style="background:#e3f2fd;">
              <td style="padding:12px;font-weight:800;color:#1d66c3;">TOTAL</td>
              <td style="padding:12px;text-align:center;font-size:18px;font-weight:900;color:#1d66c3;" id="crTotalFoot_${cod.replace(/[^A-Z0-9]/g,'_')}">${total}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
  });

  container.innerHTML = html;
}

function crActualizarCantidad(codigo, idx, valor) {
  if (!datosConteoReferencia[codigo]) return;
  datosConteoReferencia[codigo].ubicaciones[idx].cantidadFisica = Math.max(0, parseInt(valor) || 0);
  crRefrescarTotal(codigo);
}

function crAjustarCantidad(codigo, idx, delta) {
  if (!datosConteoReferencia[codigo]) return;
  const actual = parseInt(datosConteoReferencia[codigo].ubicaciones[idx].cantidadFisica) || 0;
  const nuevo = Math.max(0, actual + delta);
  datosConteoReferencia[codigo].ubicaciones[idx].cantidadFisica = nuevo;
  const key = codigo.replace(/[^A-Z0-9]/g, '_');
  const inp = document.getElementById(`crQty_${key}_${idx}`);
  if (inp) inp.value = nuevo;
  crRefrescarTotal(codigo);
}

function crRefrescarTotal(codigo) {
  const ref = datosConteoReferencia[codigo];
  if (!ref) return;
  const total = ref.ubicaciones.reduce((s, u) => s + (parseInt(u.cantidadFisica) || 0), 0);
  const key = codigo.replace(/[^A-Z0-9]/g, '_');
  const elHead = document.getElementById(`crTotal_${key}`);
  const elFoot = document.getElementById(`crTotalFoot_${key}`);
  if (elHead) elHead.textContent = total;
  if (elFoot) elFoot.textContent = total;
}

function crEliminarCodigo(codigo) {
  delete datosConteoReferencia[codigo];
  crRenderizarChips();
  crRenderizarContenido();
  crActualizarBarra();
}

function agregarCodigoConteoReferencia() {
  const input = document.getElementById('crCodigoInput');
  const raw = input.value.trim();
  input.value = '';
  if (!raw) return;

  // Limpiar código con la misma función del módulo de conteo ubicación
  const resultado = cleanCodeConteo(raw);
  const codigo = resultado.clean;

  if (!codigo || !resultado.isValid) {
    mostrarAlerta('crAlerta', 'Código inválido o muy corto', 'warning');
    return;
  }

  if (datosConteoReferencia[codigo]) {
    mostrarAlerta('crAlerta', `⚠️ ${codigo} ya está en la lista`, 'warning');
    return;
  }

  if (Object.keys(datosConteoReferencia).length >= CR_MAX_CODIGOS) {
    mostrarAlerta('crAlerta', `Máximo ${CR_MAX_CODIGOS} códigos simultáneos`, 'error');
    return;
  }

  // Agregar en estado "cargando"
  datosConteoReferencia[codigo] = {
    codigo: codigo,
    descripcion: '',
    marca: '',
    loading: true,
    ubicaciones: []
  };

  crRenderizarChips();
  crRenderizarContenido();
  crActualizarBarra();
  mostrarAlertaConteoEscaneo('crAlerta', `Buscando ubicaciones de ${codigo}…`, 'info');

  // Buscar el código en el inventario
  google.script.run
    .withSuccessHandler(respuesta => {
      ocultarAlerta('crAlerta');
      if (!datosConteoReferencia[codigo]) return; // fue eliminado mientras buscaba

      if (respuesta.count > 0) {
        // Extraer todas las ubicaciones únicas del código
        const ubicacionesSet = new Set();
        respuesta.resultados.forEach(item => {
          ['Ubicación Principal','Ubicación 2','Ubicación 3','Ubicación 4','Ubicación 5'].forEach(col => {
            const ubic = (item[col] || '').toString().trim();
            if (ubic && ubic !== '') ubicacionesSet.add(ubic);
          });
        });

        const primerItem = respuesta.resultados[0];
        datosConteoReferencia[codigo].descripcion = primerItem['Descripción'] || '';
        datosConteoReferencia[codigo].marca = primerItem['Marca'] || '';
        datosConteoReferencia[codigo].loading = false;
        datosConteoReferencia[codigo].ubicaciones = Array.from(ubicacionesSet).map(ubic => ({
          ubicacion: ubic,
          cantidadFisica: 0
        }));

        if (ubicacionesSet.size === 0) {
          mostrarAlerta('crAlerta', `⚠️ ${codigo} existe pero no tiene ubicaciones asignadas`, 'warning');
        } else {
          reproducirSonido('exito');
        }
      } else {
        datosConteoReferencia[codigo].loading = false;
        mostrarAlerta('crAlerta', `⚠️ ${codigo} no encontrado en el inventario`, 'warning');
      }

      crRenderizarChips();
      crRenderizarContenido();
    })
    .withFailureHandler(error => {
      ocultarAlerta('crAlerta');
      if (datosConteoReferencia[codigo]) {
        datosConteoReferencia[codigo].loading = false;
      }
      mostrarAlerta('crAlerta', 'Error al buscar: ' + error, 'error');
      crRenderizarChips();
      crRenderizarContenido();
    })
    .buscarCodigo(codigo);

  setTimeout(() => { const inp = document.getElementById('crCodigoInput'); if (inp) inp.focus(); }, 100);
}

function finalizarConteoReferencia() {
  const refs = Object.values(datosConteoReferencia);
  if (refs.length === 0) {
    mostrarAlerta('crAlerta', 'No hay referencias cargadas', 'warning');
    return;
  }
  const cargando = refs.some(r => r.loading);
  if (cargando) {
    mostrarAlerta('crAlerta', '⏳ Aún hay búsquedas en progreso. Espera un momento.', 'warning');
    return;
  }

  const totalFisico = refs.reduce((s, r) =>
    s + r.ubicaciones.reduce((si, u) => si + (parseInt(u.cantidadFisica) || 0), 0), 0);

  mostrarConfirmacion(
    'Finalizar Conteo Referencia',
    `¿Confirmar el envío del conteo de <strong>${refs.length}</strong> referencia(s) con un total físico de <strong>${totalFisico}</strong> unidades?`,
    () => ejecutarFinalizacionConteoReferencia()
  );
}

function ejecutarFinalizacionConteoReferencia() {
  const referencias = Object.values(datosConteoReferencia).map(ref => ({
    codigo: ref.codigo,
    descripcion: ref.descripcion,
    marca: ref.marca,
    ubicaciones: ref.ubicaciones.map(u => ({
      ubicacion: u.ubicacion,
      cantidadFisica: parseInt(u.cantidadFisica) || 0
    })),
    totalFisico: ref.ubicaciones.reduce((s, u) => s + (parseInt(u.cantidadFisica) || 0), 0)
  }));

  const datosEnvio = {
    referencias: referencias,
    sessionId: currentSessionId || localStorage.getItem('sessionId')
  };

  mostrarCargando(true);

  google.script.run
    .withSuccessHandler(respuesta => {
      mostrarCargando(false);
      if (respuesta.success) {
        crMostrarResumen(respuesta, referencias);
      } else {
        mostrarAlerta('crAlerta', 'Error: ' + (respuesta.message || 'Error desconocido'), 'error');
      }
    })
    .withFailureHandler(error => {
      mostrarCargando(false);
      mostrarAlerta('crAlerta', 'Error de conexión: ' + error, 'error');
    })
    .guardarConteoReferencia(datosEnvio);
}

function crMostrarResumen(respuesta, referencias) {
  const totalRefs = referencias.length;
  const totalUds = referencias.reduce((s, r) => s + r.totalFisico, 0);
  const emailEnviado = respuesta.emailEnviado || false;

  let filas = referencias.map(r => `
    <tr style="border-bottom:1px solid #e0e0e0;">
      <td style="padding:8px 12px;font-weight:700;color:#1d66c3;">${r.codigo}</td>
      <td style="padding:8px 12px;font-size:13px;color:#555;">${r.descripcion || '—'}</td>
      <td style="padding:8px 12px;text-align:center;font-weight:800;color:#28a745;font-size:16px;">${r.totalFisico}</td>
    </tr>`).join('');

  const html = `
    <div style="background:linear-gradient(135deg,#e3f2fd 0%,#e8f5e9 100%);padding:25px;border-radius:12px;margin-top:20px;">
      <h3 style="color:#1d66c3;margin-bottom:15px;text-align:center;">✅ Conteo Referencia Completado</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:20px;">
        <div style="background:white;padding:15px;border-radius:8px;text-align:center;border-left:4px solid #1d66c3;">
          <div style="font-size:28px;font-weight:bold;color:#1d66c3;">${totalRefs}</div>
          <div style="color:#666;font-size:13px;">Referencias Contadas</div>
        </div>
        <div style="background:white;padding:15px;border-radius:8px;text-align:center;border-left:4px solid #28a745;">
          <div style="font-size:28px;font-weight:bold;color:#28a745;">${totalUds}</div>
          <div style="color:#666;font-size:13px;">Unidades Totales</div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#1d66c3;color:white;">
            <th style="padding:10px 12px;text-align:left;">Código</th>
            <th style="padding:10px 12px;text-align:left;">Descripción</th>
            <th style="padding:10px 12px;text-align:center;">Total Físico</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
      <div style="text-align:center;margin-top:20px;display:flex;gap:10px;justify-content:center;">
        <button onclick="volverAlMenu()" style="padding:10px 20px;background:#6c757d;color:white;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">Menú Principal</button>
        <button onclick="limpiarModulo('conteo-referencia')" style="padding:10px 20px;background:#1d66c3;color:white;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">Nuevo Conteo</button>
      </div>
      <p style="text-align:center;margin-top:15px;font-weight:700;color:${emailEnviado ? '#28a745' : '#ffc107'};">
        ${emailEnviado ? '📧 Reporte (PDF) enviado por correo exitosamente' : '⚠️ Email no enviado (sin destinatarios CONTEO_REFERENCIA configurados)'}
      </p>
    </div>`;

  document.getElementById('crContenido').innerHTML = html;
  document.getElementById('crChips').innerHTML = '';
  document.getElementById('btnFinalizarConteoRef').style.display = 'none';
  document.getElementById('crBarra').style.display = 'none';
}
