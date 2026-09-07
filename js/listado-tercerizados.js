/* js/listado-tercerizados.js — planilla de partidas tercerizadas, reutilizable MBLE
   montarListadoTercerizados(opts) -> { abrir(), cerrar(), set(partidas) }
   opts.partidas : function que devuelve el array de partidas ya en memoria (opcional).
                   Si no viene, o devuelve vacio, el componente hace fetch por su cuenta.
   Inyecta su propio CSS (colores literales para verse igual en todo el sitio). */
(function(){
  if (window.montarListadoTercerizados) return;

  // ── CSS ──
  if (!document.getElementById('mble-listado-css')) {
    var st = document.createElement('style'); st.id = 'mble-listado-css';
    st.textContent = ''
      + '.lst-over{position:fixed;inset:0;z-index:200;display:none;flex-direction:column;background:#0f0f0f;font-family:"DM Sans",sans-serif;}'
      + '.lst-top{display:flex;align-items:center;gap:12px;padding:8px 16px;background:#111;border-bottom:1px solid #1e1e1e;flex-shrink:0;}'
      + '.lst-top-title{font-family:"JetBrains Mono",monospace;font-size:11px;font-weight:700;color:#FFD600;letter-spacing:1px;text-transform:uppercase;}'
      + '.lst-top-count{font-family:"JetBrains Mono",monospace;font-size:10px;color:#555;}'
      + '.lst-btn{font-family:"JetBrains Mono",monospace;font-size:10px;padding:5px 11px;border-radius:3px;border:1px solid #2a2a2a;background:transparent;color:#555;cursor:pointer;}'
      + '.lst-btn:hover{border-color:#FFD600;color:#FFD600;}'
      + '.lst-btn-pri{background:#FFD600;color:#000;border-color:#FFD600;}'
      + '.lst-btn-pri:hover{opacity:.85;}'
      + '.lst-filtros{display:flex;flex-wrap:wrap;gap:8px;padding:8px 16px;background:#111;border-bottom:1px solid #1e1e1e;align-items:center;flex-shrink:0;}'
      + '.lst-filtros input,.lst-filtros select{font-family:"JetBrains Mono",monospace;font-size:11px;background:#0d0d0d;border:1px solid #242424;border-radius:4px;padding:5px 8px;color:#c8c8c8;outline:none;}'
      + '.lst-filtros input:focus,.lst-filtros select:focus{border-color:#FFD600;}'
      + '.lst-filtros label{font-family:"JetBrains Mono",monospace;font-size:10px;color:#555;display:flex;align-items:center;gap:4px;cursor:pointer;}'
      + '.lst-wrap{flex:1;overflow:auto;}'
      + '.lst-tabla{border-collapse:separate;border-spacing:0;width:max-content;min-width:100%;font-size:11px;font-family:"JetBrains Mono",monospace;}'
      + '.lst-tabla th{position:sticky;top:0;z-index:3;background:#161616;border-bottom:1px solid #2a2a2a;font-size:9px;letter-spacing:1px;text-transform:uppercase;color:#555;padding:7px 9px;white-space:nowrap;cursor:pointer;user-select:none;}'
      + '.lst-tabla th:hover,.lst-tabla th.lst-sorted{color:#FFD600;}'
      + '.lst-frow th{top:29px;background:#121212;padding:3px 5px;cursor:default;}'
      + '.lst-frow input,.lst-frow select{width:100%;min-width:60px;font-family:"JetBrains Mono",monospace;font-size:10px;background:#0a0a0a;border:1px solid #202020;border-radius:3px;padding:3px 5px;color:#c8c8c8;outline:none;}'
      + '.lst-frow input:focus,.lst-frow select:focus{border-color:#FFD600;}'
      + '.lst-tabla td{padding:5px 9px;border-bottom:1px solid #171717;white-space:nowrap;color:#c8c8c8;font-size:11px;font-family:"JetBrains Mono",monospace;background:transparent;cursor:default;}'
      + '.lst-tabla tr:hover td{background:#151515;}'
      + '.lst-arch td{opacity:.42;}'
      + '.lst-num{text-align:right;}'
      + '.lst-trunc{max-width:230px;overflow:hidden;text-overflow:ellipsis;}'
      + '.lst-trunc-sm{max-width:150px;overflow:hidden;text-overflow:ellipsis;}'
      + '.lst-env{font-size:10px;color:#4a9eff;}'
      + '.lst-odf{font-size:10px;color:#FFD600;}'
      + '.lst-cod{font-weight:700;color:#ddd;}'
      + '.lst-vacio{color:#3a3a3a;}'
      + '.lst-alerta{color:#e03030;font-weight:700;}'
      + '.lst-curso{color:#f59e0b;}'
      + '.lst-pill{font-family:"JetBrains Mono",monospace;font-size:9px;padding:2px 6px;border-radius:3px;border:1px solid;display:inline-block;}'
      + '.lst-p-taller{background:rgba(255,214,0,.08);color:#FFD600;border-color:#3a3200;}'
      + '.lst-p-desp{background:rgba(74,158,255,.08);color:#4a9eff;border-color:#123054;}'
      + '.lst-p-recv{background:rgba(76,175,80,.08);color:#4caf50;border-color:#1a3a1a;}'
      + '.lst-p-ok{background:#0a1f0a;color:#4caf50;border-color:#1a3a1a;}'
      + '.lst-p-obs{background:#1f1a00;color:#f59e0b;border-color:#3a2f00;}'
      + '.lst-p-reh{background:#1f0a0a;color:#e03030;border-color:#3a1a1a;}'
      + '.lst-pie{background:#111;border-top:1px solid #1e1e1e;padding:7px 16px;font-family:"JetBrains Mono",monospace;font-size:10px;color:#555;display:flex;gap:20px;flex-shrink:0;}'
      + '.lst-pie b{color:#ddd;}'
      + '.lst-sinres{text-align:center;padding:40px;color:#555;font-size:12px;}';
    document.head.appendChild(st);
  }

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function hoyISO(){
    var d = new Date(), m = d.getMonth()+1, x = d.getDate();
    return d.getFullYear() + '-' + (m<10?'0':'') + m + '-' + (x<10?'0':'') + x;
  }
  function fx(v){ return (v||'').slice(0,10); }
  function fmtNum(v,dec){ return v != null ? Number(v).toLocaleString('es-UY',{minimumFractionDigits:dec,maximumFractionDigits:dec}) : null; }

  var COLS = [
    {key:'numero_envio',hdr:'ENV',cls:'lst-env'},
    {key:'proyectoNum',hdr:'ODF',cls:'lst-odf'},
    {key:'obra',hdr:'Obra',cls:'lst-trunc'},
    {key:'cliente',hdr:'Cliente',cls:'lst-trunc'},
    {key:'muebleCodigo',hdr:'Cód.',cls:'lst-cod'},
    {key:'muebleNombre',hdr:'Mueble',cls:'lst-trunc'},
    {key:'proveedorNombre',hdr:'Proveedor',cls:'lst-trunc-sm'},
    {key:'_estado',hdr:'Estado'},
    {key:'_recep',hdr:'Recepción'},
    {key:'bultos',hdr:'Bultos',cls:'lst-num',num:true},
    {key:'fechaDespacho',hdr:'Despacho'},
    {key:'fechaRetornoEstimada',hdr:'Retorno est.'},
    {key:'fechaRecepcion',hdr:'Recepción'},
    {key:'_dias',hdr:'Días',cls:'lst-num',num:true},
    {key:'_m2',hdr:'m²',cls:'lst-num',num:true},
    {key:'monto_usd',hdr:'USD',cls:'lst-num',num:true},
    {key:'_nota',hdr:'Nota',cls:'lst-trunc'}
  ];

  var EST_LABEL = {en_taller:'En taller', despachada:'En proveedor', recibida:'Recibida'};
  var EST_CLS   = {en_taller:'lst-p-taller', despachada:'lst-p-desp', recibida:'lst-p-recv'};
  var REC_LABEL = {ok:'Conforme', obs:'Con obs.', rehacer:'A rehacer'};
  var REC_CLS   = {ok:'lst-p-ok', obs:'lst-p-obs', rehacer:'lst-p-reh'};

  // Filtros por columna: indices de las columnas que tienen filtro de texto o select
  var COL_TEXT_FILTER = [0,1,2,3,4,5,16]; // ENV,ODF,Obra,Cliente,Cod,Mueble,Nota
  var COL_SEL_FILTER  = {7:'estado',8:'recep',6:'prov'}; // col index -> tipo

  window.montarListadoTercerizados = function(opts){
    opts = opts || {};

    var _overlay = null;
    var _datos = [];
    var _cache = null;
    var _cacheTs = 0;
    var _abierto = false;
    var _sortCol = 0; // ENV
    var _sortAsc = false; // descendente
    var _filtros = {};
    var _colFiltros = {};

    function _crearOverlay(){
      if (_overlay) return;
      _overlay = document.createElement('div');
      _overlay.className = 'lst-over';
      _overlay.innerHTML = ''
        + '<div class="lst-top">'
        + '<button class="lst-btn" id="lst-cerrar" style="font-weight:700;">✕ CERRAR</button>'
        + '<span class="lst-top-title">LISTADO GENERAL</span>'
        + '<span class="lst-top-count" id="lst-count"></span>'
        + '<span style="flex:1;"></span>'
        + '<button class="lst-btn" id="lst-copiar">⧉ Copiar</button>'
        + '<button class="lst-btn" id="lst-csv">↓ CSV</button>'
        + '</div>'
        + '<div class="lst-filtros" id="lst-filtros">'
        + '<input id="lst-q" placeholder="Buscar en todo…" style="width:180px;">'
        + '<select id="lst-f-prov"><option value="">Proveedor</option></select>'
        + '<select id="lst-f-est"><option value="">Estado</option><option value="en_taller">En taller</option><option value="despachada">En proveedor</option><option value="recibida">Recibida</option></select>'
        + '<select id="lst-f-rec"><option value="">Recepción</option><option value="ok">Conforme</option><option value="obs">Con obs.</option><option value="rehacer">A rehacer</option><option value="_vacio">Sin registrar</option></select>'
        + '<span style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#555;">Despacho</span>'
        + '<input type="date" id="lst-f-desde" style="width:120px;color-scheme:dark;">'
        + '<input type="date" id="lst-f-hasta" style="width:120px;color-scheme:dark;">'
        + '<label><input type="checkbox" id="lst-f-arch"> Archivadas</label>'
        + '<label><input type="checkbox" id="lst-f-atr"> Solo atrasadas</label>'
        + '<button class="lst-btn" id="lst-limpiar">Limpiar</button>'
        + '</div>'
        + '<div class="lst-wrap" id="lst-wrap">'
        + '<table class="lst-tabla"><thead><tr id="lst-hrow"></tr><tr class="lst-frow" id="lst-frow"></tr></thead><tbody id="lst-tbody"></tbody></table>'
        + '<div class="lst-sinres" id="lst-sinres" style="display:none;">Sin partidas para este filtro.</div>'
        + '</div>'
        + '<div class="lst-pie" id="lst-pie"></div>';
      document.body.appendChild(_overlay);

      // Eventos
      document.getElementById('lst-cerrar').addEventListener('click', _cerrar);
      document.getElementById('lst-copiar').addEventListener('click', _copiar);
      document.getElementById('lst-csv').addEventListener('click', _exportCsv);
      document.getElementById('lst-limpiar').addEventListener('click', _limpiarFiltros);
      ['lst-q','lst-f-prov','lst-f-est','lst-f-rec','lst-f-desde','lst-f-hasta','lst-f-arch','lst-f-atr'].forEach(function(id){
        var el = document.getElementById(id);
        if (el) el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', _renderTabla);
      });

      // Header
      var hrow = document.getElementById('lst-hrow');
      var frow = document.getElementById('lst-frow');
      COLS.forEach(function(c, i){
        var th = document.createElement('th');
        th.textContent = c.hdr;
        th.addEventListener('click', function(){ _toggleSort(i); });
        hrow.appendChild(th);

        var fth = document.createElement('th');
        if (COL_TEXT_FILTER.indexOf(i) !== -1) {
          fth.innerHTML = '<input data-ci="'+i+'" placeholder="…">';
          fth.querySelector('input').addEventListener('input', function(){ _colFiltros[i] = this.value.toLowerCase(); _renderTabla(); });
        } else if (COL_SEL_FILTER[i]) {
          fth.innerHTML = '<select data-ci="'+i+'"><option value="">—</option></select>';
          // se puebla en _renderTabla
        } else {
          fth.textContent = '';
        }
        frow.appendChild(fth);
      });

      // Escape
      document.addEventListener('keydown', function(e){
        if (e.key === 'Escape' && _abierto) _cerrar();
      });
    }

    function _cerrar(){
      _abierto = false;
      if (_overlay) _overlay.style.display = 'none';
    }

    function _abrir(){
      _crearOverlay();
      _abierto = true;
      _overlay.style.display = 'flex';
      _cargarDatos();
    }

    function _cargarDatos(){
      var src = opts.partidas ? opts.partidas() : null;
      if (src && src.length) { _datos = src; _renderTabla(); return; }
      if (_cache && (Date.now() - _cacheTs < 60000)) { _datos = _cache; _renderTabla(); return; }
      document.getElementById('lst-tbody').innerHTML = '<tr><td colspan="17" style="text-align:center;padding:20px;color:#555;">Cargando…</td></tr>';
      fetch('/api/tiempos?action=partidas').then(function(r){ return r.json(); }).then(function(d){
        _cache = d.partidas || [];
        _cacheTs = Date.now();
        _datos = _cache;
        _renderTabla();
      }).catch(function(e){
        document.getElementById('lst-tbody').innerHTML = '<tr><td colspan="17" style="text-align:center;padding:20px;color:#e03030;">Error: '+esc(e.message)+'</td></tr>';
      });
    }

    function _enrich(p){
      var HOY = hoyISO();
      var fd = fx(p.fechaDespacho), fr = fx(p.fechaRecepcion), fre = fx(p.fechaRetornoEstimada);
      var dias = fd ? Math.round((new Date((fr||HOY)+'T00:00:00') - new Date(fd+'T00:00:00'))/86400000) : null;
      var m2 = 0; (p.baru_items||[]).forEach(function(i){ m2 += Number(i.metros_cuadrados)||0; });
      var atrasada = !!(fre && !fr && fre < HOY);
      var mc = p.muebleCodigo; if (mc === 'undefined' || mc === undefined) mc = '';
      return {
        _fd:fd, _fr:fr, _fre:fre, _dias:dias, _m2:m2, _atrasada:atrasada,
        _estado: EST_LABEL[p.estado]||p.estado||'',
        _recep: REC_LABEL[p.estadoRecep]||'',
        _nota: p.nota || p.obs || '',
        _mc: mc,
        _diasSinRecep: !fr && fd,
        _diasAlerta: dias != null && !fr && dias > 15,
        _src: p
      };
    }

    function _aplicarFiltros(){
      var q = (document.getElementById('lst-q')||{}).value; q = (q||'').toLowerCase();
      var prov = (document.getElementById('lst-f-prov')||{}).value || '';
      var est = (document.getElementById('lst-f-est')||{}).value || '';
      var rec = (document.getElementById('lst-f-rec')||{}).value || '';
      var desde = (document.getElementById('lst-f-desde')||{}).value || '';
      var hasta = (document.getElementById('lst-f-hasta')||{}).value || '';
      var arch = (document.getElementById('lst-f-arch')||{}).checked;
      var atr = (document.getElementById('lst-f-atr')||{}).checked;

      var result = [];
      for (var i = 0; i < _datos.length; i++) {
        var p = _datos[i];
        if (!arch && p.archivada) continue;
        if (prov && p.proveedorNombre !== prov) continue;
        if (est && p.estado !== est) continue;
        if (rec === '_vacio') { if (p.estadoRecep) continue; }
        else if (rec && p.estadoRecep !== rec) continue;
        var fd = fx(p.fechaDespacho);
        if (desde && (!fd || fd < desde)) continue;
        if (hasta && (!fd || fd > hasta)) continue;

        var e = _enrich(p);
        if (atr && !e._atrasada) continue;

        // Filtros por columna
        var skip = false;
        for (var ci in _colFiltros) {
          if (!_colFiltros.hasOwnProperty(ci)) continue;
          var cv = _colFiltros[ci];
          if (!cv) continue;
          var idx = Number(ci);
          var cell = _cellText(p, e, idx).toLowerCase();
          if (cell.indexOf(cv) === -1) { skip = true; break; }
        }
        if (skip) continue;

        // Global search
        if (q) {
          var haystack = _allText(p, e).toLowerCase();
          if (haystack.indexOf(q) === -1) continue;
        }

        result.push({p:p, e:e});
      }
      return result;
    }

    function _cellText(p, e, i){
      switch(i){
        case 0: return p.numero_envio||'';
        case 1: return p.proyectoNum||'';
        case 2: return p.obra||'';
        case 3: return p.cliente||'';
        case 4: return e._mc||'';
        case 5: return p.muebleNombre||'';
        case 6: return p.proveedorNombre||'';
        case 7: return e._estado;
        case 8: return e._recep;
        case 9: return String(p.bultos||0);
        case 10: return e._fd;
        case 11: return e._fre;
        case 12: return e._fr;
        case 13: return e._dias != null ? String(e._dias) : '';
        case 14: return e._m2 > 0 ? e._m2.toFixed(2) : '';
        case 15: return p.monto_usd != null ? String(p.monto_usd) : '';
        case 16: return e._nota;
        default: return '';
      }
    }

    function _allText(p, e){
      var parts = [];
      for (var i = 0; i < COLS.length; i++) parts.push(_cellText(p, e, i));
      return parts.join(' ');
    }

    function _sortRows(rows){
      var col = _sortCol, asc = _sortAsc, isNum = COLS[col] && COLS[col].num;
      rows.sort(function(a, b){
        var va = _cellText(a.p, a.e, col), vb = _cellText(b.p, b.e, col);
        var ea = va === '' || va == null, eb = vb === '' || vb == null;
        if (ea && !eb) return 1;
        if (!ea && eb) return -1;
        if (ea && eb) return 0;
        var cmp;
        if (isNum) { cmp = Number(va) - Number(vb); }
        else { cmp = va.localeCompare(vb, 'es'); }
        return asc ? cmp : -cmp;
      });
      return rows;
    }

    function _toggleSort(i){
      if (_sortCol === i) _sortAsc = !_sortAsc;
      else { _sortCol = i; _sortAsc = true; }
      _renderTabla();
    }

    function _renderTabla(){
      if (!_abierto) return;
      var rows = _aplicarFiltros();
      rows = _sortRows(rows);

      // Poblar selects de filtro de columna del universo completo (no de lo filtrado)
      var _uni = []; for (var ui = 0; ui < _datos.length; ui++) _uni.push({p:_datos[ui], e:_enrich(_datos[ui])});
      _poblarColSelect(6, _uni, function(r){ return r.p.proveedorNombre||''; });
      _poblarColSelect(7, _uni, function(r){ return r.e._estado; });
      _poblarColSelect(8, _uni, function(r){ return r.e._recep; });

      // Poblar select de proveedor en la barra
      var provSel = document.getElementById('lst-f-prov');
      if (provSel) {
        var prevProv = provSel.value;
        var provs = {}; _datos.forEach(function(p){ if (p.proveedorNombre) provs[p.proveedorNombre] = 1; });
        var html = '<option value="">Proveedor</option>';
        Object.keys(provs).sort().forEach(function(n){ html += '<option value="'+esc(n)+'">'+esc(n)+'</option>'; });
        provSel.innerHTML = html;
        provSel.value = prevProv;
      }

      // Header sort indicators
      var ths = document.getElementById('lst-hrow').children;
      for (var i = 0; i < ths.length; i++) {
        ths[i].className = i === _sortCol ? 'lst-sorted' : '';
        ths[i].textContent = COLS[i].hdr + (i === _sortCol ? (_sortAsc ? ' ▲' : ' ▼') : '');
      }

      // Count
      document.getElementById('lst-count').textContent = rows.length + ' / ' + _datos.length;

      // Body
      var tbody = document.getElementById('lst-tbody');
      if (!rows.length) {
        tbody.innerHTML = '';
        document.getElementById('lst-sinres').style.display = '';
      } else {
        document.getElementById('lst-sinres').style.display = 'none';
        var h = [];
        for (var ri = 0; ri < rows.length; ri++) {
          var r = rows[ri], p = r.p, e = r.e;
          var trCls = p.archivada ? ' class="lst-arch"' : '';
          h.push('<tr'+trCls+'>');
          h.push('<td class="lst-env">'+esc(p.numero_envio||'')+'</td>');
          h.push('<td class="lst-odf">'+(p.proyectoNum ? esc(p.proyectoNum) : '<span class="lst-vacio">sin ODF</span>')+'</td>');
          h.push('<td class="lst-trunc" title="'+esc(p.obra||'')+'">'+esc(p.obra||'')+'</td>');
          h.push('<td class="lst-trunc" title="'+esc(p.cliente||'')+'">'+esc(p.cliente||'')+'</td>');
          h.push('<td class="lst-cod">'+esc(e._mc)+'</td>');
          h.push('<td class="lst-trunc" title="'+esc(p.muebleNombre||'')+'">'+esc(p.muebleNombre||'')+'</td>');
          h.push('<td class="lst-trunc-sm">'+(p.proveedorNombre ? esc(p.proveedorNombre) : '<span class="lst-vacio">\u2014</span>')+'</td>');
          h.push('<td>'+(EST_CLS[p.estado] ? '<span class="lst-pill '+EST_CLS[p.estado]+'">'+esc(e._estado)+'</span>' : esc(e._estado))+'</td>');
          h.push('<td>'+(p.estadoRecep && REC_CLS[p.estadoRecep] ? '<span class="lst-pill '+REC_CLS[p.estadoRecep]+'">'+esc(e._recep)+'</span>' : '<span class="lst-vacio">\u2014</span>')+'</td>');
          h.push('<td class="lst-num">'+(p.bultos||0)+'</td>');
          h.push('<td>'+esc(e._fd)+'</td>');
          var freClass = e._atrasada ? ' class="lst-alerta"' : '';
          h.push('<td'+freClass+'>'+esc(e._fre)+'</td>');
          h.push('<td>'+esc(e._fr)+'</td>');
          // Dias
          if (e._dias != null) {
            var dCls = e._diasAlerta ? 'lst-alerta' : (e._diasSinRecep ? 'lst-curso' : '');
            h.push('<td class="lst-num'+(dCls?' '+dCls:'')+'">'+e._dias+(e._diasSinRecep?'\u2026':'')+'</td>');
          } else { h.push('<td class="lst-num lst-vacio">\u2014</td>'); }
          h.push('<td class="lst-num">'+(e._m2 > 0 ? e._m2.toFixed(2) : '<span class="lst-vacio">\u2014</span>')+'</td>');
          h.push('<td class="lst-num">'+(p.monto_usd != null ? fmtNum(p.monto_usd,2) : '<span class="lst-vacio">\u2014</span>')+'</td>');
          h.push('<td class="lst-trunc" title="'+esc(e._nota)+'">'+esc(e._nota)+'</td>');
          h.push('</tr>');
        }
        tbody.innerHTML = h.join('');
      }

      // Pie
      _renderPie(rows);

      // guardar para export
      _lastRows = rows;
    }

    var _lastRows = [];

    function _poblarColSelect(colIdx, rows, getter){
      var th = document.getElementById('lst-frow').children[colIdx];
      if (!th) return;
      var sel = th.querySelector('select');
      if (!sel) return;
      var prev = sel.value;
      var vals = {};
      rows.forEach(function(r){ var v = getter(r); if (v) vals[v] = 1; });
      var html = '<option value="">\u2014</option>';
      Object.keys(vals).sort().forEach(function(v){ html += '<option value="'+esc(v)+'">'+esc(v)+'</option>'; });
      sel.innerHTML = html;
      sel.value = prev;
      sel.onchange = function(){ _colFiltros[colIdx] = this.value.toLowerCase(); _renderTabla(); };
    }

    function _renderPie(rows){
      var n = rows.length, bultos = 0, m2 = 0, usd = 0, conMonto = 0, enProv = 0, atrasadas = 0;
      for (var i = 0; i < n; i++) {
        var r = rows[i];
        bultos += r.p.bultos || 0;
        m2 += r.e._m2;
        if (r.p.monto_usd != null) { usd += r.p.monto_usd; conMonto++; }
        if (r.p.estado === 'despachada') enProv++;
        if (r.e._atrasada) atrasadas++;
      }
      var parts = [
        'Partidas <b>'+n+'</b>',
        'Bultos <b>'+bultos+'</b>',
        'm\u00B2 <b>'+m2.toFixed(2)+'</b>',
        'USD <b>'+fmtNum(usd,2)+'</b> ('+conMonto+' de '+n+' con monto)',
        'En proveedor <b>'+enProv+'</b>'
      ];
      if (atrasadas > 0) parts.push('<span style="color:#f59e0b;">Atrasadas <b>'+atrasadas+'</b></span>');
      document.getElementById('lst-pie').innerHTML = parts.join(' &middot; ');
    }

    // ── Export ──
    function _exportData(){
      var hdrs = COLS.map(function(c){ return c.hdr; });
      var NUM_DEC = {14:true, 15:true}; // m², USD
      var filas = _lastRows.map(function(r){
        return COLS.map(function(c, i){
          var v = _cellText(r.p, r.e, i);
          if (NUM_DEC[i] && v !== '') v = Number(v).toFixed(2).replace('.', ',');
          return v;
        });
      });
      return {hdrs:hdrs, filas:filas};
    }

    function _exportCsv(){
      var d = _exportData();
      var lines = [d.hdrs.map(_csvCell).join(';')];
      d.filas.forEach(function(f){ lines.push(f.map(_csvCell).join(';')); });
      var blob = new Blob(['\uFEFF' + lines.join('\r\n')], {type:'text/csv;charset=utf-8'});
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'tercerizados-' + hoyISO() + '.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    }

    function _csvCell(v){
      return '"' + String(v==null?'':v).replace(/"/g,'""') + '"';
    }

    function _copiar(){
      var d = _exportData();
      var lines = [d.hdrs.join('\t')];
      d.filas.forEach(function(f){ lines.push(f.join('\t')); });
      navigator.clipboard.writeText(lines.join('\n')).then(function(){
        var btn = document.getElementById('lst-copiar');
        var prev = btn.textContent;
        btn.textContent = '\u2713 copiado';
        setTimeout(function(){ btn.textContent = prev; }, 1400);
      }).catch(function(){});
    }

    function _limpiarFiltros(){
      _colFiltros = {};
      _sortCol = 0; _sortAsc = false;
      var ids = ['lst-q','lst-f-prov','lst-f-est','lst-f-rec','lst-f-desde','lst-f-hasta'];
      ids.forEach(function(id){ var el = document.getElementById(id); if (el) el.value = ''; });
      var cbs = ['lst-f-arch','lst-f-atr'];
      cbs.forEach(function(id){ var el = document.getElementById(id); if (el) el.checked = false; });
      // Limpiar inputs de columna
      var frow = document.getElementById('lst-frow');
      if (frow) {
        var inputs = frow.querySelectorAll('input,select');
        for (var i = 0; i < inputs.length; i++) inputs[i].value = '';
      }
      _renderTabla();
    }

    return {
      abrir: _abrir,
      cerrar: _cerrar,
      set: function(partidas){ _datos = partidas || []; if (_abierto) _renderTabla(); }
    };
  };
})();
