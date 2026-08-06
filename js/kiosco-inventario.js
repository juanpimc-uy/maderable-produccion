// js/kiosco-inventario.js — Flujo de inventario para planta-kioscos.html
// IIFE — patrón de js/kiosco-flujos.js
(function () {
  'use strict';
  var API = '/api/inventario';
  var _empId = null;
  var _item = null; // ficha actual
  var _stock = [];
  var _total = 0;
  var _container = null;
  var _screen = 'home'; // home | ficha | salida-motivo | salida-proyecto | salida-mueble | keypad | alta | alta-ok | contenido-ubi | ficha-placa | placa-consumo-proy | placa-consumo-mueble | placa-consumo-reserva | placa-consumo-ok | placa-traslado | placa-descarte
  var _action = null; // entrada | salida | traslado | ajuste | a_picking | alta
  var _unidad = null; // ficha placa actual
  var _unidadItem = null;
  var _unidadReserva = null;
  var _placaProyElegido = null;
  var _placaMuebleElegido = null;
  var _proyectos = null;
  var _proyectoElegido = null;
  var _muebleElegido = null;
  var _motivoElegido = null;
  var _ubiElegida = null;
  var _ajusteAnterior = 0;
  var _contenidoUbi = null; // para pantalla CONTENIDO-UBI

  // ═══ CSS ═══
  if (!document.getElementById('inv-kiosco-css')) {
    var st = document.createElement('style');
    st.id = 'inv-kiosco-css';
    st.textContent = ''
      + '.inv-wrap{font-family:"DM Sans",sans-serif;color:#e8e8e8;min-height:100%;}'
      + '.inv-home-input{width:100%;font-family:"Space Mono",monospace;font-size:18px;background:#252525;border:2px solid #2a2a2a;border-radius:10px;padding:16px 20px;color:#FFD600;text-align:center;outline:none;letter-spacing:2px;text-transform:uppercase;}'
      + '.inv-home-input:focus{border-color:#FFD600;}'
      + '.inv-home-input::placeholder{color:#555;text-transform:none;letter-spacing:0;}'
      + '.inv-actions{display:flex;gap:10px;margin-top:16px;justify-content:center;flex-wrap:wrap;}'
      + '.inv-btn{font-family:"Space Mono",monospace;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;border:1px solid #2a2a2a;border-radius:8px;padding:12px 20px;cursor:pointer;background:#252525;color:#e8e8e8;transition:all .15s;}'
      + '.inv-btn:hover{border-color:#FFD600;color:#FFD600;}'
      + '.inv-btn-accent{background:#FFD600;color:#000;border-color:#FFD600;}'
      + '.inv-btn-accent:hover{opacity:.85;color:#000;}'
      + '.inv-btn:disabled{opacity:.35;cursor:not-allowed;}'
      + '.inv-btn-lg{padding:16px 28px;font-size:13px;}'
      + '.inv-label{font-family:"Space Mono",monospace;font-size:9px;letter-spacing:1px;text-transform:uppercase;color:#888;margin-bottom:4px;}'
      + '.inv-code{font-family:"Space Mono",monospace;font-size:28px;font-weight:700;color:#FFD600;letter-spacing:2px;}'
      + '.inv-desc{font-size:14px;color:#e8e8e8;margin-top:4px;}'
      + '.inv-badge{font-family:"Space Mono",monospace;font-size:9px;padding:3px 8px;border-radius:4px;text-transform:uppercase;letter-spacing:.5px;display:inline-block;margin-right:6px;}'
      + '.inv-badge-herraje{background:#1a2a1a;color:#6ddf6d;border:1px solid #2a3a2a;}'
      + '.inv-badge-placa{background:#1a1a2a;color:#6d9ddf;border:1px solid #2a2a3a;}'
      + '.inv-badge-madera{background:#2a1f0a;color:#dfa86d;border:1px solid #3a2a0a;}'
      + '.inv-badge-consumible{background:#2a2a1a;color:#dfdf6d;border:1px solid #3a3a2a;}'
      + '.inv-badge-otro{background:#2a1a1a;color:#df6d6d;border:1px solid #3a2020;}'
      + '.inv-badge-huerfano{background:#3a1a1a;color:#F05C5C;border:1px solid #5a2020;font-weight:700;}'
      + '.inv-stock-row{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid #1a1a1a;font-size:12px;}'
      + '.inv-stock-row .ubi{font-family:"Space Mono",monospace;font-weight:700;color:#FFD600;font-size:11px;min-width:100px;}'
      + '.inv-stock-row .qty{font-family:"Space Mono",monospace;font-weight:700;font-size:14px;}'
      + '.inv-stock-row .pick{font-family:"Space Mono",monospace;font-size:8px;color:#3DD68C;border:1px solid #1f3a26;border-radius:3px;padding:1px 5px;margin-left:4px;}'
      + '.inv-foto{width:120px;height:120px;object-fit:cover;border-radius:8px;border:1px solid #2a2a2a;}'
      + '.inv-total{font-family:"Space Mono",monospace;font-size:20px;font-weight:700;color:#e8e8e8;}'
      + '.inv-keypad{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-width:280px;margin:16px auto;}'
      + '.inv-key{font-family:"Space Mono",monospace;font-size:20px;font-weight:700;background:#252525;border:1px solid #2a2a2a;border-radius:8px;padding:16px;cursor:pointer;color:#e8e8e8;text-align:center;user-select:none;transition:background .1s;}'
      + '.inv-key:active{background:#333;}'
      + '.inv-key-accent{background:#FFD600;color:#000;border-color:#FFD600;}'
      + '.inv-keypad-display{font-family:"Space Mono",monospace;font-size:36px;font-weight:700;color:#FFD600;text-align:center;padding:12px;background:#1e1e1e;border:1px solid #2a2a2a;border-radius:8px;margin-bottom:12px;min-height:60px;}'
      + '.inv-list-item{display:flex;align-items:center;gap:12px;padding:12px;border-bottom:1px solid #1a1a1a;cursor:pointer;transition:background .1s;}'
      + '.inv-list-item:hover{background:rgba(255,214,0,.05);}'
      + '.inv-list-item:active{background:rgba(255,214,0,.1);}'
      + '.inv-list-item .li-code{font-family:"Space Mono",monospace;font-weight:700;color:#FFD600;font-size:11px;}'
      + '.inv-list-item .li-desc{font-size:12px;color:#e8e8e8;}'
      + '.inv-list-item .li-foto{width:40px;height:40px;object-fit:cover;border-radius:4px;}'
      + '.inv-search-input{width:100%;font-family:"Space Mono",monospace;font-size:13px;background:#252525;border:1px solid #2a2a2a;border-radius:8px;padding:12px 16px;color:#e8e8e8;outline:none;}'
      + '.inv-search-input:focus{border-color:#FFD600;}'
      + '.inv-motivo-btn{flex:1;min-width:120px;}'
      + '.inv-toast{position:fixed;top:20px;left:50%;transform:translateX(-50%);font-family:"Space Mono",monospace;font-size:12px;font-weight:700;padding:12px 24px;border-radius:8px;z-index:9999;pointer-events:none;opacity:0;transition:opacity .3s;}'
      + '.inv-toast.show{opacity:1;}'
      + '.inv-toast-ok{background:#0a2a0a;color:#3DD68C;border:1px solid #1f3a26;}'
      + '.inv-toast-err{background:#2a0a0a;color:#F05C5C;border:1px solid #5a2020;}'
      + '.inv-flash{transition:background .25s;}'
      + '.inv-flash-ok{background:rgba(61,214,140,.15)!important;}'
      + '.inv-flash-err{background:rgba(240,92,92,.15)!important;}'
      + '.inv-back{font-family:"Space Mono",monospace;font-size:11px;color:#888;cursor:pointer;margin-bottom:16px;display:inline-block;}'
      + '.inv-back:hover{color:#FFD600;}'
      + '.inv-alta-familia{display:flex;gap:8px;flex-wrap:wrap;}'
      + '.inv-alta-familia .inv-btn.selected{background:#FFD600;color:#000;border-color:#FFD600;}'
      + '.inv-section{margin-bottom:20px;}'
      + '.inv-field{margin-bottom:12px;}'
      + '.inv-field input,.inv-field select{width:100%;font-family:"Space Mono",monospace;font-size:12px;background:#252525;border:1px solid #2a2a2a;border-radius:6px;padding:10px 12px;color:#e8e8e8;outline:none;}'
      + '.inv-field input:focus{border-color:#FFD600;}';
    document.head.appendChild(st);
  }

  // ═══ AUDIO FEEDBACK ═══
  var _audioCtx = null;
  function _beep(isOk) {
    try {
      if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var ctx = _audioCtx;
      if (isOk) {
        var o = ctx.createOscillator(); var g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = 1200; g.gain.value = 0.15;
        o.start(); o.stop(ctx.currentTime + 0.08);
      } else {
        for (var i = 0; i < 2; i++) {
          var o2 = ctx.createOscillator(); var g2 = ctx.createGain();
          o2.connect(g2); g2.connect(ctx.destination);
          o2.frequency.value = 300; g2.gain.value = 0.2;
          o2.start(ctx.currentTime + i * 0.15);
          o2.stop(ctx.currentTime + i * 0.15 + 0.1);
        }
      }
    } catch (e) {}
  }

  function _flash(isOk) {
    if (!_container) return;
    var cls = isOk ? 'inv-flash-ok' : 'inv-flash-err';
    _container.classList.add('inv-flash', cls);
    setTimeout(function () { _container.classList.remove(cls); }, 250);
  }

  var _toastEl = null;
  function _toast(msg, isOk) {
    if (!_toastEl) { _toastEl = document.createElement('div'); _toastEl.className = 'inv-toast'; document.body.appendChild(_toastEl); }
    _toastEl.textContent = msg;
    _toastEl.className = 'inv-toast show ' + (isOk ? 'inv-toast-ok' : 'inv-toast-err');
    setTimeout(function () { _toastEl.classList.remove('show'); }, 2500);
  }

  function _ok(msg) { _beep(true); _flash(true); _toast(msg, true); }
  function _fail(msg) { _beep(false); _flash(false); _toast(msg, false); }

  // ═══ API ═══
  function _get(action, params) {
    var qs = new URLSearchParams(params || {}); qs.set('empleado_id', _empId);
    return fetch(API + '?action=' + action + '&' + qs.toString()).then(function (r) { return r.json(); });
  }
  function _post(action, body) {
    body = body || {}; body.empleado_id = _empId;
    return fetch(API + '?action=' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); });
  }

  // ═══ RENDER ═══
  function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function _show(screen) {
    _screen = screen;
    _render();
    // Refocus scan input on home
    if (screen === 'home') setTimeout(function () { var inp = document.getElementById('inv-scan'); if (inp) inp.focus(); }, 50);
  }

  function _render() {
    if (!_container) return;
    if (_screen === 'home') _renderHome();
    else if (_screen === 'ficha') _renderFicha();
    else if (_screen === 'salida-motivo') _renderSalidaMotivo();
    else if (_screen === 'salida-proyecto') _renderSalidaProyecto();
    else if (_screen === 'salida-mueble') _renderSalidaMueble();
    else if (_screen === 'keypad') _renderKeypad();
    else if (_screen === 'alta') _renderAlta();
    else if (_screen === 'alta-ok') _renderAltaOk();
    else if (_screen === 'contenido-ubi') _renderContenidoUbi();
    else if (_screen === 'buscar') _renderBuscar();
    else if (_screen === 'ajuste-bin') _renderAjusteBin();
    else if (_screen === 'scan-ubi') _renderScanUbi();
    else if (_screen === 'ficha-placa') _renderFichaPlaca();
    else if (_screen === 'placa-consumo-proy') _renderPlacaConsumoProy();
    else if (_screen === 'placa-consumo-mueble') _renderPlacaConsumoMueble();
    else if (_screen === 'placa-consumo-reserva') _renderPlacaConsumoReserva();
    else if (_screen === 'placa-consumo-ok') _renderPlacaConsumoOk();
    else if (_screen === 'placa-traslado') _renderPlacaTraslado();
    else if (_screen === 'placa-descarte') _renderPlacaDescarte();
  }

  // ── HOME ──
  function _renderHome() {
    _container.innerHTML = '<div class="inv-wrap" style="padding:24px;">'
      + '<div class="inv-label">Escanear código de barras o QR</div>'
      + '<input id="inv-scan" class="inv-home-input" placeholder="Escanear o escribir código..." autofocus>'
      + '<div class="inv-actions" style="margin-top:24px;">'
      + '<button class="inv-btn inv-btn-lg" onclick="_invAlta()">+ Alta rápida</button>'
      + '<button class="inv-btn inv-btn-lg" onclick="_invBuscar()">🔍 Buscar sin etiqueta</button>'
      + '<button class="inv-btn inv-btn-lg" onclick="_invRecepcion()">📥 Recepción OC</button>'
      + '</div></div>';
    var inp = document.getElementById('inv-scan');
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') _invScan(inp.value); });
    inp.addEventListener('blur', function () { setTimeout(function () { if (_screen === 'home' && inp) inp.focus(); }, 100); });
    inp.focus();
  }

  function _invScan(val) {
    var codigo = (val || '').trim();
    if (!codigo) return;
    _get('resolver-codigo', { codigo: codigo }).then(function (r) {
      var inp = document.getElementById('inv-scan');
      if (inp) inp.value = '';
      if (!r.ok) { _fail(r.msg || 'No encontrado'); return; }
      if (r.tipo === 'item') {
        _item = r.item; _stock = r.stock || []; _total = r.total || 0;
        _show('ficha');
      } else if (r.tipo === 'ubicacion') {
        _contenidoUbi = { ubicacion: r.ubicacion, contenido: r.contenido || [] };
        _show('contenido-ubi');
      } else if (r.tipo === 'unidad') {
        _unidad = r.unidad; _unidadItem = r.item; _unidadReserva = r.reserva_nombre || null;
        _show('ficha-placa');
      } else if (r.tipo === 'madera') {
        _fail('Pieza de madera — usá el flujo Madera');
      }
    }).catch(function () { _fail('Error de conexión'); });
  }

  // ── CONTENIDO UBICACIÓN ──
  function _renderContenidoUbi() {
    var u = _contenidoUbi.ubicacion;
    var items = _contenidoUbi.contenido || [];
    var html = '<div class="inv-wrap" style="padding:24px;">'
      + '<div class="inv-back" onclick="_invHome()">← Volver</div>'
      + '<div class="inv-code">' + _esc(u.codigo) + '</div>'
      + '<div class="inv-desc">' + _esc(u.nombre || '') + '</div>'
      + '<div class="inv-label" style="margin-top:16px;">Contenido (' + items.length + ' ítems)</div>';
    if (!items.length) {
      html += '<div style="color:#888;padding:16px 0;">Ubicación vacía</div>';
    } else {
      items.forEach(function (s) {
        var it = s.inv_items || {};
        html += '<div class="inv-list-item" onclick="_invScan(\'' + _esc(it.codigo || '') + '\')">'
          + '<div style="flex:1;"><div class="li-code">' + _esc(it.codigo) + '</div><div class="li-desc">' + _esc(it.descripcion) + '</div></div>'
          + '<div class="inv-stock-row" style="border:0;padding:0;"><span class="qty">' + (s.cantidad || 0) + '</span></div>'
          + '</div>';
      });
    }
    html += '</div>';
    _container.innerHTML = html;
  }

  // ── FICHA ──
  function _renderFicha() {
    var it = _item;
    var html = '<div class="inv-wrap" style="padding:24px;">'
      + '<div class="inv-back" onclick="_invHome()">← Volver</div>'
      + '<div style="display:flex;gap:16px;align-items:flex-start;">';
    if (it.foto_url) html += '<img class="inv-foto" src="' + _esc(it.foto_url) + '">';
    html += '<div>'
      + '<div class="inv-code">' + _esc(it.codigo) + '</div>'
      + '<div class="inv-desc">' + _esc(it.descripcion) + '</div>'
      + '<div style="margin-top:8px;">'
      + '<span class="inv-badge inv-badge-' + (it.familia || 'otro') + '">' + _esc(it.familia || 'otro') + '</span>'
      + (!it.zoho_item_id ? '<span class="inv-badge inv-badge-huerfano">HUÉRFANO</span>' : '')
      + '</div></div></div>';
    // Stock
    html += '<div class="inv-section" style="margin-top:20px;">'
      + '<div class="inv-label">Stock por ubicación</div>';
    if (!_stock.length) {
      html += '<div style="color:#888;padding:8px 0;">Sin stock</div>';
    } else {
      _stock.forEach(function (s) {
        var u = s.inv_ubicaciones || {};
        var isPick = it.ubicacion_picking_id && u.id === it.ubicacion_picking_id;
        html += '<div class="inv-stock-row">'
          + '<span class="ubi">' + _esc(u.codigo || '?') + '</span>'
          + '<span class="qty">' + (s.cantidad || 0) + '</span>'
          + (isPick ? '<span class="pick">PICKING</span>' : '')
          + '</div>';
      });
    }
    html += '<div class="inv-stock-row" style="border-top:1px solid #2a2a2a;"><span class="ubi">TOTAL</span><span class="inv-total">' + _total + '</span></div>';
    html += '</div>';
    // Actions
    html += '<div class="inv-actions">';
    if (it.ubicacion_picking_id) html += '<button class="inv-btn inv-btn-accent inv-btn-lg" onclick="_invAPicking()">→ A PICKING</button>';
    html += '<button class="inv-btn inv-btn-lg" onclick="_invSalida()">SALIDA</button>'
      + '<button class="inv-btn inv-btn-lg" onclick="_invEntrada()">ENTRADA</button>'
      + '<button class="inv-btn inv-btn-lg" onclick="_invTraslado()">TRASLADO</button>'
      + '<button class="inv-btn inv-btn-lg" onclick="_invAjuste()">AJUSTE</button>'
      + '</div></div>';
    _container.innerHTML = html;
  }

  // ── ACTIONS ──
  window._invShow = _show;
  window._invHome = function () { _show('home'); };
  window._invImprimirItem = function () {
    if (!window.Etiquetas) { alert('Sistema de etiquetas no disponible'); return; }
    if (!_item) return;
    Etiquetas.imprimir('inv-item', [{ codigo: _item.codigo, descripcion: _item.descripcion, familia: _item.familia || '', _qr: _item.codigo }]);
  };
  window._invRecepcion = function () {
    if (window.abrirFlujo) { window.abrirFlujo('oc'); }
    else { _fail('Recepción disponible desde el menú del kiosco'); }
  };
  window._invAlta = function () { _show('alta'); };
  window._invBuscar = function () { _show('buscar'); };
  window._invScan = _invScan;

  window._invAPicking = function () {
    _action = 'a_picking'; _show('keypad');
  };
  window._invSalida = function () {
    _action = 'salida'; _show('salida-motivo');
  };
  window._invEntrada = function () {
    _action = 'entrada'; _ubiElegida = null; _show('scan-ubi');
  };
  window._invTraslado = function () {
    _action = 'traslado'; _ubiElegida = null; _show('scan-ubi');
  };
  window._invAjuste = function () {
    _action = 'ajuste'; _show('ajuste-bin');
  };

  // ── SALIDA: motivo ──
  function _renderSalidaMotivo() {
    _container.innerHTML = '<div class="inv-wrap" style="padding:24px;">'
      + '<div class="inv-back" onclick="_invShow(\'ficha\')">← Volver a ficha</div>'
      + '<div class="inv-label">Motivo de salida</div>'
      + '<div class="inv-actions" style="margin-top:12px;">'
      + '<button class="inv-btn inv-btn-accent inv-btn-lg inv-motivo-btn" onclick="_invMotivoConsumo()">CONSUMO PROYECTO</button>'
      + '<button class="inv-btn inv-btn-lg inv-motivo-btn" onclick="_invMotivo(\'venta\')">VENTA</button>'
      + '<button class="inv-btn inv-btn-lg inv-motivo-btn" onclick="_invMotivo(\'descarte\')">DESCARTE</button>'
      + '</div></div>';
  }
  window._invMotivoConsumo = function () { _motivoElegido = 'consumo_proyecto'; _proyectoElegido = null; _muebleElegido = null; _show('salida-proyecto'); };
  window._invMotivo = function (m) { _motivoElegido = m; _proyectoElegido = null; _muebleElegido = null; _show('keypad'); };

  // ── SALIDA: proyecto picker ──
  function _renderSalidaProyecto() {
    _container.innerHTML = '<div class="inv-wrap" style="padding:24px;">'
      + '<div class="inv-back" onclick="_invShow(\'salida-motivo\')">← Volver</div>'
      + '<div class="inv-label">Elegir proyecto</div>'
      + '<input id="inv-proy-q" class="inv-search-input" placeholder="Buscar por número, nombre, obra, cliente..." autofocus>'
      + '<div id="inv-proy-list" style="margin-top:12px;max-height:400px;overflow-y:auto;"></div></div>';
    var inp = document.getElementById('inv-proy-q');
    inp.addEventListener('input', function () { _filterProys(inp.value); });
    if (!_proyectos) {
      fetch('/api/tiempos?action=proyectos-activos').then(function (r) { return r.json(); }).then(function (r) {
        _proyectos = (r.proyectos || r.data || []);
        _filterProys('');
      }).catch(function () { _fail('Error cargando proyectos'); });
    } else {
      _filterProys('');
    }
  }
  function _filterProys(q) {
    q = (q || '').toLowerCase();
    var list = (_proyectos || []).filter(function (p) {
      if (!q) return true;
      return ((p.numero || '') + ' ' + (p.nombre || '') + ' ' + (p.obra || '') + ' ' + (p.cliente || '') + ' ' + (p.cliente_nombre || '')).toLowerCase().indexOf(q) >= 0;
    }).slice(0, 30);
    var el = document.getElementById('inv-proy-list');
    if (!el) return;
    el.innerHTML = list.map(function (p) {
      return '<div class="inv-list-item" onclick="_invPickProy(\'' + _esc(p.id) + '\')">'
        + '<div style="flex:1;"><div class="li-code">' + _esc(p.numero || '') + '</div><div class="li-desc">' + _esc(p.nombre || p.cliente_nombre || '') + '</div></div></div>';
    }).join('') || '<div style="color:#888;padding:12px;">Sin resultados</div>';
  }
  window._invPickProy = function (id) {
    _proyectoElegido = (_proyectos || []).find(function (p) { return p.id === id; }) || { id: id };
    _show('salida-mueble');
  };

  // ── SALIDA: mueble picker ──
  function _renderSalidaMueble() {
    var muebles = [];
    if (_proyectoElegido && Array.isArray(_proyectoElegido.muebles)) {
      muebles = _proyectoElegido.muebles;
    }
    var html = '<div class="inv-wrap" style="padding:24px;">'
      + '<div class="inv-back" onclick="_invShow(\'salida-proyecto\')">← Volver</div>'
      + '<div class="inv-label">Mueble (opcional)</div>'
      + '<div class="inv-list-item" onclick="_invPickMueble(null)"><div style="flex:1;"><div class="li-code">SIN MUEBLE</div></div></div>';
    muebles.forEach(function (m) {
      html += '<div class="inv-list-item" onclick="_invPickMueble(\'' + _esc(m.id || '') + '\')">'
        + '<div style="flex:1;"><div class="li-code">' + _esc(m.codigo || m.id) + '</div><div class="li-desc">' + _esc(m.nombre || '') + '</div></div></div>';
    });
    html += '</div>';
    _container.innerHTML = html;
  }
  window._invPickMueble = function (id) { _muebleElegido = id; _show('keypad'); };

  // ── SCAN UBI (para entrada/traslado) ──
  function _renderScanUbi() {
    var label = _action === 'entrada' ? 'Escanear bin de DESTINO' : 'Escanear bin de DESTINO (traslado)';
    _container.innerHTML = '<div class="inv-wrap" style="padding:24px;">'
      + '<div class="inv-back" onclick="_invShow(\'ficha\')">← Volver a ficha</div>'
      + '<div class="inv-label">' + label + '</div>'
      + '<input id="inv-ubi-scan" class="inv-home-input" placeholder="Escanear ubicación..." autofocus>'
      + '</div>';
    var inp = document.getElementById('inv-ubi-scan');
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var cod = (inp.value || '').trim().toUpperCase();
        if (!cod) return;
        _ubiElegida = cod;
        _show('keypad');
      }
    });
    inp.focus();
  }

  // ── AJUSTE: elegir bin ──
  function _renderAjusteBin() {
    var html = '<div class="inv-wrap" style="padding:24px;">'
      + '<div class="inv-back" onclick="_invShow(\'ficha\')">← Volver a ficha</div>'
      + '<div class="inv-label">Elegir bin para ajuste</div>';
    if (!_stock.length) {
      html += '<div style="color:#888;padding:12px;">Sin stock — escaneá un bin</div>'
        + '<input id="inv-ajuste-scan" class="inv-home-input" style="margin-top:12px;" placeholder="Escanear ubicación..." autofocus>';
    } else {
      _stock.forEach(function (s) {
        var u = s.inv_ubicaciones || {};
        html += '<div class="inv-list-item" onclick="_invPickAjusteBin(\'' + _esc(u.id || '') + '\',' + (s.cantidad || 0) + ')">'
          + '<div class="li-code">' + _esc(u.codigo) + '</div><div class="li-desc">' + _esc(u.nombre || '') + '</div>'
          + '<div class="qty" style="font-family:\'Space Mono\',monospace;font-weight:700;font-size:14px;margin-left:auto;">' + (s.cantidad || 0) + '</div></div>';
      });
      html += '<div style="margin-top:12px;"><div class="inv-label">O escanear otro bin</div>'
        + '<input id="inv-ajuste-scan" class="inv-home-input" placeholder="Escanear ubicación...">';
      html += '</div>';
    }
    html += '</div>';
    _container.innerHTML = html;
    var inp = document.getElementById('inv-ajuste-scan');
    if (inp) {
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          var cod = (inp.value || '').trim().toUpperCase();
          if (!cod) return;
          _ubiElegida = cod; _ajusteAnterior = 0;
          _show('keypad');
        }
      });
    }
  }
  window._invPickAjusteBin = function (ubiId, actual) {
    _ubiElegida = ubiId; _ajusteAnterior = actual;
    _show('keypad');
  };

  // ── KEYPAD ──
  var _kpVal = '';
  function _renderKeypad() {
    _kpVal = '';
    var label = 'Cantidad';
    if (_action === 'ajuste') label = 'Valor NUEVO (actual: ' + _ajusteAnterior + ')';
    _container.innerHTML = '<div class="inv-wrap" style="padding:24px;">'
      + '<div class="inv-back" onclick="_invKeypadBack()">← Volver</div>'
      + '<div class="inv-label">' + label + '</div>'
      + '<div class="inv-keypad-display" id="inv-kp-display">0</div>'
      + '<div class="inv-keypad">'
      + [1,2,3,4,5,6,7,8,9].map(function (n) { return '<div class="inv-key" onclick="_kp(\'' + n + '\')">' + n + '</div>'; }).join('')
      + '<div class="inv-key" onclick="_kp(\'C\')">C</div>'
      + '<div class="inv-key" onclick="_kp(\'0\')">0</div>'
      + '<div class="inv-key" onclick="_kp(\'⌫\')">⌫</div>'
      + '</div>'
      + '<div class="inv-actions"><button class="inv-btn inv-btn-accent inv-btn-lg" onclick="_kpSubmit()">CONFIRMAR</button></div>'
      + '</div>';
  }
  window._kp = function (k) {
    if (k === 'C') _kpVal = '';
    else if (k === '⌫') _kpVal = _kpVal.slice(0, -1);
    else _kpVal += k;
    var el = document.getElementById('inv-kp-display');
    if (el) el.textContent = _kpVal || '0';
  };
  window._invKeypadBack = function () {
    if (_action === 'a_picking' || _action === 'ajuste' || _action === 'entrada' || _action === 'traslado') _show('ficha');
    else if (_action === 'salida' && _motivoElegido === 'consumo_proyecto') _show('salida-mueble');
    else _show('salida-motivo');
  };
  window._kpSubmit = function () {
    var val = Number(_kpVal);
    if (_action !== 'ajuste' && (isNaN(val) || val <= 0)) { _fail('Ingresá una cantidad mayor a 0'); return; }
    if (_action === 'ajuste' && (isNaN(val) || val < 0)) { _fail('Valor debe ser >= 0'); return; }

    var body = { item_id: _item.id, tipo: _action === 'a_picking' ? 'traslado' : _action, cantidad: val };
    if (_action === 'a_picking') body.a_picking = true;
    if (_action === 'salida') {
      body.motivo = _motivoElegido;
      if (_proyectoElegido) body.proyecto_id = _proyectoElegido.id;
      if (_muebleElegido) body.mueble_id = _muebleElegido;
    }
    if (_action === 'entrada') body.ubicacion_codigo = _ubiElegida;
    if (_action === 'traslado') body.ubicacion_destino_codigo = _ubiElegida;
    if (_action === 'ajuste') {
      body.ajuste_valor_nuevo = val;
      body.tipo = 'ajuste';
      if (typeof _ubiElegida === 'string') body.ubicacion_codigo = _ubiElegida;
      else body.ubicacion_id = _ubiElegida;
    }

    _post('movimiento', body).then(function (r) {
      if (!r.ok) { _fail(r.msg || 'Error'); return; }
      var msg = _action.toUpperCase() + ' ✓ — ' + val;
      if (r.desglose && r.desglose.length) msg += ' (de ' + r.desglose.length + ' bin' + (r.desglose.length > 1 ? 'es' : '') + ')';
      _ok(msg);
      // Refresh ficha
      _get('resolver-codigo', { codigo: _item.codigo }).then(function (r2) {
        if (r2.ok && r2.tipo === 'item') { _item = r2.item; _stock = r2.stock || []; _total = r2.total || 0; }
        _show('ficha');
      });
    }).catch(function () { _fail('Error de conexión'); });
  };

  // ── FICHA PLACA ──
  function _renderFichaPlaca() {
    var u = _unidad || {};
    var it = _unidadItem || {};
    var ubi = u.ubicacion || {};
    var html = '<div class="inv-wrap" style="padding:24px;">'
      + '<div class="inv-back" onclick="_invHome()">← Volver</div>';
    // Reserva banner
    if (_unidadReserva) {
      html += '<div style="background:rgba(255,160,0,.12);border:1px solid rgba(255,160,0,.3);border-radius:8px;padding:10px 14px;margin-bottom:14px;">'
        + '<div class="inv-label" style="color:#FFA000;">RESERVADA PARA</div>'
        + '<div style="font-size:13px;font-weight:600;color:#FFA000;">' + _esc(_unidadReserva) + '</div></div>';
    }
    html += '<div class="inv-code">' + _esc(u.codigo) + '</div>'
      + '<div class="inv-desc">' + _esc(it.descripcion || '') + '</div>'
      + '<div style="margin-top:8px;">'
      + '<span class="inv-badge inv-badge-' + _esc(it.familia || 'otro') + '">' + _esc(it.familia || 'otro') + '</span>'
      + '<span class="inv-badge" style="background:#0a2a0a;color:#3DD68C;border:1px solid #1f3a26;">' + _esc(u.estado || 'activa') + '</span>'
      + '</div>';
    if (ubi.codigo) {
      html += '<div style="margin-top:12px;"><div class="inv-label">Ubicación</div>'
        + '<div style="font-size:13px;"><span style="font-family:\'Space Mono\',monospace;font-weight:700;color:#FFD600;">' + _esc(ubi.codigo) + '</span>'
        + (ubi.nombre ? ' · ' + _esc(ubi.nombre) : '') + '</div></div>';
    }
    if (u.atributos) {
      var attrs = typeof u.atributos === 'object' ? u.atributos : {};
      var attrParts = [];
      if (attrs.espesor) attrParts.push(attrs.espesor);
      if (attrs.medida) attrParts.push(attrs.medida);
      if (attrs.material) attrParts.push(attrs.material);
      if (attrParts.length) {
        html += '<div style="margin-top:8px;font-size:12px;color:#888;">' + _esc(attrParts.join(' · ')) + '</div>';
      }
    }
    // Actions
    if (u.estado === 'activa') {
      html += '<div class="inv-actions" style="margin-top:24px;">'
        + '<button class="inv-btn inv-btn-accent inv-btn-lg" onclick="_invPlacaConsumir()">CONSUMIR EN PROYECTO</button>'
        + '<button class="inv-btn inv-btn-lg" onclick="_invPlacaTrasladar()">TRASLADAR</button>'
        + '<button class="inv-btn inv-btn-lg" onclick="_invPlacaDescartar()">DESCARTAR</button>'
        + '</div>';
      if (u.reserva_proyecto_id) {
        html += '<div style="margin-top:12px;text-align:center;">'
          + '<button class="inv-btn" style="font-size:10px;" onclick="_invPlacaLiberarReserva()">Liberar reserva</button></div>';
      }
    } else {
      html += '<div style="margin-top:24px;color:#888;font-size:12px;">Esta placa no está activa (' + _esc(u.estado) + ')</div>';
    }
    html += '<div style="margin-top:20px;">'
      + '<button class="inv-btn" style="font-size:10px;" onclick="_invPlacaImprimir()">⎙ Imprimir etiqueta</button></div>';
    html += '</div>';
    _container.innerHTML = html;
  }

  window._invPlacaConsumir = function () { _placaProyElegido = null; _placaMuebleElegido = null; _show('placa-consumo-proy'); };
  window._invPlacaTrasladar = function () { _show('placa-traslado'); };
  window._invPlacaDescartar = function () { _show('placa-descarte'); };
  window._invPlacaImprimir = function () {
    if (!window.Etiquetas) { alert('Sistema de etiquetas no disponible'); return; }
    if (!_unidad || !_unidadItem) return;
    var attrs = (typeof _unidad.atributos === 'object' && _unidad.atributos) || {};
    Etiquetas.imprimir('inv-placa', [{
      codigo: _unidad.codigo,
      descripcion: _unidadItem.descripcion || '',
      medida: attrs.medida || '',
      _qr: _unidad.codigo
    }]);
  };
  window._invPlacaLiberarReserva = function () {
    _post('setear-reserva-unidad', { codigo: _unidad.codigo, reserva_proyecto_id: null }).then(function (r) {
      if (!r.ok) { _fail(r.msg || 'Error'); return; }
      _ok('Reserva liberada ✓');
      _unidad.reserva_proyecto_id = null; _unidadReserva = null;
      _show('ficha-placa');
    }).catch(function () { _fail('Error de conexión'); });
  };

  // ── PLACA: consumo proyecto picker ──
  function _renderPlacaConsumoProy() {
    _container.innerHTML = '<div class="inv-wrap" style="padding:24px;">'
      + '<div class="inv-back" onclick="_invShow(\'ficha-placa\')">← Volver a ficha</div>'
      + '<div class="inv-label">Elegir proyecto para consumo</div>'
      + '<input id="inv-placa-proy-q" class="inv-search-input" placeholder="Buscar por número, nombre, obra, cliente..." autofocus>'
      + '<div id="inv-placa-proy-list" style="margin-top:12px;max-height:400px;overflow-y:auto;"></div></div>';
    var inp = document.getElementById('inv-placa-proy-q');
    inp.addEventListener('input', function () { _filterPlacaProys(inp.value); });
    if (!_proyectos) {
      fetch('/api/tiempos?action=proyectos-activos').then(function (r) { return r.json(); }).then(function (r) {
        _proyectos = (r.proyectos || r.data || []);
        _filterPlacaProys('');
      }).catch(function () { _fail('Error cargando proyectos'); });
    } else {
      _filterPlacaProys('');
    }
  }
  function _filterPlacaProys(q) {
    q = (q || '').toLowerCase();
    var list = (_proyectos || []).filter(function (p) {
      if (!q) return true;
      return ((p.numero || '') + ' ' + (p.nombre || '') + ' ' + (p.obra || '') + ' ' + (p.cliente || '') + ' ' + (p.cliente_nombre || '')).toLowerCase().indexOf(q) >= 0;
    }).slice(0, 30);
    var el = document.getElementById('inv-placa-proy-list');
    if (!el) return;
    el.innerHTML = list.map(function (p) {
      return '<div class="inv-list-item" onclick="_invPlacaPickProy(\'' + _esc(p.id) + '\')">'
        + '<div style="flex:1;"><div class="li-code">' + _esc(p.numero || '') + '</div><div class="li-desc">' + _esc(p.nombre || p.cliente_nombre || '') + '</div></div></div>';
    }).join('') || '<div style="color:#888;padding:12px;">Sin resultados</div>';
  }
  window._invPlacaPickProy = function (id) {
    _placaProyElegido = (_proyectos || []).find(function (p) { return p.id === id; }) || { id: id };
    _show('placa-consumo-mueble');
  };

  // ── PLACA: consumo mueble picker ──
  function _renderPlacaConsumoMueble() {
    var muebles = [];
    if (_placaProyElegido && Array.isArray(_placaProyElegido.muebles)) {
      muebles = _placaProyElegido.muebles;
    }
    var html = '<div class="inv-wrap" style="padding:24px;">'
      + '<div class="inv-back" onclick="_invShow(\'placa-consumo-proy\')">← Volver</div>'
      + '<div class="inv-label">Mueble (opcional)</div>'
      + '<div class="inv-list-item" onclick="_invPlacaPickMueble(null)"><div style="flex:1;"><div class="li-code">SIN MUEBLE</div></div></div>';
    muebles.forEach(function (m) {
      html += '<div class="inv-list-item" onclick="_invPlacaPickMueble(\'' + _esc(m.id || '') + '\')">'
        + '<div style="flex:1;"><div class="li-code">' + _esc(m.codigo || m.id) + '</div><div class="li-desc">' + _esc(m.nombre || '') + '</div></div></div>';
    });
    html += '</div>';
    _container.innerHTML = html;
  }
  window._invPlacaPickMueble = function (id) {
    _placaMuebleElegido = id;
    _doConsumoPlaca(false);
  };

  function _doConsumoPlaca(forzar) {
    var body = { codigo: _unidad.codigo, proyecto_id: _placaProyElegido.id };
    if (_placaMuebleElegido) body.mueble_id = _placaMuebleElegido;
    if (forzar) body.forzar_reserva = true;
    _post('consumir-unidad', body).then(function (r) {
      if (r.requiere_confirmacion) {
        _unidadReserva = r.reserva_nombre || 'otro proyecto';
        _show('placa-consumo-reserva');
        return;
      }
      if (!r.ok) { _fail(r.msg || 'Error'); return; }
      _ok('Placa consumida ✓');
      _show('placa-consumo-ok');
    }).catch(function () { _fail('Error de conexión'); });
  }

  // ── PLACA: aviso de reserva ──
  function _renderPlacaConsumoReserva() {
    var html = '<div class="inv-wrap" style="padding:24px;text-align:center;">'
      + '<div style="background:rgba(255,160,0,.12);border:1px solid rgba(255,160,0,.3);border-radius:8px;padding:20px;margin-bottom:20px;">'
      + '<div style="font-size:32px;margin-bottom:12px;">⚠</div>'
      + '<div class="inv-label" style="color:#FFA000;">ESTA PLACA ESTÁ RESERVADA PARA</div>'
      + '<div style="font-size:15px;font-weight:700;color:#FFA000;margin-top:6px;">' + _esc(_unidadReserva) + '</div></div>'
      + '<div class="inv-actions" style="flex-direction:column;gap:12px;">'
      + '<button class="inv-btn inv-btn-accent inv-btn-lg" style="width:100%;" onclick="_invShow(\'ficha-placa\')">CANCELAR — NO CONSUMIR</button>'
      + '<button class="inv-btn" style="width:100%;font-size:10px;opacity:.7;" onclick="_invPlacaForzarConsumo()">Consumir igual →</button>'
      + '</div></div>';
    _container.innerHTML = html;
  }
  window._invPlacaForzarConsumo = function () { _doConsumoPlaca(true); };

  // ── PLACA: consumo OK ──
  function _renderPlacaConsumoOk() {
    var proy = _placaProyElegido || {};
    var html = '<div class="inv-wrap" style="padding:24px;text-align:center;">'
      + '<div style="font-size:48px;margin-bottom:16px;">✓</div>'
      + '<div class="inv-code">' + _esc((_unidad || {}).codigo) + '</div>'
      + '<div style="margin-top:8px;font-size:13px;color:#888;">Consumida en ' + _esc(proy.numero || proy.id || '') + '</div>'
      + '<div class="inv-actions" style="margin-top:24px;flex-direction:column;gap:12px;">'
      + '<button class="inv-btn inv-btn-accent inv-btn-lg" onclick="_invHome()">VOLVER AL INICIO</button>'
      + '<button class="inv-btn" onclick="_invPlacaAltaSobrante()">+ Alta sobrante de placa</button>'
      + '</div></div>';
    _container.innerHTML = html;
  }
  window._invPlacaAltaSobrante = function () {
    _show('alta');
  };

  // ── PLACA: traslado ──
  function _renderPlacaTraslado() {
    _container.innerHTML = '<div class="inv-wrap" style="padding:24px;">'
      + '<div class="inv-back" onclick="_invShow(\'ficha-placa\')">← Volver a ficha</div>'
      + '<div class="inv-label">Escanear bin de DESTINO</div>'
      + '<input id="inv-placa-trs-scan" class="inv-home-input" placeholder="Escanear ubicación..." autofocus>'
      + '</div>';
    var inp = document.getElementById('inv-placa-trs-scan');
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var cod = (inp.value || '').trim().toUpperCase();
        if (!cod) return;
        _post('trasladar-unidad', { codigo: _unidad.codigo, ubicacion_destino_codigo: cod }).then(function (r) {
          if (!r.ok) { _fail(r.msg || 'Error'); return; }
          _ok('Trasladada a ' + cod + ' ✓');
          // Refresh ficha
          _get('resolver-codigo', { codigo: _unidad.codigo }).then(function (r2) {
            if (r2.ok && r2.tipo === 'unidad') {
              _unidad = r2.unidad; _unidadItem = r2.item; _unidadReserva = r2.reserva_nombre || null;
            }
            _show('ficha-placa');
          });
        }).catch(function () { _fail('Error de conexión'); });
      }
    });
    inp.focus();
  }

  // ── PLACA: descarte ──
  function _renderPlacaDescarte() {
    _container.innerHTML = '<div class="inv-wrap" style="padding:24px;text-align:center;">'
      + '<div style="font-size:32px;margin-bottom:12px;">🗑</div>'
      + '<div class="inv-label">¿Descartar placa ' + _esc((_unidad || {}).codigo) + '?</div>'
      + '<div style="margin-top:12px;">'
      + '<div class="inv-label">Motivo (opcional)</div>'
      + '<input id="inv-placa-desc-motivo" class="inv-search-input" placeholder="Ej: rota, defectuosa...">'
      + '</div>'
      + '<div class="inv-actions" style="margin-top:20px;">'
      + '<button class="inv-btn" onclick="_invShow(\'ficha-placa\')">Cancelar</button>'
      + '<button class="inv-btn" style="background:rgba(240,92,92,.15);color:#F05C5C;border-color:rgba(240,92,92,.3);" onclick="_invPlacaDescartarConfirm()">DESCARTAR</button>'
      + '</div></div>';
    var inp = document.getElementById('inv-placa-desc-motivo');
    if (inp) inp.focus();
  }
  window._invPlacaDescartarConfirm = function () {
    var motivo = (document.getElementById('inv-placa-desc-motivo') || {}).value || '';
    _post('descartar-unidad', { codigo: _unidad.codigo, motivo: motivo.trim() || null }).then(function (r) {
      if (!r.ok) { _fail(r.msg || 'Error'); return; }
      _ok('Placa descartada ✓');
      _invHome();
    }).catch(function () { _fail('Error de conexión'); });
  };

  // ── BUSCAR SIN ETIQUETA ──
  function _renderBuscar() {
    _container.innerHTML = '<div class="inv-wrap" style="padding:24px;">'
      + '<div class="inv-back" onclick="_invHome()">← Volver</div>'
      + '<div class="inv-label">Buscar ítem</div>'
      + '<input id="inv-buscar-q" class="inv-search-input" placeholder="Código o descripción..." autofocus>'
      + '<div id="inv-buscar-list" style="margin-top:12px;max-height:400px;overflow-y:auto;"></div></div>';
    var inp = document.getElementById('inv-buscar-q');
    var timer = null;
    inp.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { _doBuscar(inp.value); }, 300);
    });
    inp.focus();
  }
  function _doBuscar(q) {
    if (!(q || '').trim()) { var el = document.getElementById('inv-buscar-list'); if (el) el.innerHTML = ''; return; }
    _get('buscar-items-kiosco', { q: q }).then(function (r) {
      var el = document.getElementById('inv-buscar-list');
      if (!el) return;
      var items = r.items || [];
      el.innerHTML = items.map(function (it) {
        var foto = it.foto_url ? '<img class="li-foto" src="' + _esc(it.foto_url) + '">' : '';
        return '<div class="inv-list-item" onclick="_invScan(\'' + _esc(it.codigo) + '\')">'
          + foto + '<div style="flex:1;"><div class="li-code">' + _esc(it.codigo) + '</div><div class="li-desc">' + _esc(it.descripcion) + '</div></div></div>';
      }).join('') || '<div style="color:#888;padding:12px;">Sin resultados</div>';
    });
  }

  // ── ALTA RÁPIDA ──
  var _altaFoto = null;
  var _altaFamilia = '';
  function _renderAlta() {
    _altaFoto = null; _altaFamilia = '';
    _container.innerHTML = '<div class="inv-wrap" style="padding:24px;">'
      + '<div class="inv-back" onclick="_invHome()">← Volver</div>'
      + '<div class="inv-label">Alta rápida de ítem</div>'
      + '<div class="inv-section">'
      + '<div class="inv-label">Foto (opcional)</div>'
      + '<input type="file" id="inv-alta-foto" accept="image/*" capture="environment" style="color:#888;">'
      + '</div>'
      + '<div class="inv-field"><div class="inv-label">Descripción</div><input id="inv-alta-desc" placeholder="Ej: Bisagra cierre suave 35mm"></div>'
      + '<div class="inv-section"><div class="inv-label">Familia</div>'
      + '<div class="inv-alta-familia">'
      + ['herraje','consumible','placa','otro'].map(function (f) {
          return '<button class="inv-btn" data-fam="' + f + '" onclick="_invAltaFam(\'' + f + '\')">' + f.toUpperCase() + '</button>';
        }).join('')
      + '<button class="inv-btn" data-fam="madera" disabled title="Usá el flujo Madera / carga inicial">MADERA</button>'
      + '</div></div>'
      + '<div class="inv-field"><div class="inv-label">Código (autosugerido, editable)</div><input id="inv-alta-codigo" style="text-transform:uppercase;"></div>'
      + '<div class="inv-field"><div class="inv-label">Unidad</div><input id="inv-alta-unidad" placeholder="un / m / kg"></div>'
      + '<div class="inv-field"><div class="inv-label">Ubicación (escanear bin)</div><input id="inv-alta-ubi" class="inv-home-input" style="font-size:14px;padding:12px;" placeholder="Escanear bin..."></div>'
      + '<div class="inv-field"><div class="inv-label">Cantidad inicial</div><input id="inv-alta-cant" type="number" min="1" value="1"></div>'
      + '<div class="inv-actions"><button class="inv-btn inv-btn-accent inv-btn-lg" onclick="_invAltaSubmit()">CREAR ÍTEM</button></div>'
      + '</div>';
    // Foto handler
    document.getElementById('inv-alta-foto').addEventListener('change', function (e) {
      var file = e.target.files[0]; if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        var img = new Image();
        img.onload = function () {
          var canvas = document.createElement('canvas');
          var max = 800;
          var w = img.width, h = img.height;
          if (w > max || h > max) { if (w > h) { h = h * max / w; w = max; } else { w = w * max / h; h = max; } }
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          _altaFoto = canvas.toDataURL('image/jpeg', 0.7);
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
    // Auto-suggest codigo from desc
    document.getElementById('inv-alta-desc').addEventListener('input', function () {
      var desc = this.value.trim();
      if (!desc || document.getElementById('inv-alta-codigo').dataset.edited) return;
      var words = desc.split(/\s+/);
      var prefix = (words[0] || '').substring(0, 3).toUpperCase();
      var numMatch = desc.match(/\d+/);
      var num = numMatch ? numMatch[0] : '001';
      document.getElementById('inv-alta-codigo').value = prefix + '-' + num;
    });
    document.getElementById('inv-alta-codigo').addEventListener('input', function () { this.dataset.edited = '1'; });
  }

  window._invAltaFam = function (f) {
    _altaFamilia = f;
    document.querySelectorAll('.inv-alta-familia .inv-btn').forEach(function (b) {
      b.classList.toggle('selected', b.getAttribute('data-fam') === f);
    });
  };

  window._invAltaSubmit = function () {
    var desc = (document.getElementById('inv-alta-desc').value || '').trim();
    var codigo = (document.getElementById('inv-alta-codigo').value || '').trim().toUpperCase();
    var unidad = (document.getElementById('inv-alta-unidad').value || '').trim();
    var ubiCodigo = (document.getElementById('inv-alta-ubi').value || '').trim().toUpperCase();
    var cant = Number(document.getElementById('inv-alta-cant').value);
    if (!desc) { _fail('Descripción requerida'); return; }
    if (!_altaFamilia) { _fail('Elegí una familia'); return; }
    if (!codigo) { _fail('Código requerido'); return; }
    if (!ubiCodigo) { _fail('Escaneá una ubicación'); return; }
    if (!cant || cant < 1) { _fail('Cantidad debe ser >= 1'); return; }
    var body = { codigo: codigo, descripcion: desc, familia: _altaFamilia, ubicacion_codigo: ubiCodigo, cantidad: cant };
    if (unidad) body.unidad = unidad;
    if (_altaFoto) body.foto_base64 = _altaFoto;
    _post('alta-rapida', body).then(function (r) {
      if (!r.ok) { _fail(r.msg || 'Error'); return; }
      _ok('Ítem creado ✓');
      _item = r.item;
      _show('alta-ok');
    }).catch(function () { _fail('Error de conexión'); });
  };

  // ── ALTA OK ──
  function _renderAltaOk() {
    _container.innerHTML = '<div class="inv-wrap" style="padding:24px;text-align:center;">'
      + '<div style="font-size:48px;margin-bottom:16px;">✓</div>'
      + '<div class="inv-code">' + _esc(_item.codigo) + '</div>'
      + '<div class="inv-desc">' + _esc(_item.descripcion) + '</div>'
      + '<div style="margin-top:24px;">'
      + '<button class="inv-btn" onclick="_invImprimirItem()">⎙ Imprimir etiqueta</button>'
      + '</div>'
      + '<div class="inv-actions" style="margin-top:24px;">'
      + '<button class="inv-btn inv-btn-accent inv-btn-lg" onclick="_invHome()">VOLVER AL INICIO</button>'
      + '</div></div>';
  }

  // ═══ ENTRY POINT ═══
  async function _cargar(subopcion) {
    _container = document.getElementById('inventario-content');
    if (!_container) return;
    try {
      var sess = JSON.parse(sessionStorage.getItem('kiosco_session') || '{}');
      _empId = sess.empleado_id || null;
    } catch (e) { _empId = null; }
    _show('home');
  }

  window.flujo_inventario = { cargar: _cargar };
})();
