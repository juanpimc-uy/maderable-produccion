// js/kiosco-modo.js — Modo kiosco para ventanas de oficina abiertas desde planta-kioscos.html
// Con sessionStorage.kiosco_origen === '1':
//   1) oculta el sidebar (#sidebar-root) para que el operario no navegue a otras secciones
//   2) inyecta un botón fijo "← VOLVER AL KIOSCO" que cierra SOLO la sesión de esta ventana
//      y vuelve al kiosco (deja viva kiosco_sesion → el operario cae en el menú sin re-PIN)
// Sin el flag NO hace nada.
(function () {
  if (sessionStorage.getItem('kiosco_origen') !== '1') return;

  var KIOSCO_URL = '/planta-kioscos.html';

  // 1) Ocultar sidebar lo antes posible (evita flash antes del paint)
  var st = document.createElement('style');
  st.textContent = '#sidebar-root{display:none!important}';
  (document.head || document.documentElement).appendChild(st);

  // 2) Botón volver
  function montarBoton() {
    if (document.getElementById('kiosco-volver-btn')) return;
    var b = document.createElement('button');
    b.id = 'kiosco-volver-btn';
    b.type = 'button';
    b.textContent = '\u2190 VOLVER AL KIOSCO';
    b.style.cssText = [
      'position:fixed', 'left:16px', 'bottom:16px', 'z-index:2147483647',
      'background:#0f0f0f', 'color:#FFD600', 'border:2px solid #FFD600',
      'font-family:"Space Mono",monospace', 'font-size:14px', 'font-weight:700',
      'text-transform:uppercase', 'letter-spacing:1px', 'padding:14px 20px',
      'border-radius:8px', 'cursor:pointer', 'min-height:48px',
      'box-shadow:0 4px 16px rgba(0,0,0,.5)'
    ].join(';');
    b.addEventListener('click', function () {
      sessionStorage.removeItem('mble_session');
      localStorage.removeItem('mble_session');
      sessionStorage.removeItem('kiosco_origen');
      if (window.opener && !window.opener.closed) { window.close(); }
      else { window.location.href = KIOSCO_URL; }
    });
    document.body.appendChild(b);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', montarBoton);
  } else {
    montarBoton();
  }
})();
