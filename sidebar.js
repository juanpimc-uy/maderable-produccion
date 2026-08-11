// sidebar.js — Componente compartido MBLE ERP
// Inyecta el sidebar en <div id="sidebar-root"> y maneja nav activo, roles, grupos colapsables.
(function () {
  // ── 1. Detectar pagina actual ──────────────────────────────────────
  const PAGE = (location.pathname.split('/').pop() || 'admin.html').toLowerCase();
  const ON_ADMIN = PAGE === 'admin.html' || PAGE === '' || PAGE === 'index.html';

  // ── 2. Definicion de items de nav ──────────────────────────────────
  const GEAR_SVG_PATH = '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>';

  var NAV_ITEMS = [
    { id: 'dashboard',  icon: '◈', label: 'Dashboard',  page: 'admin.html', section: 'dashboard',  roles: ['admin','oficina'] },
    { id: 'proyectos',  icon: '▦', label: 'Proyectos',  page: 'admin.html', section: 'proyectos',
      roles: ['admin','oficina'], group: true, collapsible: true, defaultOpen: false, navigable: true,
      children: [
        { id: 'planificacion', icon: '▤', label: 'Planificación', page: 'planificacion.html', roles: ['admin','oficina'] },
        { id: 'capacidad', icon: '▥', label: 'Capacidad', page: 'capacidad.html', roles: ['admin','oficina'] },
      ] },
    { id: 'retrabajos', icon: 'ↄ', label: 'Retrabajos', page: 'retrabajos.html', roles: ['admin','oficina'] },
    { type: 'sep' },
    { id: 'operarios',  icon: '◎', label: 'Operarios',  page: 'admin.html', section: 'operarios',  roles: ['admin'] },
    { id: 'tiempos',    icon: '⏱', label: 'Tiempos',    page: 'tiempos.html',                       roles: ['admin','oficina'] },
    { type: 'sep' },
    {
      id: 'materiales-group', icon: '▣', label: 'Materiales',
      group: true, collapsible: true, defaultOpen: true,
      roles: ['admin','oficina'],
      children: [
        { id: 'kitting',    icon: '⬗', label: 'Kitting SO',  page: 'armado-so.html',       roles: ['admin','oficina'] },
        { id: 'recepcion',  icon: '◫', label: 'Recepción',   page: 'recepciones-oc.html',  roles: ['admin','oficina'] },
        { id: 'inventario', icon: '▤', label: 'Inventario',  page: 'inventario.html', roles: ['admin','oficina'] },
        { id: 'madera',     iconSvg: '<circle cx="7.5" cy="16" r="3.5"/><circle cx="7.5" cy="16" r="1"/><circle cx="16.5" cy="16" r="3.5"/><circle cx="16.5" cy="16" r="1"/><circle cx="12" cy="8.5" r="3.5"/><circle cx="12" cy="8.5" r="1"/>',
          label: 'Madera', page: 'madera.html', roles: ['admin','oficina'] },
      ]
    },
    { type: 'sep' },
    {
      id: 'logistica-group', icon: '⇥', label: 'Logística',
      group: true, collapsible: true, defaultOpen: false,
      roles: ['admin','oficina'],
      children: [
        { id: 'despachos', icon: '⇥', label: 'Despachos',
          url: 'https://juanpimc-uy.github.io/ctrl-despachos/admin.html?from=erp',
          external: true, roles: ['admin','oficina'] },
        {
          id: 'tercerizados-group', icon: '🧵', label: 'Tercerizados',
          group: true, collapsible: true, defaultOpen: false,
          roles: ['admin','oficina'],
          children: []
        }
      ]
    },
    { type: 'sep' },
    {
      id: 'informes-group', icon: '▐', label: 'Informes',
      group: true, collapsible: true, defaultOpen: false,
      roles: ['admin','oficina'],
      children: [
        { id: 'costos',   icon: '◉', label: 'Costos',   page: 'informes.html',               roles: ['admin','oficina'] },
        { id: 'facturas', icon: '◈', label: 'Facturas', page: 'informes.html?vista=facturas', roles: ['admin','oficina'] },
        { id: 'lean',     icon: '◆', label: 'Lean',     page: 'informes.html?vista=lean',     roles: ['admin','oficina'] },
      ]
    },
    { type: 'sep' },
    { id: 'ajustes',   iconSvg: GEAR_SVG_PATH, label: 'Ajustes',   page: 'admin.html', section: 'ajustes',   roles: ['admin'] },
    { id: 'mi-cuenta', icon: '◉',              label: 'Mi cuenta', page: 'admin.html', section: 'mi-cuenta', roles: ['admin','oficina'] },
  ];

  // ── 3. Leer sesion ─────────────────────────────────────────────────
  var session = {};
  try { session = JSON.parse(localStorage.getItem('mble_session') || sessionStorage.getItem('mble_session') || '{}'); } catch(e) {}
  var rol = session.rol_app || session.rol || 'admin';
  var nombre = session.nombre || session.name || '';
  var iniciales = nombre ? nombre.split(' ').map(function(p){return p[0];}).join('').slice(0, 2).toUpperCase() : '??';

  // ── 4. Determinar item activo ──────────────────────────────────────
  function getActiveId() {
    if (ON_ADMIN) return null;
    var map = {
      'tiempos.html':         'tiempos',
      'retrabajos.html':      'retrabajos',
      'armado-so.html':       'kitting',
      'armado-so-planta.html':'kitting',
      'recepciones-oc.html':  'recepcion',
      'inventario.html':      'inventario',
      'planificacion.html':   'planificacion',
      'capacidad.html':       'capacidad',
      'madera.html':          'madera',
      'tercerizados.html':    'tercerizados-dyn',
      'informes.html':        (function(){ var v = new URLSearchParams(location.search).get('vista'); return v === 'facturas' ? 'facturas' : v === 'lean' ? 'lean' : 'costos'; })(),
    };
    return map[PAGE] || null;
  }

  // ── 5. Estado de grupos colapsables ────────────────────────────────
  function isGroupOpen(id, defaultOpen) {
    var stored = localStorage.getItem('sb_group_' + id);
    if (stored !== null) return stored === '1';
    return !!defaultOpen;
  }
  function toggleGroup(id) {
    var cur = isGroupOpen(id, true);
    localStorage.setItem('sb_group_' + id, cur ? '0' : '1');
    inject();
  }
  window._sbToggleGroup = toggleGroup;

  // ── 6. Buscar active en el árbol (para has-active en padres) ───────
  function findActiveInChildren(children, activeId) {
    for (var i = 0; i < children.length; i++) {
      var c = children[i];
      if (c.id === activeId) return true;
      if (c.id && activeId && activeId.startsWith('prov-') && c.id.startsWith('prov-') && c.page && PAGE === 'tercerizados.html') return true;
      if (c.group && c.children && findActiveInChildren(c.children, activeId)) return true;
    }
    return false;
  }

  // ── 7. Construir ícono ─────────────────────────────────────────────
  function iconHtml(item) {
    if (item.iconSvg) {
      return '<span class="nav-icon" style="display:inline-flex;align-items:center;justify-content:center;"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + item.iconSvg + '</svg></span>';
    }
    return '<span class="nav-icon">' + (item.icon || '') + '</span>';
  }

  // ── 8. Renderizar un item ──────────────────────────────────────────
  function renderItem(item, activeId, depth) {
    if (item.type === 'sep') {
      return '<div class="nav-sep"></div>';
    }
    if (!item.roles || !item.roles.includes(rol)) return '';
    if (item.hidden) return '';

    var pad = 16 + (depth || 0) * 14;

    if (item.group) {
      var children = (item.children || []).filter(function(c){ return !c.type && (!c.roles || c.roles.includes(rol)) && !c.hidden; });
      var open = isGroupOpen(item.id, item.defaultOpen);
      var hasActive = findActiveInChildren(children, activeId);
      // Si un hijo está activo, forzar abierto
      if (hasActive) open = true;
      var arrow = item.collapsible ? '<span class="nav-group-arrow' + (open ? ' open' : '') + '" onclick="_sbToggleGroup(\'' + item.id + '\');event.stopPropagation();event.preventDefault();return false;" style="padding:4px 8px;margin:-4px -8px;cursor:pointer;">\u25B8</span>' : '';
      var hdrCls = 'nav-item nav-group-header' + (hasActive ? ' has-active' : '');
      var html;
      if (item.navigable && (item.section || item.page)) {
        // Grupo navegable: clic en header navega, caret solo toggle
        if (ON_ADMIN && item.section) {
          html = '<div class="' + hdrCls + '" style="padding-left:' + pad + 'px;" onclick="navTo(\'' + item.section + '\')">' + iconHtml(item) + ' ' + item.label + arrow + '</div>';
        } else if (!ON_ADMIN && item.section) {
          html = '<a href="admin.html#' + item.section + '" style="text-decoration:none;"><div class="' + hdrCls + '" style="padding-left:' + pad + 'px;">' + iconHtml(item) + ' ' + item.label + arrow + '</div></a>';
        } else if (item.page) {
          html = '<a href="' + item.page + '" style="text-decoration:none;"><div class="' + hdrCls + '" style="padding-left:' + pad + 'px;">' + iconHtml(item) + ' ' + item.label + arrow + '</div></a>';
        }
      } else {
        // Grupo no navegable: clic en todo el header toggle
        var onclick = item.collapsible ? ' onclick="_sbToggleGroup(\'' + item.id + '\')"' : '';
        html = '<div class="' + hdrCls + '" style="padding-left:' + pad + 'px;"' + onclick + '>' + iconHtml(item) + ' ' + item.label + arrow + '</div>';
      }
      if (open || !item.collapsible) {
        html += '<div class="nav-group-body" id="sb-grp-' + item.id + '">';
        for (var i = 0; i < children.length; i++) {
          html += renderItem(children[i], activeId, (depth || 0) + 1);
        }
        html += '</div>';
      }
      return html;
    }

    var isActive = item.id === activeId;
    // Tercerizados dinámicos: match por page
    if (!isActive && item.id && item.id.startsWith('prov-') && PAGE === 'tercerizados.html') {
      var sp = new URLSearchParams(location.search);
      var provId = sp.get('prov_id') || sp.get('prov');
      if (provId && item.page && item.page.indexOf(provId) !== -1) isActive = true;
    }
    var cls = 'nav-item' + (depth > 0 ? ' nav-sub-item' : '') + (isActive ? ' active' : '');
    var ico = iconHtml(item);

    if (item.external) {
      return '<a href="' + (item.url || item.href) + '" target="_blank" rel="noopener" style="text-decoration:none;"><div class="' + cls + '" style="padding-left:' + pad + 'px;" id="nav-' + item.id + '">' + ico + ' ' + item.label + ' <span style="font-size:9px;opacity:.5;">\u2197</span></div></a>';
    } else if (ON_ADMIN && item.section) {
      return '<div class="' + cls + '" style="padding-left:' + pad + 'px;" id="nav-' + item.id + '" onclick="navTo(\'' + item.section + '\')">' + ico + ' ' + item.label + '</div>';
    } else if (ON_ADMIN && item.page && item.page !== 'admin.html') {
      return '<a href="' + item.page + '" style="text-decoration:none;"><div class="' + cls + '" style="padding-left:' + pad + 'px;" id="nav-' + item.id + '">' + ico + ' ' + item.label + '</div></a>';
    } else if (!ON_ADMIN && item.section) {
      return '<a href="admin.html#' + item.section + '" style="text-decoration:none;"><div class="' + cls + '" style="padding-left:' + pad + 'px;" id="nav-' + item.id + '">' + ico + ' ' + item.label + '</div></a>';
    } else if (!ON_ADMIN && item.page === PAGE) {
      return '<div class="' + cls + ' active" style="padding-left:' + pad + 'px;" id="nav-' + item.id + '">' + ico + ' ' + item.label + '</div>';
    } else if (item.page) {
      return '<a href="' + item.page + '" style="text-decoration:none;"><div class="' + cls + '" style="padding-left:' + pad + 'px;" id="nav-' + item.id + '">' + ico + ' ' + item.label + '</div></a>';
    }
    return '';
  }

  function buildNavItems() {
    var activeId = getActiveId();
    return NAV_ITEMS.map(function(item) { return renderItem(item, activeId, 0); }).join('');
  }

  // ── 9. Inyectar sidebar en #sidebar-root ──────────────────────────
  function inject() {
    var root = document.getElementById('sidebar-root');
    if (!root) return;

    var sess = (function(){
      try { return JSON.parse(localStorage.getItem('mble_session') || sessionStorage.getItem('mble_session') || '{}'); }
      catch(e) { return {}; }
    })();
    if (!sess.rol_app) { root.innerHTML = ''; return; }

    root.innerHTML = '<aside class="sidebar">'
      + '<div class="sidebar-logo"><a href="admin.html" style="text-decoration:none;color:inherit;">\u2B21 MADERABLE</a></div>'
      + '<div style="flex:1;padding:8px 0;overflow-y:auto;">'
      + buildNavItems()
      + '</div>'
      + '<div style="padding:12px 16px;border-top:1px solid var(--border);font-size:11px;color:var(--muted);">'
      + '  <div class="mono" style="font-size:10px;margin-bottom:6px;">VISTA PLANTA</div>'
      + '  <a href="planta2.html" target="_blank" style="color:var(--green);font-family:\'Space Mono\',monospace;font-size:11px;font-weight:700;text-decoration:none;display:block;">Planta v2 \u2192</a>'
      + '</div>'
      + '<div id="sidebar-user-block" style="padding:12px 16px 16px;border-top:0.5px solid var(--border);">'
      + '  <div style="display:flex;align-items:center;gap:9px;margin-bottom:4px;">'
      + '    <div id="sidebar-avatar" style="width:24px;height:24px;border-radius:50%;background:#FFD600;display:flex;align-items:center;justify-content:center;font-family:\'Space Mono\',monospace;font-size:9px;font-weight:700;color:#000;flex-shrink:0;letter-spacing:0;">' + iniciales + '</div>'
      + '    <span id="sidebar-nombre" style="font-family:\'Space Mono\',monospace;font-size:12px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + nombre + '</span>'
      + '  </div>'
      + '  <div id="sidebar-rol" style="font-family:\'Space Mono\',monospace;font-size:11px;color:#888;margin-bottom:10px;padding-left:33px;">' + rol + '</div>'
      + '  <button onclick="window.AUTH && window.AUTH.cerrarSesion()" style="width:100%;background:transparent;border:0.5px solid var(--border);border-radius:5px;padding:8px 10px;color:#aaa;cursor:pointer;font-size:11px;font-family:\'Space Mono\',monospace;text-align:left;transition:color 0.15s,border-color 0.15s;" onmouseover="this.style.color=\'#FFD600\';this.style.borderColor=\'#FFD600\';" onmouseout="this.style.color=\'#aaa\';this.style.borderColor=\'var(--border)\';">\u21AA Cerrar sesi\u00f3n</button>'
      + '</div>'
      + '</aside>';

    if (!document.getElementById('sidebar-styles')) {
      var style = document.createElement('style');
      style.id = 'sidebar-styles';
      style.textContent = ''
        + '.sidebar{width:200px;background:var(--panel);border-right:1px solid var(--border);display:flex;flex-direction:column;flex-shrink:0;}'
        + '.sidebar-logo{padding:18px 16px;border-bottom:1px solid var(--border);font-family:"Space Mono",monospace;font-size:13px;font-weight:700;color:var(--amber);letter-spacing:2px;}'
        + '.nav-item{display:flex;align-items:center;gap:10px;padding:11px 16px;cursor:pointer;font-size:13px;color:var(--muted);border-left:3px solid transparent;transition:all .15s;user-select:none;}'
        + '.nav-item:hover{background:var(--faint);color:var(--text);}'
        + '.nav-item.active{background:rgba(245,166,35,.08);color:var(--amber);border-left-color:var(--amber);font-weight:600;}'
        + '.nav-icon{font-size:15px;width:20px;text-align:center;flex-shrink:0;}'
        + '.nav-sep{height:1px;background:var(--border);margin:6px 16px;}'
        + '.nav-group-header{cursor:pointer;opacity:.75;font-size:10px;letter-spacing:1px;text-transform:uppercase;}'
        + '.nav-group-header.has-active{opacity:1;color:var(--amber);}'
        + '.nav-group-header:hover{background:var(--faint);color:var(--muted);opacity:1;}'
        + '.nav-group-arrow{margin-left:auto;font-size:9px;opacity:.5;transition:transform .15s;display:inline-block;}'
        + '.nav-group-arrow.open{transform:rotate(90deg);}'
        + '.nav-group-body{}'
        + '.nav-sub-item{font-size:11px;}'
        + '@media(max-width:700px){.sidebar{display:none;}}';
      document.head.appendChild(style);
    }
  }

  // ── 10. Cargar tercerizados dinámico ────────────────────────────────
  function cargarTercerizados() {
    fetch('/api/tiempos?action=proveedores-terceros')
      .then(function(r){ return r.json(); })
      .then(function(r){
        if (!r.ok || !r.proveedores || !r.proveedores.length) return;
        // Encontrar tercerizados-group en el árbol
        var logGrp = NAV_ITEMS.find(function(it){ return it.id === 'logistica-group'; });
        if (!logGrp || !logGrp.children) return;
        var tercGrp = logGrp.children.find(function(it){ return it.id === 'tercerizados-group'; });
        if (!tercGrp) return;
        tercGrp.children = r.proveedores.map(function(p){
          return {
            id: 'prov-' + p.id,
            icon: '✦',
            label: p.nombre,
            page: 'tercerizados.html?prov=' + encodeURIComponent(p.nombre) + '&prov_id=' + p.id,
            roles: ['admin','oficina']
          };
        });
        inject();
      })
      .catch(function(){});
  }

  // ── 11. API publica ────────────────────────────────────────────────
  window.sidebarSetActive = function(id) {
    document.querySelectorAll('.nav-item').forEach(function(el) { el.classList.remove('active'); });
    var el = document.getElementById('nav-' + id);
    if (el) el.classList.add('active');
  };

  window.sidebarUpdateUser = function(u) {
    if (!u) return;
    var ini = u.nombre ? u.nombre.split(' ').map(function(p){return p[0];}).join('').slice(0,2).toUpperCase() : '??';
    var av = document.getElementById('sidebar-avatar');
    var nm = document.getElementById('sidebar-nombre');
    var rl = document.getElementById('sidebar-rol');
    if (av) av.textContent = ini;
    if (nm) nm.textContent = u.nombre || '';
    if (rl) rl.textContent = u.rol_app || '';
  };

  // ── Badge de retrabajos solicitados ────────────────────────────────
  function pintarBadgeRetrabajos() {
    var el = document.getElementById('nav-retrabajos');
    if (!el) return;
    fetch('/api/retrabajo?action=listar-piezas-retrabajo')
      .then(function(r){ return r.json(); })
      .then(function(r){
        var n = (r.piezas || []).filter(function(p){ return p.estado === 'solicitada'; }).length;
        var old = el.querySelector('.rt-badge');
        if (old) old.remove();
        if (!n) return;
        var b = document.createElement('span');
        b.className = 'rt-badge';
        b.textContent = n;
        b.style.cssText = 'margin-left:auto;background:#FFD600;color:#000;font-family:monospace;font-size:10px;font-weight:700;min-width:18px;height:18px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;padding:0 5px;';
        el.appendChild(b);
      })
      .catch(function(){});
  }
  window.pintarBadgeRetrabajos = pintarBadgeRetrabajos;

  // ── 12. Iniciar ────────────────────────────────────────────────────
  function init() {
    inject();
    pintarBadgeRetrabajos();
    cargarTercerizados();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  setInterval(function(){ pintarBadgeRetrabajos(); }, 60000);
})();
