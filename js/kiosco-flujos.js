// ═══════════════════════════════════════════════════════════════
// FLUJOS PARA PLANTA-KIOSCOS.HTML
// Cada flujo envuelto en IIFE para evitar colisiones de scope
// ═══════════════════════════════════════════════════════════════

// ═══ DESPACHOS ═══
(function() {
  let _data = null;

  async function _cargar(subopcion = null) {
    console.log('[Despachos] Cargando flujo...');

    const container = document.getElementById('despachos-content');
    container.innerHTML = `
      <div class="placeholder-text">
        <strong>Flujo de Despachos</strong><br>
        <em>(Integración Fase 2)</em><br><br>
        Endpoint: GET /api/despachos?action=listar-ocs<br>
        Estado: Placeholder en espera de código
      </div>
    `;

    // TODO Fase 2: cargar desde /api/despachos
    // - listar proyectos
    // - seleccionar mueble
    // - listar bultos
    // - imprimir etiquetas 60×30mm
    // - marcar como despacho realizado
  }

  window.flujo_despachos = {
    cargar: _cargar,
    volver: () => {
      document.getElementById('screen-despachos').classList.remove('active');
    }
  };
})();

// ═══ TERCERIZADOS (Baru/Rodart) ═══
(function() {
  let _subopcion = null;

  async function _cargar(subopcion = null) {
    _subopcion = subopcion;
    console.log('[Tercerizados]', subopcion, 'Cargando flujo...');

    const container = document.getElementById('tercerizados-content');
    const proveedor = subopcion === 'baru' ? 'Baru' : 'Rodart';

    container.innerHTML = `
      <div class="placeholder-text">
        <strong>Flujo de Tercerizados: ${proveedor}</strong><br>
        <em>(Integración Fase 3)</em><br><br>
        Acciones:<br>
        • Despachar piezas<br>
        • Recibir piezas<br>
        • Marcar retorno<br><br>
        Endpoint: /api/tiempos?action=despachar-baru | recibir-baru | marcar-retorno-baru<br>
        Estado: Placeholder en espera de código
      </div>
    `;

    // TODO Fase 3: cargar desde /api/tiempos
    // - elegir proyecto → mueble
    // - Acción 1: Despachar a Baru → crear partida, marcar estado='enviado', imprimir remito
    // - Acción 2: Recibir de Baru → listar enviados, confirmar recepción, imprimir comprobante
    // - Acción 3: Marcar retorno → listar recibidos, cerrar ciclo
  }

  window.flujo_tercerizados = {
    cargar: _cargar,
    volver: () => {
      document.getElementById('screen-tercerizados').classList.remove('active');
    }
  };
})();

// ═══ RECEPCIONES OC ═══
(function() {
  let _data = null;

  async function _cargar(subopcion = null) {
    console.log('[Recepciones OC] Cargando flujo...');

    const container = document.getElementById('oc-content');
    container.innerHTML = `
      <div class="placeholder-text">
        <strong>Flujo de Recepciones OC</strong><br>
        <em>(Integración Fase 3)</em><br><br>
        Acciones:<br>
        • Listar OCs pendientes / recibidas<br>
        • Escanear número de OC o artículos (QR/código de barras)<br>
        • Marcar como recibida<br>
        • Imprimir etiquetas de artículos<br><br>
        Endpoint: GET /api/recepciones?action=listar-ocs<br>
        Estado: Placeholder en espera de código
      </div>
    `;

    // TODO Fase 3: cargar desde /api/recepciones
    // - listar OCs pendientes / recibidas
    // - abrir detalle de OC
    // - escanear número de OC o artículos (QR / código de barras)
    // - marcar como recibida
    // - imprimir etiquetas de artículos (abre etiquetas-maderable)
  }

  window.flujo_oc = {
    cargar: _cargar,
    volver: () => {
      document.getElementById('screen-oc').classList.remove('active');
    }
  };
})();

// ═══ KITTING (MRP) ═══
(function() {
  let _data = null;

  async function _cargar(subopcion = null) {
    console.log('[Kitting] Cargando flujo...');

    const container = document.getElementById('kitting-content');
    container.innerHTML = `
      <div class="placeholder-text">
        <strong>Flujo de Kitting (MRP)</strong><br>
        <em>(Integración Fase 2)</em><br><br>
        Acciones:<br>
        • Listar SOs (pendientes / parciales / completas)<br>
        • Abrir detalle: tabla de líneas<br>
        • Checkbox para marcar líneas como armadas<br>
        • Marcar todo como armado<br>
        • Confirmar / guardar<br><br>
        Endpoint: GET /api/tiempos?action=listar-sos<br>
        Estado: Placeholder en espera de código
      </div>
    `;

    // TODO Fase 2: cargar desde /api/tiempos?action=listar-sos
    // - listar SOs (pendientes / parciales / completas)
    // - abrir detalle: tabla de líneas
    // - checkbox para marcar líneas como armadas
    // - marcar todo como armado
    // - confirmar / guardar
    // - impresión: opcional (lista de armado en navegador)
  }

  window.flujo_kitting = {
    cargar: _cargar,
    volver: () => {
      document.getElementById('screen-kitting').classList.remove('active');
    }
  };
})();
