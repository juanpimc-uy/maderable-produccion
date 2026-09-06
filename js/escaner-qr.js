// js/escaner-qr.js — Componente de escaneo QR autocontenido.
// Expone: abrirEscaner({ titulo, hint, onCodigo, onCancelar }), cerrarEscaner()
(function () {
  // CSS
  if (!document.getElementById('esc-css')) {
    var s = document.createElement('style'); s.id = 'esc-css';
    s.textContent = ''
      + '.esc-overlay{position:fixed;inset:0;z-index:9990;background:rgba(0,0,0,.94);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;}'
      + '.esc-titulo{font-family:"Space Mono",monospace;font-size:13px;font-weight:700;color:#FFD600;letter-spacing:2px;text-transform:uppercase;}'
      + '.esc-visor{position:relative;width:280px;height:280px;overflow:hidden;border-radius:12px;}'
      + '.esc-visor video{width:100%;height:100%;object-fit:cover;}'
      + '.esc-corners{position:absolute;inset:0;pointer-events:none;}'
      + '.esc-corners::before,.esc-corners::after{content:"";position:absolute;width:40px;height:40px;border:3px solid #FFD600;}'
      + '.esc-corners::before{top:0;left:0;border-right:none;border-bottom:none;border-radius:6px 0 0 0;}'
      + '.esc-corners::after{bottom:0;right:0;border-left:none;border-top:none;border-radius:0 0 6px 0;}'
      + '.esc-hint{font-family:"Space Mono",monospace;font-size:10px;color:#888;text-align:center;max-width:300px;}'
      + '.esc-manual{display:flex;gap:8px;align-items:center;margin-top:8px;}'
      + '.esc-manual input{font-family:"Space Mono",monospace;font-size:14px;background:#252525;border:1px solid #2a2a2a;border-radius:8px;padding:10px 14px;color:#e8e8e8;width:200px;text-align:center;text-transform:uppercase;}'
      + '.esc-manual button{font-family:"Space Mono",monospace;font-size:12px;font-weight:700;background:#FFD600;color:#0f0f0f;border:none;border-radius:8px;padding:10px 18px;cursor:pointer;}'
      + '.esc-cancelar{font-family:"Space Mono",monospace;font-size:11px;font-weight:700;color:#888;background:transparent;border:1px solid #444;border-radius:8px;padding:14px 28px;cursor:pointer;min-height:56px;margin-top:8px;letter-spacing:1px;text-transform:uppercase;}';
    document.head.appendChild(s);
  }

  var _overlay = null;
  var _stream = null;
  var _raf = null;
  var _onCodigo = null;
  var _onCancelar = null;
  var _ultimoCod = '';
  var _ultimoTs = 0;

  function _pararStream() {
    if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
    if (_stream) { _stream.getTracks().forEach(function (t) { t.stop(); }); _stream = null; }
  }

  function _cerrar(invocaCancelar) {
    _pararStream();
    document.removeEventListener('keydown', _escHandler);
    if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
    _overlay = null;
    if (invocaCancelar && typeof _onCancelar === 'function') _onCancelar();
    _onCodigo = null;
    _onCancelar = null;
  }

  function _entregar(codigo) {
    var cod = (codigo || '').trim();
    if (!cod) return;
    // Antirrebote
    var ahora = Date.now();
    if (cod === _ultimoCod && ahora - _ultimoTs < 1500) return;
    _ultimoCod = cod;
    _ultimoTs = ahora;
    var cb = _onCodigo;
    _cerrar(false);
    if (typeof cb === 'function') cb(cod);
  }

  window.abrirEscaner = function (opts) {
    opts = opts || {};
    _onCodigo = opts.onCodigo;
    _onCancelar = opts.onCancelar;

    if (_overlay) _cerrar(false);

    _overlay = document.createElement('div');
    _overlay.className = 'esc-overlay';
    _overlay.innerHTML = ''
      + '<div class="esc-titulo">' + (opts.titulo || 'Escanear') + '</div>'
      + '<div class="esc-visor" id="esc-visor"><video id="esc-video" autoplay playsinline muted></video><div class="esc-corners"></div></div>'
      + (opts.hint ? '<div class="esc-hint">' + opts.hint + '</div>' : '')
      + '<div class="esc-manual"><input id="esc-input" placeholder="o escribí el código"><button id="esc-ok">OK</button></div>'
      + '<button class="esc-cancelar" id="esc-cancel">CANCELAR</button>';
    document.body.appendChild(_overlay);

    // Canvas oculto para jsQR
    var canvas = document.createElement('canvas');
    canvas.id = 'esc-canvas';
    canvas.style.display = 'none';
    _overlay.appendChild(canvas);

    // Eventos
    var inp = document.getElementById('esc-input');
    document.getElementById('esc-ok').addEventListener('click', function () { _entregar(inp.value); });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') _entregar(inp.value); });
    document.getElementById('esc-cancel').addEventListener('click', function () { _cerrar(true); });
    document.addEventListener('keydown', _escHandler);

    // Cámara
    var visor = document.getElementById('esc-visor');
    var video = document.getElementById('esc-video');
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(function (stream) {
          _stream = stream;
          video.srcObject = stream;
          video.play();
          _loopQR(video, canvas);
        })
        .catch(function () {
          // Sin cámara: ocultar visor, enfocar input
          visor.style.display = 'none';
          inp.focus();
        });
    } else {
      visor.style.display = 'none';
      inp.focus();
    }
  };

  function _escHandler(e) {
    if (e.key === 'Escape' && _overlay) { _cerrar(true); }
  }

  function _loopQR(video, canvas) {
    if (!_overlay) return;
    if (video.readyState >= video.HAVE_ENOUGH_DATA && window.jsQR) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var code = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: 'dontInvert' });
      if (code && code.data) {
        _entregar(code.data);
        return;
      }
    }
    _raf = requestAnimationFrame(function () { _loopQR(video, canvas); });
  }

  window.cerrarEscaner = function () { _cerrar(true); };
})();
