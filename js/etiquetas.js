/* js/etiquetas.js v2 (raster) — Sistema central de etiquetas MBLE
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
      qrEj: 'https://maderable-produccion.vercel.app/envio.html?id=ENV-0087',
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
    'inv-item': {
      tituloDefault: 'ITEM',
      qr: true, chipEnvio: false,
      qrEj: 'BIS-35',
      campos: [
        { id: 'codigo',      label: 'Código',      ej: 'BIS-35',                    fijo: true },
        { id: 'descripcion', label: 'Descripción', ej: 'Bisagra codo 35mm Blum',    fijo: false },
        { id: 'familia',     label: 'Familia',     ej: 'HERRAJE',                   fijo: false },
      ],
      defaults: {
        '60x30':  [{ id: 'codigo', pos: 'XL' }, { id: 'descripcion', pos: 'M' }],
        '100x50': [{ id: 'codigo', pos: 'XL' }, { id: 'descripcion', pos: 'L' }, { id: 'familia', pos: 'M' }],
      }
    },
    'inv-placa': {
      tituloDefault: 'PLACA',
      qr: true, chipEnvio: false,
      qrEj: 'PL-000481',
      campos: [
        { id: 'codigo',      label: 'Código',      ej: 'PL-000481',              fijo: true },
        { id: 'descripcion', label: 'Descripción', ej: 'MDF 18mm Blanco',        fijo: false },
        { id: 'espesor',     label: 'Espesor',     ej: '18mm',                   fijo: false },
        { id: 'medida',      label: 'Medida',      ej: '260x183',                fijo: false },
      ],
      defaults: {
        '60x30':  [{ id: 'codigo', pos: 'XL' }, { id: 'descripcion', pos: 'M' }, { id: 'espesor', pos: 'S' }, { id: 'medida', pos: 'S' }],
        '100x50': [{ id: 'codigo', pos: 'XL' }, { id: 'descripcion', pos: 'L' }, { id: 'espesor', pos: 'M' }, { id: 'medida', pos: 'M' }],
      }
    },
    'inv-bin': {
      tituloDefault: 'UBICACIÓN',
      qr: true, chipEnvio: false,
      qrEj: 'GAL1-R03-E2',
      campos: [
        { id: 'codigo',  label: 'Código',    ej: 'GAL1-R03-E2',       fijo: true },
        { id: 'nombre',  label: 'Nombre',    ej: 'RACK 3 · ESTANTE 2', fijo: false },
        { id: 'padre',   label: 'Sector',    ej: 'GALPÓN 1',          fijo: false },
      ],
      defaults: {
        '60x30':  [{ id: 'codigo', pos: 'XL' }, { id: 'nombre', pos: 'M' }, { id: 'padre', pos: 'S' }],
        '100x50': [{ id: 'codigo', pos: 'XL' }, { id: 'nombre', pos: 'L' }, { id: 'padre', pos: 'M' }],
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
  var _configPromise = null; // promesa en vuelo para dedup
  var _configFailed = false;
  var CONFIG_TTL = 5 * 60 * 1000; // 5 min

  function cargarConfig() {
    if (_configCache && Date.now() - _configTs < CONFIG_TTL) {
      return Promise.resolve(_configCache);
    }
    // Si ya hay un fetch en vuelo, reusar esa promesa
    if (_configPromise) return _configPromise;
    _configPromise = fetch('/api/etiquetas?action=config')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        _configPromise = null;
        _configFailed = false;
        console.log('[Etiquetas] API response raw:', JSON.stringify(j).substring(0, 500));
        if (j.ok) {
          _configCache = {};
          (j.config || []).forEach(function (row) {
            var fn = row.funcion;
            if (!_configCache[fn]) _configCache[fn] = { funcion: fn, titulo: row.titulo };
            var c = row.campos;
            if (!_configCache[fn].campos) _configCache[fn].campos = {};
            if (Array.isArray(c)) {
              _configCache[fn].campos[row.tamano || '60x30'] = c;
            } else if (c && typeof c === 'object') {
              for (var k in c) { if (c.hasOwnProperty(k)) _configCache[fn].campos[k] = c[k]; }
            }
            if (row.tamano) _configCache[fn].tamano = row.tamano;
          });
          _configTs = Date.now();
          console.log('[Etiquetas] _configCache final:', JSON.stringify(_configCache).substring(0, 1000));
        } else {
          console.warn('[Etiquetas] response not ok:', j);
        }
        return _configCache || {};
      })
      .catch(function (e) {
        _configPromise = null;
        _configFailed = true;
        console.warn('[Etiquetas] config fetch failed:', e);
        return _configCache || {};
      });
    return _configPromise;
  }

  // Merge: config guardada pisa defaults, pero campos nuevos de la spec se agregan
  function _mergeCamposConSpec(savedCampos, spec, fmt) {
    // Nunca devolver null si hay config guardada — usar los defaults solo como fallback
    // para campos nuevos que la config no conoce
    if (!Array.isArray(savedCampos) || !savedCampos.length) {
      // Config guardada vacía o inválida: devolver los defaults tal cual
      return (spec.defaults[fmt] || []).slice();
    }
    var savedIds = {};
    savedCampos.forEach(function (c) { savedIds[c.id] = true; });
    var defaults = spec.defaults[fmt] || [];
    var defaultsById = {};
    defaults.forEach(function (c) { defaultsById[c.id] = c; });
    spec.campos.forEach(function (sc) {
      if (!savedIds[sc.id]) {
        // Campo nuevo en la spec, no está en la config guardada — agregarlo
        var defPos = defaultsById[sc.id] ? defaultsById[sc.id].pos : 'S';
        savedCampos.push({ id: sc.id, pos: defPos });
      }
    });
    return savedCampos;
  }

  function resolverCampos(funcion, tamano, cfgOverride) {
    var spec = FUNCIONES[funcion];
    if (!spec) return [];
    var fmt = tamano || '60x30';

    // Si hay override directo (desde configurador), usarlo
    if (cfgOverride && cfgOverride[fmt]) {
      console.log('[Etiquetas] resolverCampos → override', funcion, fmt);
      return cfgOverride[fmt];
    }

    // Si hay config del servidor — merge con spec para campos nuevos
    if (_configCache && _configCache[funcion]) {
      var row = _configCache[funcion];
      var saved = row.campos || {};
      console.log('[Etiquetas] resolverCampos → server config found', funcion, 'fmt:', fmt, 'saved keys:', Object.keys(saved), 'has fmt?', !!saved[fmt]);
      if (saved[fmt]) {
        var merged = _mergeCamposConSpec(saved[fmt].slice(), spec, fmt);
        console.log('[Etiquetas] resolverCampos → merge result:', merged, 'input was:', JSON.stringify(saved[fmt]));
        if (merged) return merged;
        console.warn('[Etiquetas] resolverCampos → merge returned null/falsy despite saved config existing! Falling through to defaults.');
      }
    } else {
      console.log('[Etiquetas] resolverCampos → NO server config', funcion, 'cache keys:', _configCache ? Object.keys(_configCache) : 'null');
    }

    // Defaults
    console.log('[Etiquetas] resolverCampos → DEFAULTS', funcion, fmt);
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
      pie: true, piePad: '3mm 4mm', pieSize: '11pt', Pw: 600,
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

    // Ordenar campos según índice en la spec
    var orden = {};
    spec.campos.forEach(function (sc, i) { orden[sc.id] = i; });
    camposCfg = camposCfg.slice().sort(function (a, b) {
      return (orden[a.id] !== undefined ? orden[a.id] : 99) - (orden[b.id] !== undefined ? orden[b.id] : 99);
    });

    // Separar cuerpo y pie
    var cuerpoCampos = [];
    var pieCampos = [];
    camposCfg.forEach(function (c) {
      if (c.pos === 'P' && med.pie) { pieCampos.push(c); return; }
      cuerpoCampos.push(c);
      if (c.pie && med.pie) pieCampos.push(c);
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
    if (spec.chipEnvio && d.envio_num && parseInt(d.envio_num) > 1) {
      var chip = document.createElement('span');
      chip.style.cssText = 'background:#fff;color:#000;font-size:' + med.chipSize + ';font-weight:800;padding:' + med.chipPad + ';border-radius:1mm;white-space:nowrap;flex-shrink:0;margin-left:1mm;';
      chip.textContent = 'ENVÍO ' + d.envio_num;
      banda.appendChild(chip);
    }

    var marca = document.createElement('span');
    marca.style.cssText = 'font-size:' + med.marcaSize + ';font-weight:600;letter-spacing:1px;white-space:nowrap;flex-shrink:0;margin-left:1mm;';
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
        micro.style.cssText = 'font-size:' + med.microLabel + ';font-weight:700;color:#000;text-transform:uppercase;line-height:1;';
        micro.textContent = label;
        wrap.appendChild(micro);
        var valEl = document.createElement('div');
        valEl.style.cssText = 'font-size:' + med.M + ';font-weight:' + med.Mw + ';text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2;';
        valEl.textContent = val;
        wrap.appendChild(valEl);
      } else if (c.pos === 'S') {
        wrap.style.cssText = 'font-size:' + med.S + ';font-weight:' + med.Sw + ';text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2;';
        var lblSpan = document.createElement('span');
        lblSpan.style.cssText = 'color:#000;';
        lblSpan.textContent = label + ': ';
        wrap.appendChild(lblSpan);
        wrap.appendChild(document.createTextNode(val));
      }
      col.appendChild(wrap);
    });

    body.appendChild(col);
    et.appendChild(body);

    // ── PIE (solo 100×50) — auto-shrink + wrap, NUNCA cortar ──
    if (med.pie && pieCampos.length > 0) {
      var pie = document.createElement('div');
      pie.style.cssText = 'border-top:.2mm solid #000;padding:' + med.piePad + ';display:flex;justify-content:space-between;flex-shrink:0;gap:2mm;';

      var basePt = parseFloat(med.pieSize) || 11;
      var minPt = 5;

      pieCampos.forEach(function (c) {
        var specCampo = spec.campos.find(function (sc) { return sc.id === c.id; });
        if (!specCampo) return;
        var val = d[c.id] != null ? String(d[c.id]).toUpperCase() : '';
        var span = document.createElement('span');
        // Scale font down based on text length — longer text gets smaller font
        var len = val.length;
        var pt = basePt;
        if (len > 12) pt = Math.max(minPt, basePt * 12 / len);
        span.style.cssText = 'font-size:' + pt.toFixed(1) + 'pt;font-weight:' + (med.Pw || 600) + ';text-transform:uppercase;line-height:1.2;word-break:break-word;';
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

    // SIEMPRE esperar config antes de imprimir
    cargarConfig().then(function () {
      if (_configFailed && !_configCache) {
        alert('⚠ No se pudo cargar la configuración de etiquetas. Se va a imprimir con el layout por defecto — verificá antes de imprimir un lote grande.');
      }
      _doImprimir(funcion, items, opts);
    });
  }

  function _doImprimir(funcion, items, opts) {
    var spec = FUNCIONES[funcion];
    var cfgOverride = opts.config || null;
    var fmt = opts.tamano || (cfgOverride && cfgOverride._tamano) || '60x30';
    if (_configCache && _configCache[funcion] && !opts.tamano && !(cfgOverride && cfgOverride._tamano))
      fmt = _configCache[funcion].tamano || fmt;
    console.log('[Etiquetas] _doImprimir', funcion, 'fmt:', fmt, 'opts.tamano:', opts.tamano, 'cache.tamano:', _configCache && _configCache[funcion] ? _configCache[funcion].tamano : 'N/A');
    var med = MEDIDAS[fmt];
    var camposCfg = resolverCampos(funcion, fmt, cfgOverride);
    var tituloRaw = resolverTitulo(funcion, cfgOverride ? cfgOverride._titulo : undefined);

    // Ordenar campos según índice en la spec
    var orden = {};
    spec.campos.forEach(function (sc, i) { orden[sc.id] = i; });
    camposCfg = camposCfg.slice().sort(function (a, b) {
      return (orden[a.id] !== undefined ? orden[a.id] : 99) - (orden[b.id] !== undefined ? orden[b.id] : 99);
    });

    // Separar cuerpo y pie
    var cuerpoCampos = [];
    var pieCampos = [];
    camposCfg.forEach(function (c) {
      if (c.pos === 'P' && med.pie) { pieCampos.push(c); return; }
      cuerpoCampos.push(c);
      if (c.pie && med.pie) pieCampos.push(c);
    });

    // Cargar dependencias y rasterizar
    console.log('[Etiquetas] _doImprimir cuerpo:', JSON.stringify(cuerpoCampos), 'pie:', JSON.stringify(pieCampos));
    console.log('[Etiquetas] _doImprimir RENDER CHECK — fmt:', fmt, 'pageW:', med.pageW, 'pageH:', med.pageH, 'pie_enabled:', med.pie, 'XL:', med.XL, 'L:', med.L, 'M:', med.M, 'S:', med.S);
    var deps = [_ensureFont()];
    if (spec.qr) deps.push(_ensureQRLib());
    Promise.all(deps)
      .then(function () { _rasterPrint(spec, items, med, cuerpoCampos, pieCampos, tituloRaw); })
      .catch(function () { _rasterPrint(spec, items, med, cuerpoCampos, pieCampos, tituloRaw); });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RASTER ENGINE
  // ═══════════════════════════════════════════════════════════════════════
  var SUPER_PX = 32; // px per mm, sobremuestreo 2× para texto nítido
  var OUT_PX = 16;   // px per mm, salida final (2× cabezal 203dpi)
  var CAMPO_GAP = Math.round(0.5 * SUPER_PX); // 0.5mm entre campos

  function _mmPx(v) { return parseFloat(v) * SUPER_PX; }
  function _ptPx(v) { return Math.round(parseFloat(v) * 0.3528 * SUPER_PX); }
  function _padPx(s) {
    var p = s.replace(/mm/g, '').trim().split(/\s+/);
    return [parseFloat(p[0]) * SUPER_PX, (p.length > 1 ? parseFloat(p[1]) : parseFloat(p[0])) * SUPER_PX];
  }

  var _fontReady = false;
  function _ensureFont() {
    if (_fontReady) return Promise.resolve();

    function _loadFaces() {
      var loads = ['800 100px Montserrat', '700 100px Montserrat', '600 100px Montserrat'].map(function (f) {
        return document.fonts.load(f).catch(function () {});
      });
      return Promise.all(loads).then(function () { _fontReady = true; });
    }

    var timeout = new Promise(function (r) { setTimeout(function () { _fontReady = true; r(); }, 1500); });

    var existing = document.querySelector('link[href*="Montserrat"]');
    if (existing) {
      return Promise.race([_loadFaces(), timeout]);
    }

    // Inyectar stylesheet y esperar onload antes de fonts.load
    var linkReady = new Promise(function (resolve) {
      var lk = document.createElement('link');
      lk.rel = 'stylesheet';
      lk.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&display=swap';
      lk.onload = function () { _loadFaces().then(resolve).catch(resolve); };
      lk.onerror = resolve;
      document.head.appendChild(lk);
    });

    return Promise.race([linkReady, timeout]);
  }

  function _ensureQRLib() {
    if (window.QRCode) return Promise.resolve();
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      s.onload = resolve;
      s.onerror = resolve;
      document.head.appendChild(s);
    });
  }

  function _genQRCanvas(text, sizePx) {
    if (!window.QRCode || !text) return null;
    var sz = Math.round(sizePx || 256);
    var div = document.createElement('div');
    div.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
    document.body.appendChild(div);
    try {
      new QRCode(div, { text: text, width: sz, height: sz, correctLevel: QRCode.CorrectLevel.M });
      var c = div.querySelector('canvas');
      document.body.removeChild(div);
      return c;
    } catch (e) {
      document.body.removeChild(div);
      return null;
    }
  }

  function _ellipsis(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    var t = text;
    while (t.length > 1 && ctx.measureText(t + '\u2026').width > maxW) t = t.slice(0, -1);
    return t + '\u2026';
  }

  function _rasterPrint(spec, items, med, cuerpoCampos, pieCampos, tituloRaw) {
    var wMM = parseFloat(med.pageW);
    var hMM = parseFloat(med.pageH);
    var superW = Math.round(wMM * SUPER_PX);
    var superH = Math.round(hMM * SUPER_PX);
    var outW = Math.round(wMM * OUT_PX);
    var outH = Math.round(hMM * OUT_PX);

    var dataUrls = [];
    (items || []).forEach(function (item) {
      var d = {};
      spec.campos.forEach(function (sc) { d[sc.id] = item[sc.id] != null ? item[sc.id] : sc.ej; });
      d._qr = item._qr || spec.qrEj || '';
      d.envio_num = item.envio_num;
      d.envio_total = item.envio_total;
      var titulo = interpolarTitulo(tituloRaw, d);
      dataUrls.push(_drawEtiqueta(spec, d, med, cuerpoCampos, pieCampos, titulo, superW, superH, outW, outH));
    });

    // Ventana de impresión: solo imágenes
    var win = window.open('', '_blank', 'width=500,height=400');
    if (!win) { alert('El navegador bloqueó la ventana de impresión. Habilitá pop-ups.'); return; }

    var imgs = '';
    for (var i = 0; i < dataUrls.length; i++) {
      var brk = i < dataUrls.length - 1 ? 'page-break-after:always;' : '';
      imgs += '<img src="' + dataUrls[i] + '" style="width:' + med.pageW + ';height:' + med.pageH + ';display:block;' + brk + '">';
    }

    win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8">'
      + '<style>@page{size:' + med.pageW + ' ' + med.pageH + ';margin:0}'
      + '*{margin:0;padding:0}body{background:#fff;}</style>'
      + '</head><body>' + imgs
      + '<script>'
      + 'var _p=false;function go(){if(_p)return;_p=true;window.print();}'
      + 'var ii=document.querySelectorAll("img"),n=0;'
      + 'function ck(){n++;if(n>=ii.length)setTimeout(go,100);}'
      + 'for(var j=0;j<ii.length;j++){if(ii[j].complete)ck();else ii[j].onload=ck;}'
      + 'setTimeout(go,1500);'
      + '<\/script></body></html>');
    win.document.close();
  }

  function _drawEtiqueta(spec, d, med, cuerpoCampos, pieCampos, titulo, superW, superH, outW, outH) {
    var cv = document.createElement('canvas');
    cv.width = superW; cv.height = superH;
    var ctx = cv.getContext('2d');
    var FNT = 'Montserrat, sans-serif';

    // Fondo blanco
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, superW, superH);

    // ── BANDA ──
    var bandaH = _mmPx(med.bandaH);
    var bPad = _padPx(med.bandaPad);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, superW, bandaH);
    ctx.textBaseline = 'middle';
    var bandaY = bandaH / 2;

    // Layout derecha→izquierda: marca, chip (si hay), título
    var marcaSz = _ptPx(med.marcaSize);
    ctx.font = '600 ' + marcaSz + 'px ' + FNT;
    var marcaW = ctx.measureText('MADERABLE').width;
    var curR = superW - bPad[1];

    // Marca
    ctx.fillStyle = '#fff';
    ctx.fillText('MADERABLE', curR - marcaW, bandaY);
    curR -= marcaW + _mmPx('1');

    // Chip envío
    if (spec.chipEnvio && d.envio_num && parseInt(d.envio_num) > 1) {
      var chipText = 'ENVÍO ' + d.envio_num;
      var chipSz = _ptPx(med.chipSize);
      var cPad = _padPx(med.chipPad);
      ctx.font = '800 ' + chipSz + 'px ' + FNT;
      var cTxtW = ctx.measureText(chipText).width;
      var cBoxW = cTxtW + cPad[1] * 2;
      var cBoxH = chipSz + cPad[0] * 2;
      var cBoxX = curR - cBoxW;
      var cBoxY = (bandaH - cBoxH) / 2;
      ctx.fillStyle = '#fff';
      ctx.fillRect(cBoxX, cBoxY, cBoxW, cBoxH);
      ctx.fillStyle = '#000';
      ctx.fillText(chipText, cBoxX + cPad[1], bandaY);
      curR = cBoxX - _mmPx('1');
    }

    // Título
    var titSz = _ptPx(med.tituloSize);
    ctx.fillStyle = '#fff';
    ctx.font = '800 ' + titSz + 'px ' + FNT;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillText(_ellipsis(ctx, titulo, curR - bPad[1]), bPad[1], bandaY);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

    // ── PIE (medir primero para bounds del cuerpo) ──
    var pieH = 0;
    var pPad = [0, 0];
    var pieBorder = 3;
    if (med.pie && pieCampos.length > 0) {
      pPad = _padPx(med.piePad);
      pieH = pieBorder + pPad[0] * 2 + _ptPx(med.pieSize);
    }

    // ── CUERPO ──
    var bodyPad = _padPx(med.bodyPad);
    var bodyGap = _mmPx(med.bodyGap);
    var bodyTop = bandaH + bodyPad[0];
    var bodyBot = superH - pieH - bodyPad[0];
    var bodyL = bodyPad[1];
    var bodyR = superW - bodyPad[1];

    // QR: reservar espacio pero no dibujar (se estampa directo en canvas final)
    var camposL = bodyL;
    var qrPxSuper = 0;
    if (spec.qr) {
      qrPxSuper = _mmPx(med.qrSize);
      camposL = bodyL + qrPxSuper + bodyGap;
    }
    var camposW = bodyR - camposL;

    // ── CAMPOS (cuerpo) ──
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';

    // Medir alturas para centrar verticalmente
    var heights = [];
    cuerpoCampos.forEach(function (c) {
      if (c.pos === 'XL' || c.pos === 'L') heights.push(_ptPx(med[c.pos]));
      else if (c.pos === 'M') heights.push(_ptPx(med.microLabel) + 2 + _ptPx(med.M));
      else if (c.pos === 'S') heights.push(_ptPx(med.S));
    });
    var totalH = 0;
    for (var h = 0; h < heights.length; h++) { totalH += heights[h]; if (h < heights.length - 1) totalH += CAMPO_GAP; }

    var cy = bodyTop + (bodyBot - bodyTop - totalH) / 2;
    if (cy < bodyTop) cy = bodyTop;

    cuerpoCampos.forEach(function (c) {
      var sc = spec.campos.find(function (x) { return x.id === c.id; });
      if (!sc) return;
      var val = d[c.id] != null ? String(d[c.id]).toUpperCase() : '';

      if (c.pos === 'XL' || c.pos === 'L') {
        var sz = _ptPx(med[c.pos]);
        ctx.font = '800 ' + sz + 'px ' + FNT;
        ctx.fillText(_ellipsis(ctx, val, camposW), camposL, cy);
        cy += sz + CAMPO_GAP;
      } else if (c.pos === 'M') {
        var mls = _ptPx(med.microLabel);
        var ms = _ptPx(med.M);
        ctx.font = '700 ' + mls + 'px ' + FNT;
        ctx.fillText(_ellipsis(ctx, sc.label, camposW), camposL, cy);
        cy += mls + 2;
        ctx.font = '700 ' + ms + 'px ' + FNT;
        ctx.fillText(_ellipsis(ctx, val, camposW), camposL, cy);
        cy += ms + CAMPO_GAP;
      } else if (c.pos === 'S') {
        var ss = _ptPx(med.S);
        ctx.font = '600 ' + ss + 'px ' + FNT;
        var lbl = sc.label + ': ';
        var lblW = ctx.measureText(lbl).width;
        ctx.fillText(lbl, camposL, cy);
        ctx.fillText(_ellipsis(ctx, val, camposW - lblW), camposL + lblW, cy);
        cy += ss + CAMPO_GAP;
      }
    });

    // ── PIE ──
    if (med.pie && pieCampos.length > 0) {
      var pieTop = superH - pieH;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, pieTop, superW, pieBorder);
      var pieSz = _ptPx(med.pieSize);
      ctx.font = '600 ' + pieSz + 'px ' + FNT;
      ctx.textBaseline = 'middle';
      var pieY = pieTop + pieBorder + pPad[0] + pieSz / 2;

      pieCampos.forEach(function (c, idx) {
        var sc = spec.campos.find(function (x) { return x.id === c.id; });
        if (!sc) return;
        var val = d[c.id] != null ? String(d[c.id]).toUpperCase() : '';
        var txt = val;
        var tw = ctx.measureText(txt).width;
        var x;
        if (idx === 0) x = pPad[1];
        else if (idx === pieCampos.length - 1) x = superW - pPad[1] - tw;
        else x = (superW - tw) / 2;
        ctx.fillText(_ellipsis(ctx, txt, superW - pPad[1] * 2), x, pieY);
      });
    }

    // ── DOWNSCALE (32→16 px/mm, con smoothing para texto) ──
    var fcv = document.createElement('canvas');
    fcv.width = outW; fcv.height = outH;
    var fctx = fcv.getContext('2d');
    fctx.drawImage(cv, 0, 0, outW, outH);

    // ── QR directo al canvas final (sin pasar por sobremuestreo → módulos nítidos) ──
    if (spec.qr) {
      var qrOutPx = Math.round(parseFloat(med.qrSize) * OUT_PX);
      var qrCv = _genQRCanvas(d._qr, qrOutPx);
      if (qrCv) {
        var outBodyPad = _padPx(med.bodyPad); // recalcular a escala super, luego dividir
        var qrX = Math.round(bodyL / 2); // bodyL está a escala super → /2 = escala out
        var qrBodyTop = Math.round(bodyTop / 2);
        var qrBodyBot = Math.round(bodyBot / 2);
        var qrYout = qrBodyTop + (qrBodyBot - qrBodyTop - qrOutPx) / 2;
        if (qrYout < qrBodyTop) qrYout = qrBodyTop;
        fctx.imageSmoothingEnabled = false;
        fctx.drawImage(qrCv, qrX, qrYout, qrOutPx, qrOutPx);
        fctx.imageSmoothingEnabled = true;
      }
    }

    // ── BINARIZACIÓN (umbral 180 → antialiasing pasa a negro → trazos llenos) ──
    var id = fctx.getImageData(0, 0, outW, outH);
    var px = id.data;
    for (var b = 0; b < px.length; b += 4) {
      var lum = 0.299 * px[b] + 0.587 * px[b+1] + 0.114 * px[b+2];
      var bw = lum < 180 ? 0 : 255;
      px[b] = px[b+1] = px[b+2] = bw; px[b+3] = 255;
    }
    fctx.putImageData(id, 0, 0);
    return fcv.toDataURL('image/png');
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

  // Pre-cargar config al inicializar para que esté lista antes del primer imprimir()
  cargarConfig();
})();
