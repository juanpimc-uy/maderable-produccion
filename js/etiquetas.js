/* js/etiquetas.js — Sistema central de etiquetas MBLE
   Autocontenido, sin dependencias del monolito.
   Uso: <script src="/js/etiquetas.js"></script>
   Expone window.Etiquetas: { imprimir, preview, cargarConfig, FUNCIONES } */
(function () {
  'use strict';
  if (window.Etiquetas) return;

  // ═══════════════════════════════════════════════════════════════════════
  // SPEC DECLARATIVA DE FUNCIONES
  // ═══════════════════════════════════════════════════════════════════════
  var FUNCIONES = {
    'despacho-bulto': {
      tituloDefault: 'DESPACHO',
      qr: true, chipEnvio: true,
      qrEj: '{"pid":"proj-001","bid":412,"num":37}',
      campos: [
        { id: 'bulto',   label: 'Bulto',   ej: 'BULTO 01 - 04',            fijo: true },
        { id: 'odf',     label: 'ODF',     ej: 'ODF-4515',                 fijo: false },
        { id: 'cliente', label: 'Cliente', ej: 'ESTUDIO CINCO',            fijo: false },
        { id: 'mueble',  label: 'Mueble',  ej: 'EQ10 · VESTIDOR PRINCIPAL', fijo: false },
        { id: 'fecha',   label: 'Fecha',   ej: '01/08',                    fijo: false },
      ],
      defaults: {
        '60x30':  [{ id: 'odf', pos: 'M' }, { id: 'mueble', pos: 'M' }, { id: 'bulto', pos: 'XL' }],
        '100x50': [{ id: 'odf', pos: 'L' }, { id: 'cliente', pos: 'M' }, { id: 'mueble', pos: 'M' }, { id: 'bulto', pos: 'XL' }, { id: 'fecha', pos: 'P' }],
      }
    },
    'tercerizado-bulto': {
      tituloDefault: 'TERCERIZADO',
      qr: true, chipEnvio: false,
      qrEj: 'https://maderable.vercel.app/envio.html?id=ENV-0087',
      campos: [
        { id: 'prov',    label: 'Proveedor', ej: 'BARU',                     fijo: true },
        { id: 'envio',   label: 'Envío',     ej: 'ENV-0087',                 fijo: true },
        { id: 'cliente', label: 'Cliente',   ej: 'FONTANA INMOBILIARIA',     fijo: false },
        { id: 'obra',    label: 'Obra',      ej: 'TORRE PATRIA P12',         fijo: false },
        { id: 'mueble',  label: 'Mueble',    ej: 'PANELES TAPIZADOS DORM.',  fijo: false },
        { id: 'bulto',   label: 'Bulto',     ej: 'BULTO 2 DE 3',            fijo: false },
        { id: 'retorno', label: 'Retorno',   ej: '12/08',                    fijo: false },
        { id: 'odf',     label: 'ODF',       ej: 'ODF-4498',                 fijo: false },
        { id: 'codigo',  label: 'Código',    ej: 'T04',                      fijo: false },
      ],
      defaults: {
        '60x30':  [{ id: 'prov', pos: 'XL' }, { id: 'envio', pos: 'M' }, { id: 'cliente', pos: 'M' }, { id: 'bulto', pos: 'S' }],
        '100x50': [{ id: 'prov', pos: 'XL' }, { id: 'envio', pos: 'L' }, { id: 'cliente', pos: 'M' }, { id: 'obra', pos: 'M' }, { id: 'bulto', pos: 'M' }, { id: 'retorno', pos: 'S' }, { id: 'codigo', pos: 'P' }, { id: 'odf', pos: 'P' }],
      }
    },
    'placa': {
      tituloDefault: 'PLACAS',
      qr: true, chipEnvio: false,
      qrEj: 'PL-1834|MDF Enchapado Roble|B-12|2.60x1.83|18mm',
      campos: [
        { id: 'pos',     label: 'Posición',  ej: 'B-12',                       fijo: true },
        { id: 'sku',     label: 'SKU',       ej: 'PL-1834',                    fijo: true },
        { id: 'nombre',  label: 'Nombre',    ej: 'MDF ENCHAPADO ROBLE NATURAL', fijo: false },
        { id: 'tamano',  label: 'Tamaño',    ej: '2.60 × 1.83',               fijo: false },
        { id: 'espesor', label: 'Espesor',   ej: '18MM',                       fijo: false },
        { id: 'fecha',   label: 'Ingreso',   ej: '01/08',                      fijo: false },
      ],
      defaults: {
        '60x30':  [{ id: 'pos', pos: 'XL' }, { id: 'sku', pos: 'M' }],
        '100x50': [{ id: 'pos', pos: 'XL' }, { id: 'sku', pos: 'L' }, { id: 'nombre', pos: 'M' }, { id: 'tamano', pos: 'S' }, { id: 'espesor', pos: 'S' }, { id: 'fecha', pos: 'P' }],
      }
    },
    'armado-so': {
      tituloDefault: 'KITTING',
      qr: false, chipEnvio: false,
      qrEj: '',
      campos: [
        { id: 'mueble',  label: 'Mueble',  ej: 'BAJO MESADA COCINA 2.40M',  fijo: true },
        { id: 'cliente', label: 'Cliente', ej: 'FONTANA INMOBILIARIA',      fijo: false },
        { id: 'obra',    label: 'Obra',    ej: 'TORRE PATRIA P12',          fijo: false },
        { id: 'so',      label: 'SO',      ej: 'SO-2211',                   fijo: false },
        { id: 'fecha',   label: 'Fecha',   ej: '01/08',                     fijo: false },
      ],
      defaults: {
        '60x30':  [{ id: 'mueble', pos: 'XL' }, { id: 'cliente', pos: 'M' }],
        '100x50': [{ id: 'mueble', pos: 'XL' }, { id: 'cliente', pos: 'L' }, { id: 'obra', pos: 'M' }, { id: 'so', pos: 'P' }, { id: 'fecha', pos: 'P' }],
      }
    },
    'madera-pieza': {
      tituloDefault: 'MADERA',
      qr: true, chipEnvio: false,
      qrEj: '{"qr":"mp-0012-034"}',
      campos: [
        { id: 'pieza',   label: 'Pieza',     ej: 'PIEZA 034',        fijo: true },
        { id: 'partida', label: 'Partida',   ej: 'PARTIDA 0012',     fijo: true },
        { id: 'especie', label: 'Especie',   ej: 'CEDRO',            fijo: false },
        { id: 'espesor', label: 'Espesor',   ej: '1"',               fijo: false },
        { id: 'medidas', label: 'Medidas',   ej: '22 × 310 CM',      fijo: false },
        { id: 'pies',    label: 'Pies',      ej: '12.4 P²',          fijo: false },
        { id: 'ubic',    label: 'Ubicación', ej: 'RACK M-3',         fijo: false },
        { id: 'prov',    label: 'Proveedor', ej: 'ASERRADERO SUR',   fijo: false },
        { id: 'fecha',   label: 'Romaneo',   ej: '01/08',            fijo: false },
      ],
      defaults: {
        '60x30':  [{ id: 'pieza', pos: 'XL' }, { id: 'partida', pos: 'M' }, { id: 'especie', pos: 'M' }, { id: 'medidas', pos: 'S' }],
        '100x50': [{ id: 'pieza', pos: 'XL' }, { id: 'especie', pos: 'L' }, { id: 'partida', pos: 'M' }, { id: 'espesor', pos: 'M' }, { id: 'medidas', pos: 'M' }, { id: 'ubic', pos: 'M' }, { id: 'pies', pos: 'P' }, { id: 'fecha', pos: 'P' }],
      }
    }
  };

  // ═══════════════════════════════════════════════════════════════════════
  // CONFIG CACHE
  // ═══════════════════════════════════════════════════════════════════════
  var _configCache = null;
  var _configTs = 0;
  var CONFIG_TTL = 5 * 60 * 1000; // 5 min

  function cargarConfig() {
    if (_configCache && Date.now() - _configTs < CONFIG_TTL) {
      return Promise.resolve(_configCache);
    }
    return fetch('/api/etiquetas?action=config')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.ok) {
          _configCache = {};
          (j.config || []).forEach(function (row) { _configCache[row.funcion] = row; });
          _configTs = Date.now();
        }
        return _configCache || {};
      })
      .catch(function () { return _configCache || {}; });
  }

  // Merge: config guardada pisa defaults
  function resolverCampos(funcion, tamano, cfgOverride) {
    var spec = FUNCIONES[funcion];
    if (!spec) return [];
    var fmt = tamano || '60x30';

    // Si hay override directo (desde configurador), usarlo
    if (cfgOverride && cfgOverride[fmt]) return cfgOverride[fmt];

    // Si hay config del servidor
    if (_configCache && _configCache[funcion]) {
      var row = _configCache[funcion];
      var saved = row.campos || {};
      if (saved[fmt]) return saved[fmt];
    }

    // Defaults
    return spec.defaults[fmt] || [];
  }

  function resolverTitulo(funcion, cfgTitulo) {
    var spec = FUNCIONES[funcion];
    if (!spec) return '';
    if (cfgTitulo !== undefined && cfgTitulo !== null) return cfgTitulo;
    if (_configCache && _configCache[funcion] && _configCache[funcion].titulo != null)
      return _configCache[funcion].titulo;
    return spec.tituloDefault;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MEDIDAS POR FORMATO
  // ═══════════════════════════════════════════════════════════════════════
  var MEDIDAS = {
    '60x30': {
      pageW: '60mm', pageH: '30mm',
      bandaH: '4.8mm', bandaPad: '0 2mm', tituloSize: '7.5pt', marcaSize: '4.5pt',
      chipSize: '6pt', chipPad: '.4mm 1.2mm',
      bodyPad: '1.2mm 2mm', bodyGap: '2mm',
      qrSize: '19mm',
      microLabel: '4pt',
      XL: '14pt', L: '10pt', M: '7.5pt', S: '5pt',
      XLw: 800, Lw: 800, Mw: 700, Sw: 600,
      pie: false,
    },
    '100x50': {
      pageW: '100mm', pageH: '50mm',
      bandaH: '7.5mm', bandaPad: '0 4mm', tituloSize: '12.5pt', marcaSize: '7pt',
      chipSize: '10pt', chipPad: '.8mm 2mm',
      bodyPad: '2mm 4mm', bodyGap: '3.5mm',
      qrSize: '26mm',
      microLabel: '6.5pt',
      XL: '26pt', L: '16pt', M: '11.5pt', S: '8pt',
      XLw: 800, Lw: 800, Mw: 700, Sw: 600,
      pie: true, piePad: '1mm 4mm', pieSize: '7pt', Pw: 600,
    }
  };

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER DE UNA ETIQUETA (DOM)
  // ═══════════════════════════════════════════════════════════════════════
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function interpolarTitulo(titulo, datos) {
    return titulo.replace(/\{(\w+)\}/g, function (m, id) {
      return datos[id] != null ? String(datos[id]).toUpperCase() : m;
    });
  }

  function preview(funcion, tamano, cfgOverride, datos) {
    var spec = FUNCIONES[funcion];
    if (!spec) return document.createElement('div');
    var fmt = tamano || '60x30';
    var med = MEDIDAS[fmt];
    var camposCfg = resolverCampos(funcion, fmt, cfgOverride);
    var tituloRaw = resolverTitulo(funcion, cfgOverride ? cfgOverride._titulo : undefined);
    var titulo = interpolarTitulo(tituloRaw, datos || {});

    // Separar cuerpo y pie
    var cuerpoCampos = [];
    var pieCampos = [];
    camposCfg.forEach(function (c) {
      if (c.pos === 'P' && med.pie) pieCampos.push(c);
      else cuerpoCampos.push(c);
    });

    // Buscar datos de ejemplo si no hay datos
    var d = datos || {};
    spec.campos.forEach(function (sc) { if (d[sc.id] == null) d[sc.id] = sc.ej; });

    // Contenedor
    var et = document.createElement('div');
    et.style.cssText = 'width:' + med.pageW + ';height:' + med.pageH + ';background:#fff;color:#000;font-family:Montserrat,sans-serif;display:flex;flex-direction:column;overflow:hidden;border:0.5px solid #ccc;';

    // ── BANDA ──
    var banda = document.createElement('div');
    banda.style.cssText = 'height:' + med.bandaH + ';background:#000;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:' + med.bandaPad + ';flex-shrink:0;';
    var tit = document.createElement('span');
    tit.style.cssText = 'font-size:' + med.tituloSize + ';font-weight:800;letter-spacing:2px;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    tit.textContent = titulo;
    banda.appendChild(tit);

    // Chip envío
    if (spec.chipEnvio && d.envio_total && parseInt(d.envio_total) > 1) {
      var chip = document.createElement('span');
      chip.style.cssText = 'background:#fff;color:#000;font-size:' + med.chipSize + ';font-weight:800;padding:' + med.chipPad + ';border-radius:1mm;white-space:nowrap;flex-shrink:0;margin-left:1mm;';
      chip.textContent = (d.envio_num || '?') + '/' + d.envio_total;
      banda.appendChild(chip);
    }

    var marca = document.createElement('span');
    marca.style.cssText = 'font-size:' + med.marcaSize + ';font-weight:600;opacity:.55;letter-spacing:1px;white-space:nowrap;flex-shrink:0;margin-left:1mm;';
    marca.textContent = 'MADERABLE';
    banda.appendChild(marca);
    et.appendChild(banda);

    // ── CUERPO ──
    var body = document.createElement('div');
    body.style.cssText = 'flex:1;display:flex;padding:' + med.bodyPad + ';gap:' + med.bodyGap + ';overflow:hidden;align-items:center;';

    // QR (izquierda)
    if (spec.qr) {
      var qrWrap = document.createElement('div');
      qrWrap.style.cssText = 'width:' + med.qrSize + ';height:' + med.qrSize + ';flex-shrink:0;background:#eee;display:flex;align-items:center;justify-content:center;';
      qrWrap.setAttribute('data-qr', d._qr || spec.qrEj || '');
      var qrPlaceholder = document.createElement('span');
      qrPlaceholder.style.cssText = 'font-size:6pt;color:#999;';
      qrPlaceholder.textContent = 'QR';
      qrWrap.appendChild(qrPlaceholder);
      body.appendChild(qrWrap);
    }

    // Columna de campos
    var col = document.createElement('div');
    col.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:0.5mm;justify-content:center;';

    cuerpoCampos.forEach(function (c) {
      var specCampo = spec.campos.find(function (sc) { return sc.id === c.id; });
      if (!specCampo) return;
      var val = d[c.id] != null ? String(d[c.id]).toUpperCase() : '';
      var label = specCampo.label;
      var wrap = document.createElement('div');

      if (c.pos === 'XL' || c.pos === 'L') {
        wrap.style.cssText = 'font-size:' + med[c.pos] + ';font-weight:' + med[c.pos + 'w'] + ';text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.1;';
        wrap.textContent = val;
      } else if (c.pos === 'M') {
        var micro = document.createElement('div');
        micro.style.cssText = 'font-size:' + med.microLabel + ';font-weight:600;color:#666;text-transform:uppercase;line-height:1;';
        micro.textContent = label;
        wrap.appendChild(micro);
        var valEl = document.createElement('div');
        valEl.style.cssText = 'font-size:' + med.M + ';font-weight:' + med.Mw + ';text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2;';
        valEl.textContent = val;
        wrap.appendChild(valEl);
      } else if (c.pos === 'S') {
        wrap.style.cssText = 'font-size:' + med.S + ';font-weight:' + med.Sw + ';text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2;';
        var lblSpan = document.createElement('span');
        lblSpan.style.cssText = 'color:#666;';
        lblSpan.textContent = label + ': ';
        wrap.appendChild(lblSpan);
        wrap.appendChild(document.createTextNode(val));
      }
      col.appendChild(wrap);
    });

    body.appendChild(col);
    et.appendChild(body);

    // ── PIE (solo 100×50) ──
    if (med.pie && pieCampos.length > 0) {
      var pie = document.createElement('div');
      pie.style.cssText = 'border-top:.2mm solid #ccc;padding:' + med.piePad + ';display:flex;justify-content:space-between;opacity:.55;flex-shrink:0;';

      pieCampos.forEach(function (c) {
        var specCampo = spec.campos.find(function (sc) { return sc.id === c.id; });
        if (!specCampo) return;
        var val = d[c.id] != null ? String(d[c.id]).toUpperCase() : '';
        var span = document.createElement('span');
        span.style.cssText = 'font-size:' + med.pieSize + ';font-weight:' + (med.Pw || 600) + ';text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        var lblSpan = document.createElement('span');
        lblSpan.style.cssText = 'color:#666;';
        lblSpan.textContent = specCampo.label + ': ';
        span.appendChild(lblSpan);
        span.appendChild(document.createTextNode(val));
        pie.appendChild(span);
      });
      et.appendChild(pie);
    }

    return et;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // IMPRESIÓN
  // ═══════════════════════════════════════════════════════════════════════
  function imprimir(funcion, items, opts) {
    opts = opts || {};
    var spec = FUNCIONES[funcion];
    if (!spec) { console.error('[Etiquetas] Función desconocida:', funcion); return; }

    // cargarConfig → luego imprimir
    cargarConfig().then(function () {
      _doImprimir(funcion, items, opts);
    }).catch(function () {
      _doImprimir(funcion, items, opts);
    });
  }

  function _doImprimir(funcion, items, opts) {
    var spec = FUNCIONES[funcion];
    var cfgOverride = opts.config || null;
    var fmt = opts.tamano || (cfgOverride && cfgOverride._tamano) || '60x30';
    if (_configCache && _configCache[funcion] && !opts.tamano && !(cfgOverride && cfgOverride._tamano))
      fmt = _configCache[funcion].tamano || fmt;
    var med = MEDIDAS[fmt];
    var camposCfg = resolverCampos(funcion, fmt, cfgOverride);
    var tituloRaw = resolverTitulo(funcion, cfgOverride ? cfgOverride._titulo : undefined);

    // Generar HTML de cada etiqueta
    var pages = '';
    (items || []).forEach(function (item, idx) {
      var d = {};
      spec.campos.forEach(function (sc) { d[sc.id] = item[sc.id] != null ? item[sc.id] : sc.ej; });
      d._qr = item._qr || spec.qrEj || '';
      d.envio_num = item.envio_num;
      d.envio_total = item.envio_total;

      var titulo = interpolarTitulo(tituloRaw, d);

      var cuerpoCampos = [];
      var pieCampos = [];
      camposCfg.forEach(function (c) {
        if (c.pos === 'P' && med.pie) pieCampos.push(c);
        else cuerpoCampos.push(c);
      });

      if (idx > 0) pages += '<div style="page-break-before:always;"></div>';

      // Banda
      pages += '<div class="etiqueta">';
      pages += '<div class="banda">';
      pages += '<span class="banda-titulo">' + esc(titulo) + '</span>';
      if (spec.chipEnvio && d.envio_total && parseInt(d.envio_total) > 1) {
        pages += '<span class="chip-envio">' + esc((d.envio_num || '?') + '/' + d.envio_total) + '</span>';
      }
      pages += '<span class="banda-marca">MADERABLE</span>';
      pages += '</div>';

      // Cuerpo
      pages += '<div class="cuerpo">';
      if (spec.qr) {
        pages += '<div class="qr-wrap" id="qr-' + idx + '" data-qr="' + esc(d._qr) + '"></div>';
      }
      pages += '<div class="campos-col">';
      cuerpoCampos.forEach(function (c) {
        var specCampo = spec.campos.find(function (sc) { return sc.id === c.id; });
        if (!specCampo) return;
        var val = d[c.id] != null ? String(d[c.id]).toUpperCase() : '';
        if (c.pos === 'XL' || c.pos === 'L') {
          pages += '<div class="campo campo-' + c.pos + '">' + esc(val) + '</div>';
        } else if (c.pos === 'M') {
          pages += '<div class="campo campo-M"><div class="micro-label">' + esc(specCampo.label) + '</div><div class="campo-val">' + esc(val) + '</div></div>';
        } else if (c.pos === 'S') {
          pages += '<div class="campo campo-S"><span class="label-inline">' + esc(specCampo.label) + ': </span>' + esc(val) + '</div>';
        }
      });
      pages += '</div></div>';

      // Pie
      if (med.pie && pieCampos.length > 0) {
        pages += '<div class="pie">';
        pieCampos.forEach(function (c) {
          var specCampo = spec.campos.find(function (sc) { return sc.id === c.id; });
          if (!specCampo) return;
          var val = d[c.id] != null ? String(d[c.id]).toUpperCase() : '';
          pages += '<span class="campo-P"><span class="label-inline">' + esc(specCampo.label) + ': </span>' + esc(val) + '</span>';
        });
        pages += '</div>';
      }
      pages += '</div>';
    });

    // QR script
    var qrScript = '';
    if (spec.qr) {
      qrScript = 'var qrs=document.querySelectorAll(".qr-wrap");'
        + 'for(var i=0;i<qrs.length;i++){var el=qrs[i];var t=el.getAttribute("data-qr");'
        + 'if(t){try{new QRCode(el,{text:t,width:128,height:128,correctLevel:QRCode.CorrectLevel.M});}catch(e){}}}'
        + 'setTimeout(function(){var cs=document.querySelectorAll(".qr-wrap canvas");'
        + 'for(var i=0;i<cs.length;i++){var c=cs[i];var img=document.createElement("img");'
        + 'img.src=c.toDataURL("image/png");img.style.cssText="width:100%;height:100%;";'
        + 'c.parentNode.replaceChild(img,c);}},200);';
    }

    var noQr = !spec.qr;
    var css = '@page{size:' + med.pageW + ' ' + med.pageH + ';margin:0}'
      + '*{margin:0;padding:0;box-sizing:border-box}'
      + 'html,body{background:#fff;color:#000;print-color-adjust:exact;-webkit-print-color-adjust:exact;}'
      + '.etiqueta{width:' + med.pageW + ';height:' + med.pageH + ';display:flex;flex-direction:column;overflow:hidden;font-family:Montserrat,sans-serif;}'
      + '.banda{height:' + med.bandaH + ';background:#000;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:' + med.bandaPad + ';flex-shrink:0;}'
      + '.banda-titulo{font-size:' + med.tituloSize + ';font-weight:800;letter-spacing:2px;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
      + '.banda-marca{font-size:' + med.marcaSize + ';font-weight:600;opacity:.55;letter-spacing:1px;white-space:nowrap;flex-shrink:0;margin-left:1mm;}'
      + '.chip-envio{background:#fff;color:#000;font-size:' + med.chipSize + ';font-weight:800;padding:' + med.chipPad + ';border-radius:1mm;white-space:nowrap;flex-shrink:0;margin-left:1mm;}'
      + '.cuerpo{flex:1;display:flex;padding:' + med.bodyPad + ';gap:' + med.bodyGap + ';overflow:hidden;align-items:center;}'
      + '.qr-wrap{width:' + med.qrSize + ';height:' + med.qrSize + ';flex-shrink:0;}'
      + '.qr-wrap canvas,.qr-wrap img{width:' + med.qrSize + '!important;height:' + med.qrSize + '!important;}'
      + '.campos-col{flex:1;min-width:0;display:flex;flex-direction:column;gap:0.5mm;justify-content:center;' + (noQr ? 'width:100%;' : '') + '}'
      + '.campo{text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2;}'
      + '.campo-XL{font-size:' + med.XL + ';font-weight:' + med.XLw + ';line-height:1.1;}'
      + '.campo-L{font-size:' + med.L + ';font-weight:' + med.Lw + ';line-height:1.1;}'
      + '.campo-M .micro-label{font-size:' + med.microLabel + ';font-weight:600;color:#666;text-transform:uppercase;line-height:1;}'
      + '.campo-M .campo-val{font-size:' + med.M + ';font-weight:' + med.Mw + ';text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
      + '.campo-S{font-size:' + med.S + ';font-weight:' + med.Sw + ';}'
      + '.label-inline{color:#666;}'
      + (med.pie
        ? '.pie{border-top:.2mm solid #ccc;padding:' + med.piePad + ';display:flex;justify-content:space-between;opacity:.55;flex-shrink:0;}'
        + '.campo-P{font-size:' + med.pieSize + ';font-weight:' + (med.Pw || 600) + ';text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
        : '');

    var win = window.open('', '_blank', 'width=500,height=400');
    if (!win) { alert('El navegador bloqueó la ventana de impresión. Habilitá pop-ups.'); return; }
    win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8">'
      + '<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&display=swap" rel="stylesheet">'
      + (spec.qr ? '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>' : '')
      + '<style>' + css + '</style>'
      + '</head><body>' + pages
      + '<script>'
      + qrScript
      + 'var _printed=false;function doPrint(){if(_printed)return;_printed=true;window.print();}'
      + 'document.fonts.ready.then(function(){setTimeout(doPrint,200);}).catch(function(){setTimeout(doPrint,200);});'
      + 'setTimeout(doPrint,1500);'
      + '<\/script></body></html>');
    win.document.close();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // API PÚBLICA
  // ═══════════════════════════════════════════════════════════════════════
  window.Etiquetas = {
    imprimir: imprimir,
    preview: preview,
    cargarConfig: cargarConfig,
    FUNCIONES: FUNCIONES
  };
})();
