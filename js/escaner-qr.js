// js/escaner-qr.js — Componente de escaneo QR autocontenido.
// Expone: abrirEscaner(opts), cerrarEscaner(), escanerPausar(), escanerReanudar()
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
      + '.esc-cancelar{font-family:"Space Mono",monospace;font-size:11px;font-weight:700;color:#888;background:transparent;border:1px solid #444;border-radius:8px;padding:14px 28px;cursor:pointer;min-height:56px;margin-top:8px;letter-spacing:1px;text-transform:uppercase;}'
      + '.esc-diag{font-family:"Space Mono",monospace;font-size:9px;color:#555;text-align:center;}'
      + '.esc-embed{position:relative;overflow:hidden;border-radius:12px;}'
      + '.esc-embed video{width:100%;display:block;object-fit:cover;}'
      + '.esc-embed-manual{display:flex;gap:8px;align-items:center;margin-top:8px;}'
      + '.esc-embed-manual input{font-family:"Space Mono",monospace;font-size:14px;background:#252525;border:1px solid #2a2a2a;border-radius:8px;padding:10px 14px;color:#e8e8e8;flex:1;text-align:center;text-transform:uppercase;}'
      + '.esc-embed-manual button{font-family:"Space Mono",monospace;font-size:12px;font-weight:700;background:#FFD600;color:#0f0f0f;border:none;border-radius:8px;padding:10px 18px;cursor:pointer;}';
    document.head.appendChild(s);
  }

  var _overlay = null;
  var _contenedor = null; // elemento DOM del modo embebido
  var _stream = null;
  var _raf = null;
  var _onCodigo = null;
  var _onCancelar = null;
  var _onError = null;
  var _ultimoCod = '';
  var _ultimoTs = 0;
  var _scanCount = 0;
  var _continuo = false;
  var _pausado = false;

  function _pararStream() {
    if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
    if (_stream) { _stream.getTracks().forEach(function (t) { t.stop(); }); _stream = null; }
  }

  function _cerrar(invocaCancelar) {
    _pararStream();
    _pausado = false;
    _continuo = false;
    document.removeEventListener('keydown', _escHandler);
    if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
    _overlay = null;
    if (_contenedor) { _contenedor.innerHTML = ''; _contenedor = null; }
    if (invocaCancelar && typeof _onCancelar === 'function') _onCancelar();
    _onCodigo = null;
    _onCancelar = null;
    _onError = null;
  }

  function _entregar(codigo) {
    var cod = (codigo || '').trim();
    if (!cod) return;
    if (_pausado) return;
    // Antirrebote
    var ahora = Date.now();
    if (cod === _ultimoCod && ahora - _ultimoTs < 1500) return;
    _ultimoCod = cod;
    _ultimoTs = ahora;
    var cb = _onCodigo;
    if (_continuo) {
      // No cerrar: invocar y seguir escaneando
      if (typeof cb === 'function') cb(cod);
    } else {
      // Modo original: cerrar y después invocar
      _cerrar(false);
      if (typeof cb === 'function') cb(cod);
    }
  }

  function _iniciarCamara(video, canvas, visor, inp) {
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      if (visor) visor.style.display = 'none';
      if (inp) inp.focus();
      if (typeof _onError === 'function') _onError('sin-camara');
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: {
      facingMode: 'environment',
      width:  { ideal: 1280 },
      height: { ideal: 720 }
    } })
      .then(function (stream) {
        _stream = stream;
        video.srcObject = stream;
        video.play();
        _loopQR(video, canvas);
      })
      .catch(function () {
        // Reintento con constraint simple (tablets que rechazan ideal)
        return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
          .then(function (stream) {
            _stream = stream;
            video.srcObject = stream;
            video.play();
            _loopQR(video, canvas);
          });
      })
      .catch(function () {
        // Sin cámara: ocultar visor, enfocar input
        if (visor) visor.style.display = 'none';
        if (inp) inp.focus();
        if (typeof _onError === 'function') _onError('sin-permiso');
      });
  }

  window.abrirEscaner = function (opts) {
    opts = opts || {};
    _onCodigo = opts.onCodigo;
    _onCancelar = opts.onCancelar;
    _onError = opts.onError || null;
    _continuo = !!opts.continuo;
    _pausado = false;

    if (_overlay || _contenedor) _cerrar(false);

    _scanCount = 0;

    // Canvas oculto para jsQR
    var canvas = document.createElement('canvas');
    canvas.style.display = 'none';

    if (opts.contenedor) {
      // ── Modo embebido ──
      _contenedor = opts.contenedor;
      _contenedor.innerHTML = '';
      var visor = document.createElement('div');
      visor.className = 'esc-embed';
      var video = document.createElement('video');
      video.autoplay = true; video.playsInline = true; video.muted = true;
      visor.appendChild(video);
      visor.appendChild(canvas);
      _contenedor.appendChild(visor);

      // Input manual debajo del video
      var manualDiv = document.createElement('div');
      manualDiv.className = 'esc-embed-manual';
      var inp = document.createElement('input');
      inp.placeholder = 'o escribí el código';
      var okBtn = document.createElement('button');
      okBtn.textContent = 'OK';
      okBtn.addEventListener('click', function () { _entregar(inp.value); if (_continuo) inp.value = ''; });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { _entregar(inp.value); if (_continuo) inp.value = ''; } });
      manualDiv.appendChild(inp);
      manualDiv.appendChild(okBtn);
      _contenedor.appendChild(manualDiv);

      _iniciarCamara(video, canvas, visor, inp);
    } else {
      // ── Modo overlay (original) ──
      _overlay = document.createElement('div');
      _overlay.className = 'esc-overlay';
      _overlay.innerHTML = ''
        + '<div class="esc-titulo">' + (opts.titulo || 'Escanear') + '</div>'
        + '<div class="esc-visor" id="esc-visor"><video id="esc-video" autoplay playsinline muted></video><div class="esc-corners"></div></div>'
        + '<div class="esc-diag" id="esc-diag">buscando\u2026 0</div>'
        + (opts.hint ? '<div class="esc-hint">' + opts.hint + '</div>' : '')
        + '<div class="esc-manual"><input id="esc-input" placeholder="o escribí el código"><button id="esc-ok">OK</button></div>'
        + '<button class="esc-cancelar" id="esc-cancel">CANCELAR</button>';
      document.body.appendChild(_overlay);
      _overlay.appendChild(canvas);

      var inp2 = document.getElementById('esc-input');
      document.getElementById('esc-ok').addEventListener('click', function () { _entregar(inp2.value); if (_continuo) inp2.value = ''; });
      inp2.addEventListener('keydown', function (e) { if (e.key === 'Enter') { _entregar(inp2.value); if (_continuo) inp2.value = ''; } });
      document.getElementById('esc-cancel').addEventListener('click', function () { _cerrar(true); });
      document.addEventListener('keydown', _escHandler);

      var visor2 = document.getElementById('esc-visor');
      var video2 = document.getElementById('esc-video');
      _iniciarCamara(video2, canvas, visor2, inp2);
    }
  };

  function _escHandler(e) {
    if (e.key === 'Escape' && _overlay) { _cerrar(true); }
  }

  function _loopQR(video, canvas) {
    if (!_overlay && !_contenedor) return;
    if (!window.jsQR) {
      var diag = document.getElementById('esc-diag');
      if (diag) { diag.textContent = 'lector QR no disponible'; diag.style.color = '#ef4444'; }
      return;
    }
    if (video.readyState >= 2) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var code = jsQR(imgData.data, imgData.width, imgData.height);
      _scanCount++;
      if (_scanCount % 10 === 0) {
        var d2 = document.getElementById('esc-diag');
        if (d2) d2.textContent = 'buscando\u2026 ' + _scanCount;
      }
      if (code && code.data) {
        _entregar(code.data);
        if (!_continuo) return; // modo original: el loop para después de entregar
      }
    }
    _raf = requestAnimationFrame(function () { _loopQR(video, canvas); });
  }

  window.cerrarEscaner = function () { _cerrar(true); };
  window.escanerPausar = function () { _pausado = true; };
  window.escanerReanudar = function () { _pausado = false; };
})();
