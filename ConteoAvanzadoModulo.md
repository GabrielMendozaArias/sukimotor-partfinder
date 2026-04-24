# Extracción: Módulo de Conteo Avanzado / Conteo Físico por Lotes

A continuación se encuentra todo el código extraído de PartFinder SukiMotor correspondiente a la funcionalidad de "Conteo Avanzado". Está dividido en 3 secciones: el HTML para la interfaz, el JavaScript del cliente (Frontend) y el código de Google Apps Script (Backend). 

Puedes copiar y pegar este código directamente en tu nueva versión de la app.

---

## 1. Frontend: HTML

Este código debe ir en el archivo principal (Index.html).

### 1.1 Tarjeta del Menú Principal
```html
<div class="col-12 col-md-6">
  <div class="card-modulo critico h-100" onclick="showModulo('conteo-fisico')" style="border-width: 3px; transform: scale(1.02);">
    <div class="card-header-custom text-center" style="cursor: pointer; padding: 25px;">
      <i class="fas fa-clipboard-list" style="font-size: 3rem;"></i>
      <h4 style="margin-top: 15px; font-weight: 800; font-size: 1.8rem;">Conteo Avanzado</h4>
    </div>
    <div class="card-body-custom text-center" style="padding: 25px;">
      <p style="font-size: 1.2rem;">Conteo físico avanzado de inventario</p>
    </div>
  </div>
</div>
```

### 1.2 Estructura del Módulo (Vistas)
```html
  <!-- MÓDULO: CONTEO FÍSICO (LOTES / ARTÍCULOS) -->
  <div id="modulo-conteo-fisico" class="modulo">
    <div class="card-modulo critico">
      <div class="card-header-custom" style="display:flex; justify-content:space-between; align-items:center;">
        <span><i class="fas fa-clipboard-list"></i> Conteo Físico Avanzado</span>
        <button class="btn-warning-custom" style="width:auto; padding:5px 10px; font-size:12px; margin:0;" onclick="verMisLotesActivosCF()"><i class="fas fa-boxes"></i> Ver Mis Lotes</button>
      </div>
      
      <!-- Panel de Captura Principal -->
      <div class="card-body-custom" id="cfPanelBusqueda">
        <div class="input-group-custom">
          <label class="mb-2" style="font-weight:700; font-size:1.1rem;">1. Escanea o digita el Artículo a Contar</label>
          <input type="text" id="cfArticuloInput" class="input-custom" style="font-size: 24px; padding: 15px; text-transform: uppercase;" placeholder="Ej: 13101-05H00" onkeypress="if(event.key==='Enter') cargarArticuloConteoFisico()">
        </div>
        <div style="display:flex; gap:15px;">
          <button class="btn-primary-custom" onclick="cargarArticuloConteoFisico()" style="flex:1; margin-bottom:0; font-size:1.2rem; padding:15px;"><i class="fas fa-search"></i> Buscar</button>
          <button class="btn-primary-custom" onclick="abrirScanner('cfArticuloInput')" style="flex:1; margin-bottom:0; font-size:1.2rem; padding:15px;"><i class="fas fa-barcode"></i> Escanear</button>
        </div>
        
        <!-- Botones de Utilidad -->
        <div style="margin-top: 15px;">
          <button class="btn-warning-custom" onclick="limpiarModulo('conteo-fisico')" style="width: 100%; font-size:1.2rem; padding: 15px;">
            <i class="fas fa-eraser"></i> Limpiar Todo
          </button>
        </div>
        <div id="cfAlerta" class="alerta-custom" style="margin-top:15px; display:none; font-size:1.2rem;"></div>
      </div>
      
      <!-- Panel de Llenado de Lote (Oculto inicialmente) -->
      <div class="card-body-custom" id="cfPanelFormulario" style="display:none; border-top:1px solid #ccc; margin-top:15px; padding-top:15px;">
        <h4 style="color:#1d66c3; margin-bottom:10px; font-size:1.8rem;" id="cfLoteCodigo"></h4>
        <p style="color:#666; font-size:1.1rem; margin-bottom:20px;" id="cfLoteDesc"></p>
        
        <div class="input-group-custom">
          <label class="mb-2" style="font-weight:700; font-size:1.1rem;">Ubicación Actual (Verifica/Edita)</label>
          <input type="text" id="cfLoteUbicacion" class="input-custom" style="font-size: 20px; padding: 15px;" placeholder="B-1-A-01-A">
          <div id="cfUbicacionesSugeridas" style="font-size:14px; color:#1d66c3; margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;"></div>
        </div>
        
        <div style="display:flex; gap:15px; margin-bottom:25px;">
          <div class="input-group-custom" style="flex:1; margin-bottom:0;">
            <label style="font-size:14px; font-weight:700; color:#1d66c3;">Cant. de Sistema</label>
            <input type="number" id="cfLoteSistema" class="input-custom text-center" style="font-size: 32px; padding: 15px; height: 75px; font-weight: 800;" value="0" min="0" oninput="calcularDiscrepanciasCF()">
          </div>
          <div class="input-group-custom" style="flex:1; margin-bottom:0;">
            <label style="font-size:14px; font-weight:700; color:#28a745;">Cant. Físico</label>
            <input type="number" id="cfLoteFisico" class="input-custom text-center" style="font-size: 32px; padding: 15px; height: 75px; font-weight: 800; border-color: #28a745; box-shadow: 0 0 5px rgba(40,167,69,0.3);" value="0" min="0" oninput="calcularDiscrepanciasCF()">
          </div>
          <div class="input-group-custom" style="flex:1; margin-bottom:0;">
            <label style="font-size:14px; font-weight:700; color:#dc3545;">Dañadas/Def.</label>
            <input type="number" id="cfLoteDefectuoso" class="input-custom text-center" style="font-size: 32px; padding: 15px; height: 75px; font-weight: 800;" value="0" min="0" oninput="calcularDiscrepanciasCF()">
          </div>
        </div>
        
        <!-- Totales / Discrepancias calculadas -->
        <div style="background:#f8f9fa; padding:20px; border-radius:8px; margin-bottom:20px; display:flex; justify-content:space-around; border: 2px solid #e0e0e0;">
          <div style="text-align:center;">
             <span style="font-size:14px; font-weight:700; color:#666;">Faltantes</span><br>
             <strong id="cfLoteFaltante" style="color:#dc3545; font-size:36px;">0</strong>
          </div>
          <div style="text-align:center;">
             <span style="font-size:14px; font-weight:700; color:#666;">Sobrantes</span><br>
             <strong id="cfLoteSobrante" style="color:#ffc107; font-size:36px;">0</strong>
          </div>
        </div>
        
        <!-- Evidencia Fotográfica -->
        <div class="input-group-custom">
          <label class="mb-2" style="font-weight:700;"><i class="fas fa-camera"></i> Evidencia Fotográfica (Opcional, Máx 3)</label>
          <input type="file" id="cfLoteFotos" accept="image/*" capture="environment" multiple class="input-custom" onchange="procesarFotosCF(this)" style="font-size: 1.1rem; padding: 10px;">
          <div id="cfPreviewFotos" style="display:flex; gap:10px; margin-top:10px; overflow-x:auto;"></div>
        </div>
        
        <div style="display:flex; gap:15px; margin-top:25px;">
          <button class="btn-warning-custom" onclick="cancelarLoteCF()" style="flex:1; margin-bottom:0; background:#6c757d; font-size:1.2rem; padding: 15px;"><i class="fas fa-times"></i> Cancelar</button>
          <button class="btn-success-custom" onclick="guardarLotePreliminarAction()" style="flex:2; margin-bottom:0; font-size:1.2rem; padding: 15px;"><i class="fas fa-save"></i> Guardar Borrador</button>
        </div>
      </div>
      
      <!-- Panel Mis Lotes -->
      <div class="card-body-custom" id="cfPanelLotes" style="display:none;">
        <h4 style="color:#1d66c3; margin-bottom:15px;"><i class="fas fa-boxes"></i> Lotes Pendientes y Cerrados</h4>
        <div id="cfListaLotes" style="max-height:400px; overflow-y:auto; margin-bottom:15px;"></div>
        
        <div style="display:flex; gap:10px;">
          <button class="btn-warning-custom" onclick="volverEscanearCF()" style="flex:1; background:#6c757d; margin-bottom:0;"><i class="fas fa-arrow-left"></i> Volver</button>
          <button class="btn-success-custom" onclick="enviarReportesCerradosCF()" style="flex:2; margin-bottom:0;"><i class="fas fa-paper-plane"></i> Finalizar y Reportar Lotes Cerrados</button>
        </div>
      </div>

    </div>
  </div>
```

---

## 2. Frontend: JavaScript (`temp.js` / `Index.html` Script)

Asegúrate de incluir estas variables globales al inicio de tu archivo principal.

```javascript
// VARIABLES GLOBALES DEL MÓDULO CF
let cfLoteActual = null;
let cfFotosBase64 = [];

// ==============================================
// 🧹 FUNCIÓN DE LIMPIEZA DE CÓDIGO (FRONTEND)
// ==============================================
function cleanCodeConteo(qrData) {
  if (!qrData || typeof qrData !== 'string') {
    return { clean: "", isValid: false, info: "Entrada inválida" };
  }
  let codigo = qrData.trim();
  const original = codigo;
  
  // 1. Convertir comillas simples ' a guiones -
  codigo = codigo.replace(/'/g, '-');
  
  // 2. Si contiene COMAS - extraer el segmento válido
  if (codigo.includes(',')) {
    const partes = codigo.split(',');
    for (let parte of partes) {
      parte = parte.trim();
      const longitudValida = parte.length >= 12 && parte.length <= 15;
      if (longitudValida && /^[A-Z0-9\-]{12,15}$/.test(parte.toUpperCase())) {
        codigo = parte.toUpperCase();
        break;
      }
    }
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
  
  // 3. Si contiene CORCHETES [] - tomar solo lo que está ANTES
  if (codigo.includes('[')) {
    codigo = codigo.split('[')[0].trim();
  }
  
  // 4. Mayúsculas y limpiar espacios
  codigo = codigo.toUpperCase().replace(/\s+/g, '');
  
  // 5. VALIDACIÓN SYM
  const patternSYM17 = /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{2}$/;
  const patternSYM14 = /^[A-Z0-9]{5}-[A-Z0-9]{3}-[A-Z0-9]{4}-[A-Z0-9]{2}$/;
  if (patternSYM17.test(codigo) || patternSYM14.test(codigo)) {
    let needsManualReview = false;
    if (codigo.length > 20) {
      codigo = codigo.substring(0, 20);
      needsManualReview = true;
    }
    return { clean: codigo, isValid: true, isSYM: true, manualReview: needsManualReview, info: needsManualReview ? "SYM truncado" : "SYM válido" };
  }
  
  // 6. Remover caracteres inválidos
  codigo = codigo.replace(/[^A-Z0-9\-]/g, '');
  codigo = codigo.replace(/\-+/g, '-').replace(/^-+|-+$/g, '');
  
  // 7. Si es > 15 caracteres, truncar
  let needsManualReview = false;
  if (codigo.length > 15) {
    codigo = codigo.substring(0, 15);
    needsManualReview = true;
  }
  
  if (codigo.length < 5) {
    return { clean: codigo, isValid: false, manualReview: true, info: "Código muy corto" };
  }
  
  return { clean: codigo, isValid: true, isSYM: false, manualReview: needsManualReview, info: "OK" };
}

// ========================================
// 📋 LÓGICA DE CONTEO FÍSICO POR LOTES
// ========================================

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
          volverEscanearCF(); // Regresa a la vista principal
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
```

---

## 3. Backend: Google Apps Script (`CODE.gs`)

Este código gestiona la captura de datos, fotos hacia Drive y generación del CSV. Va en tu archivo local `CODE` de AppScript.

```javascript
// ========================================
// CONTEO FÍSICO POR LOTES (BACKEND)
// ========================================

function guardarEvidenciaDrive(base64Data, fileName) {
  try {
    const parentFolderName = "Evidencias Conteo Fisico PartFinder";
    let folders = DriveApp.getFoldersByName(parentFolderName);
    let folder;
    
    if (folders.hasNext()) {
      folder = folders.next();
    } else {
      folder = DriveApp.createFolder(parentFolderName);
    }
    
    const splitData = base64Data.split(',');
    const base64Content = splitData.length > 1 ? splitData[1] : splitData[0];
    
    let mimeType = MimeType.JPEG;
    if (splitData[0].indexOf('image/png') !== -1) mimeType = MimeType.PNG;
    
    const imageBlob = Utilities.newBlob(Utilities.base64Decode(base64Content), mimeType, fileName);
    const file = folder.createFile(imageBlob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    return { success: true, url: file.getUrl() };
  } catch(e) {
    Logger.log("Error en guardarEvidenciaDrive: " + e.toString());
    return { success: false, error: e.toString() };
  }
}

function guardarLotePreliminar(datosLote) {
  try {
    const sm = new SheetManager();
    const session = getSessionUser(datosLote.sessionId);
    if (!session.success) return { success: false, message: "Sesión inválida" };

    const sheet = sm.getOrCreateSheet("ConteoFisico_Lotes");
    // columns: ["LoteID", "Código", "Descripción", "Marca", "Ubicación", "CantSistema", "CantFísica", "Defectuoso", "Faltante", "Sobrante", "Fotos", "FechaCierre", "Estado", "Usuario", "Timestamp"]
    
    let isUpdate = false;
    let updateRowIndex = -1;
    let existingFotos = "";
    
    if (datosLote.loteID) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === datosLote.loteID) {
          isUpdate = true;
          updateRowIndex = i + 1;
          existingFotos = data[i][10] || "";
          break;
        }
      }
    }
    
    const timestamp = new Date().toLocaleString("es-PA");
    const loteID = isUpdate ? datosLote.loteID : ("LOTE-" + Utilities.formatDate(new Date(), "GMT-5", "yyyyMMdd-HHmmss") + "-" + datosLote.codigo);
    
    let fotosUrls = isUpdate && existingFotos ? [existingFotos] : [];
    if (datosLote.fotos && datosLote.fotos.length > 0) {
      for(let i = 0; i < datosLote.fotos.length; i++) {
        const urlRes = guardarEvidenciaDrive(datosLote.fotos[i], loteID + "_img_" + (i+1));
        if (urlRes.success) fotosUrls.push(urlRes.url);
      }
    }
    
    let sistema = parseInt(datosLote.cantSistema) || 0;
    let fisica = parseInt(datosLote.cantFisica) || 0;
    let defectuoso = parseInt(datosLote.defectuoso) || 0;
    
    let sobrante = fisica > sistema ? fisica - sistema : 0;
    let faltante = sistema > fisica ? sistema - fisica : 0;
    
    if (isUpdate) {
      sheet.getRange(updateRowIndex, 5).setValue(datosLote.ubicacion);
      sheet.getRange(updateRowIndex, 6).setValue(sistema);
      sheet.getRange(updateRowIndex, 7).setValue(fisica);
      sheet.getRange(updateRowIndex, 8).setValue(defectuoso);
      sheet.getRange(updateRowIndex, 9).setValue(faltante);
      sheet.getRange(updateRowIndex, 10).setValue(sobrante);
      sheet.getRange(updateRowIndex, 11).setValue(fotosUrls.join(", "));
      sheet.getRange(updateRowIndex, 15).setValue(timestamp);
      return { success: true, message: "Lote actualizado exitosamente.", loteID: loteID };
    } else {
      sheet.appendRow([
        loteID,
        cleanPartCode(datosLote.codigo).clean,
        datosLote.descripcion,
        datosLote.marca,
        datosLote.ubicacion,
        sistema,
        fisica,
        defectuoso,
        faltante,
        sobrante,
        fotosUrls.join(", "),
        "", 
        "ABIERTO", 
        session.user.email,
        timestamp
      ]);
      return { success: true, message: "Lote guardado provisionalmente.", loteID: loteID };
    }
  } catch(e) {
    return { success: false, message: "Error al guardar lote: " + e.toString() };
  }
}

function obtenerMisLotesActivos(sessionId) {
  try {
    const sm = new SheetManager();
    const session = getSessionUser(sessionId);
    if (!session.success) return { success: false, message: "Sesión inválida" };
    
    const sheet = sm.ss.getSheetByName("ConteoFisico_Lotes");
    if (!sheet) return { success: true, lotes: [] };
    
    const datos = sheet.getDataRange().getValues();
    if(datos.length < 2) return { success: true, lotes: [] };
    
    let lotes = [];
    for(let i = datos.length - 1; i > 0; i--) {
      const row = datos[i];
      if (row[12] === "ABIERTO" && row[13] === session.user.email) {
        lotes.push({
          fila: i + 1,
          loteID: row[0],
          codigo: row[1],
          descripcion: row[2],
          marca: row[3],
          ubicacion: row[4],
          sistema: row[5],
          fisica: row[6],
          defectuoso: row[7],
          timestamp: row[14]
        });
      }
    }
    
    return { success: true, lotes: lotes };
  } catch(e) {
    return { success: false, message: "Error al cargar lotes: " + e.toString() };
  }
}

function eliminarLoteConteoFisico(datosReq) {
  try {
    const sm = new SheetManager();
    const session = getSessionUser(datosReq.sessionId);
    if (!session.success) return { success: false, message: "Sesión inválida" };
    
    const sheet = sm.ss.getSheetByName("ConteoFisico_Lotes");
    if (!sheet) return { success: false, message: "Hoja de lotes no existe." };
    
    const datos = sheet.getDataRange().getValues();
    const loteID = datosReq.loteID;
    
    for(let i = 1; i < datos.length; i++) {
      if(datos[i][0] === loteID) {
        if (datos[i][12] === "ENVIADO") return { success: false, message: "No se puede eliminar un lote ya enviado." };
        sheet.deleteRow(i + 1);
        return { success: true, message: "Lote eliminado exitosamente." };
      }
    }
    return { success: false, message: "Lote no encontrado." };
  } catch(e) {
    return { success: false, message: "Error al eliminar: " + e.toString() };
  }
}

function cerrarLoteConteoFisico(datosReq) {
  try {
    const sm = new SheetManager();
    const session = getSessionUser(datosReq.sessionId);
    if (!session.success) return { success: false, message: "Sesión inválida" };
    
    const sheet = sm.ss.getSheetByName("ConteoFisico_Lotes");
    if (!sheet) return { success: false, message: "Hoja de lotes no existe." };
    
    const datos = sheet.getDataRange().getValues();
    const loteID = datosReq.loteID;
    
    for(let i = 1; i < datos.length; i++) {
      if(datos[i][0] === loteID) {
        if (datos[i][12] === "CERRADO") return { success: false, message: "Lote ya está cerrado." };
        sheet.getRange(i + 1, 12).setValue(new Date().toLocaleString("es-PA"));
        sheet.getRange(i + 1, 13).setValue("CERRADO");
        return { success: true, message: "Lote cerrado exitosamente." };
      }
    }
    return { success: false, message: "Lote no encontrado." };
  } catch(e) {
    return { success: false, message: "Error al cerrar: " + e.toString() };
  }
}

function enviarReporteLotes(sessionId) {
  try {
    const sm = new SheetManager();
    const session = getSessionUser(sessionId);
    if (!session.success) return { success: false, message: "Sesión inválida" };
    
    const sheet = sm.ss.getSheetByName("ConteoFisico_Lotes");
    if (!sheet) return { success: false, message: "Hoja no existe." };
    
    const datos = sheet.getDataRange().getValues();
    let lotesCerrados = [];
    
    for(let i = 1; i < datos.length; i++) {
      if (datos[i][12] === "CERRADO") {
        lotesCerrados.push({
          fila: i + 1, loteID: datos[i][0], codigo: datos[i][1], descripcion: datos[i][2],
          ubicacion: datos[i][4], sistema: datos[i][5], fisica: datos[i][6],
          defectuoso: datos[i][7], faltante: datos[i][8], sobrante: datos[i][9],
          fechaCierre: datos[i][11], usuario: datos[i][13]
        });
      }
    }
    
    if (lotesCerrados.length === 0) return { success: false, message: "No hay lotes cerrados pendientes de enviar." };
    
    let csvContent = "\uFEFF"; // BOM para Excel
    csvContent += "LoteID,Codigo,Ubicacion,CantSistema,CantFisica,Defectuoso,Sobrante,Faltante,FechaCierre,Usuario\n";
    
    let htmlFilas = "";
    lotesCerrados.forEach(l => {
      csvContent += `${l.loteID},"${l.codigo}","${l.ubicacion}",${l.sistema},${l.fisica},${l.defectuoso},${l.sobrante},${l.faltante},"${l.fechaCierre}","${l.usuario}"\n`;
      htmlFilas += `<tr>
        <td style="padding:6px;border-bottom:1px solid #ccc;">${l.codigo}</td>
        <td style="padding:6px;border-bottom:1px solid #ccc;">${l.ubicacion}</td>
        <td style="padding:6px;border-bottom:1px solid #ccc;text-align:center;">${l.sistema}</td>
        <td style="padding:6px;border-bottom:1px solid #ccc;text-align:center;">${l.fisica}</td>
        <td style="padding:6px;border-bottom:1px solid #ccc;text-align:center;">${l.defectuoso}</td>
        <td style="padding:6px;border-bottom:1px solid #ccc;text-align:center;color:#dc3545;">${l.faltante}</td>
      </tr>`;
    });
    
    const csvBlob = Utilities.newBlob(csvContent, "text/csv", `Reporte_Lotes_CF_${Date.now()}.csv`);
    const emailMgr = new EmailManagerRobusto(sm);
    const destinatarios = emailMgr.obtenerDestinatariosPorTipo("CONTEO_FISICO"); 
    
    if (destinatarios.length === 0) return { success: false, message: "No hay destinatarios configurados para CONTEO_FISICO." };
    
    const htmlContenido = `
      <h3>Resumen de Lotes Cerrados</h3>
      <p>Se han procesado ${lotesCerrados.length} lotes listos para ajuste. El detalle completo está en el CSV adjunto.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:20px;font-size:12px;">
        <tr style="background:#f8f9fa;">
          <th style="padding:6px;">Código</th><th style="padding:6px;">Ubicación</th>
          <th style="padding:6px;">Sistema</th><th style="padding:6px;">Física</th>
          <th style="padding:6px;">Defect.</th><th style="padding:6px;">Fallt.</th>
        </tr>
        ${htmlFilas}
      </table>
    `;
    
    const htmlFinal = emailMgr.construirHtmlReporte("Reporte de Lotes de Conteo Físico", { fechaGeneracion: new Date().toLocaleString("es-PA") }, htmlContenido);
    const asunto = `PartFinder - Reporte de Lotes de Conteo Físico (${lotesCerrados.length} lotes)`;
    
    let enviados = 0;
    destinatarios.forEach(dest => {
      try {
        GmailApp.sendEmail(dest.email, asunto, "Ver archivo adjunto CSV.", {
          htmlBody: htmlFinal, name: "PartFinder Lotes", attachments: [csvBlob]
        });
        enviados++;
      } catch(e) {}
    });
    
    if (enviados > 0) {
      lotesCerrados.forEach(l => { sheet.getRange(l.fila, 13).setValue("ENVIADO"); });
      
      try {
        const invSheet = sm.ss.getSheetByName("Inventario");
        if (invSheet) {
          let headers = invSheet.getRange(1, 1, 1, invSheet.getLastColumn() || 1).getValues()[0];
          let colUltimoInv = headers.indexOf("Último Inventario");
          let colContado = headers.indexOf("Contado CF");
          
          if (colUltimoInv === -1) { colUltimoInv = headers.length; headers.push("Último Inventario"); invSheet.getRange(1, colUltimoInv + 1).setValue("Último Inventario"); }
          if (colContado === -1) { colContado = headers.length; headers.push("Contado CF"); invSheet.getRange(1, colContado + 1).setValue("Contado CF"); }
          
          if (invSheet.getLastRow() > 1) {
            const codigosList = invSheet.getRange(2, 1, invSheet.getLastRow() - 1, 1).getValues();
            const timestampActual = new Date().toLocaleString("es-PA");
            
            lotesCerrados.forEach(l => {
              const codBuscar = cleanPartCode(l.codigo).clean;
              for (let i = 0; i < codigosList.length; i++) {
                if (codigosList[i][0] && cleanPartCode(codigosList[i][0].toString()).clean === codBuscar) {
                  invSheet.getRange(i + 2, colUltimoInv + 1).setValue(timestampActual);
                  invSheet.getRange(i + 2, colContado + 1).setValue("SI");
                  break;
                }
              }
            });
            clearCacheInventario(); // Refrescar caché
          }
        }
      } catch (invErr) { }
      return { success: true, message: `Reporte enviado a ${enviados} destinatarios.` };
    }
    return { success: false, message: "Error al despachar correos." };
  } catch(e) {
    return { success: false, message: "Error de ejecución: " + e.toString() };
  }
}
```
