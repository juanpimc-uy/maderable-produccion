// sidebar.js — Componente compartido MBLE ERP
// Inyecta el sidebar en <div id="sidebar-root"> y maneja nav activo y roles.
(function () {
  // ── 1. Detectar pagina actual ──────────────────────────────────────
  const PAGE = (location.pathname.split('/').pop() || 'admin.html').toLowerCase();
  const ON_ADMIN = PAGE === 'admin.html' || PAGE === '' || PAGE === 'index.html';

  // ── 2. Definicion de items de nav ──────────────────────────────────
  const GEAR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

  const NAV_ITEMS = [
    { id: 'dashboard',    icon: '◈', label: 'Dashboard',    page: 'admin.html',         section: 'dashboard',  roles: ['admin', 'oficina'] },
    { id: 'proyectos',    icon: '▦', label: 'Proyectos',    page: 'admin.html',         section: 'proyectos',  roles: ['admin', 'oficina'] },
    { id: 'operarios',    icon: '◎', label: 'Operarios',    page: 'admin.html',         section: 'operarios',  roles: ['admin'] },
    { id: 'tiempos',      icon: '⏱', label: 'Tiempos',      page: 'tiempos.html',       section: null,         roles: ['admin', 'oficina'] },
    { id: 'materiales-group', icon: '▣', label: 'Materiales', group: true, roles: ['admin', 'oficina'], children: [
      { id: 'armado-so',   icon: '⬗', label: 'Armado SO',   page: 'armado-so.html',      section: null, roles: ['admin', 'oficina'] },
      { id: 'recepciones', icon: '◫', label: 'Recepciones', page: 'recepciones-oc.html', section: null, roles: ['admin', 'oficina'] },
    ]},
    { id: 'tercerizados', icon: '🧵', label: 'Tercerizados', page: 'tercerizados.html',  section: null,         roles: ['admin', 'oficina'] },
    { id: 'stock',        icon: '⬡', label: 'Stock Placas', page: 'stock-placas.html',  section: null,         roles: ['admin', 'oficina'], hidden: true },
    { id: 'despacho',     icon: '⇥', label: 'Despacho',     page: 'despacho.html',      section: null,         roles: ['admin', 'oficina'] },
    { id: 'ajustes',      icon: GEAR_SVG, label: 'Ajustes', page: 'admin.html',         section: 'ajustes',    roles: ['admin'], iconIsHtml: true },
    { id: 'mi-cuenta',    icon: '◉', label: 'Mi cuenta',    page: 'admin.html',         section: 'mi-cuenta',  roles: ['admin', 'oficina'] },
  ];

  // ── 3. Leer sesion ─────────────────────────────────────────────────
  let session = {};
  try { session = JSON.parse(sessionStorage.getItem('mble_session') || '{}'); } catch(e) {}
  const rol = session.rol_app || session.rol || 'admin';
  const nombre = session.nombre || session.name || '';
  const iniciales = nombre ? nombre.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() : '??';

  // ── 4. Determinar item activo ──────────────────────────────────────
  function getActiveId() {
    if (ON_ADMIN) return null; // admin.html lo gestiona via navTo
    const map = {
      'tiempos.html':        'tiempos',
      'materiales.html':     'materiales',
      'tercerizados.html':   'tercerizados',
      'stock-placas.html':   'stock',
      'armado-so.html':      'armado-so',
      'armado-so-planta.html':'armado-so',
      'recepciones-oc.html': 'recepciones',
      'despacho.html':       'despacho',
      'config-formula.html': 'materiales',
    };
    return map[PAGE] || null;
  }

  // ── 5. Construir HTML de los nav-items ─────────────────────────────
  function renderNavItem(item, activeId, isSub) {
    const isActive = item.id === activeId;
    const iconHtml = item.iconIsHtml
      ? '<span class="nav-icon" style="display:inline-flex;align-items:center;justify-content:center;">' + item.icon + '</span>'
      : '<span class="nav-icon">' + item.icon + '</span>';
    const cls = 'nav-item' + (isSub ? ' nav-sub-item' : '') + (isActive ? ' active' : '');

    if (ON_ADMIN && item.section) {
      return '<div class="' + cls + '" id="nav-' + item.id + '" onclick="navTo(\'' + item.section + '\')">' + iconHtml + ' ' + item.label + '</div>';
    } else if (ON_ADMIN && item.page !== 'admin.html') {
      return '<a href="' + item.page + '" style="text-decoration:none;"><div class="' + cls + '" id="nav-' + item.id + '">' + iconHtml + ' ' + item.label + '</div></a>';
    } else if (!ON_ADMIN && item.section) {
      return '<a href="admin.html#' + item.section + '" style="text-decoration:none;"><div class="' + cls + '" id="nav-' + item.id + '">' + iconHtml + ' ' + item.label + '</div></a>';
    } else if (!ON_ADMIN && item.page === PAGE) {
      return '<div class="' + cls.replace(isActive ? '' : 'x', '') + ' active" id="nav-' + item.id + '">' + iconHtml + ' ' + item.label + '</div>';
    } else {
      return '<a href="' + item.page + '" style="text-decoration:none;"><div class="' + cls + '" id="nav-' + item.id + '">' + iconHtml + ' ' + item.label + '</div></a>';
    }
  }

  function buildNavItems() {
    const activeId = getActiveId();
    return NAV_ITEMS
      .filter(item => !item.hidden && item.roles.includes(rol))
      .map(item => {
        if (item.group) {
          const children = (item.children || []).filter(c => !c.hidden && c.roles.includes(rol));
          const childActive = children.some(c => c.id === activeId);
          const iconHtml = '<span class="nav-icon">' + item.icon + '</span>';
          var html = '<div class="nav-item nav-group-header' + (childActive ? ' active' : '') + '">' + iconHtml + ' ' + item.label + ' <span style="margin-left:auto;font-size:9px;opacity:.5;">\u25BE</span></div>';
          html += children.map(c => renderNavItem(c, activeId, true)).join('\n    ');
          return html;
        }
        return renderNavItem(item, activeId, false);
      }).join('\n    ');
  }

  // ── 6. Inyectar sidebar en #sidebar-root ──────────────────────────
  function inject() {
    const root = document.getElementById('sidebar-root');
    if (!root) return;

    root.innerHTML = '<aside class="sidebar">'
      + '<div class="sidebar-logo"><a href="admin.html" style="text-decoration:none;color:inherit;">\u2B21 MADERABLE</a></div>'
      + '<div style="flex:1;padding:8px 0;overflow-y:auto;">'
      + '    ' + buildNavItems()
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

    // Inyectar CSS si no existe
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
        + '.nav-group-header{cursor:default;opacity:.75;font-size:10px;letter-spacing:1px;text-transform:uppercase;}'
        + '.nav-group-header.active{opacity:1;color:var(--amber);}'
        + '.nav-group-header:hover{background:transparent;color:var(--muted);}'
        + '.nav-sub-item{padding-left:28px !important;font-size:11px;}'
        + '@media(max-width:700px){.sidebar{display:none;}}';
      document.head.appendChild(style);
    }
  }

  // ── 7. API publica ─────────────────────────────────────────────────
  window.sidebarSetActive = function(id) {
    document.querySelectorAll('.nav-item').forEach(function(el) { el.classList.remove('active'); });
    var el = document.getElementById('nav-' + id);
    if (el) el.classList.add('active');
  };

  // Actualizar user block (llamado por AUTH despues de login)
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

  // ── 8. Iniciar ─────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
