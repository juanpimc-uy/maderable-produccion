window.AUTH = {
  KEY: 'mble_session',

  guardarSesion(usuario) {
    // Role-aware: admin/oficina persist in localStorage; operario in sessionStorage
    const store = (usuario.rol_app === 'admin' || usuario.rol_app === 'oficina') ? localStorage : sessionStorage;
    store.setItem(this.KEY, JSON.stringify(usuario));
    // Clear the other store to avoid stale sessions
    const other = store === localStorage ? sessionStorage : localStorage;
    other.removeItem(this.KEY);
  },

  usuarioActual() {
    // Read localStorage first (admin/oficina), fallback to sessionStorage (operario)
    const raw = localStorage.getItem(this.KEY) || sessionStorage.getItem(this.KEY);
    return raw ? JSON.parse(raw) : null;
  },

  cerrarSesion() {
    localStorage.removeItem(this.KEY);
    sessionStorage.removeItem(this.KEY);
    window.location.href = '/admin.html';
  },

  getSessionToken() {
    const u = this.usuarioActual();
    return u?.session_token || '';
  },

  getSession() {
    return this.usuarioActual();
  },

  esAdmin() {
    const u = this.usuarioActual();
    return u && u.rol_app === 'admin';
  },

  esOficina() {
    const u = this.usuarioActual();
    return u && u.rol_app === 'oficina';
  },

  puedeEntrarAAdmin() {
    const u = this.usuarioActual();
    return u && (u.rol_app === 'admin' || u.rol_app === 'oficina');
  },

  requireAdmin() {
    if (!this.usuarioActual()) {
      window.location.href = '/admin.html';
      return false;
    }
    if (!this.puedeEntrarAAdmin()) {
      alert('Tu rol no permite acceso a esta pantalla');
      window.location.href = '/planta2.html';
      return false;
    }
    return true;
  },

  _sessionExpired: false,

  showSessionExpired() {
    if (this._sessionExpired) return;
    this._sessionExpired = true;
    const banner = document.createElement('div');
    banner.id = 'session-expired-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#1a0a0a;border-bottom:2px solid #ef4444;padding:12px 20px;display:flex;align-items:center;justify-content:center;gap:12px;font-family:"Space Mono",monospace;font-size:12px;color:#ef4444;';
    banner.innerHTML = '\u26a0 Sesión expirada — <a href="/admin.html" style="color:#FFD600;text-decoration:underline;font-weight:700;">Volver a ingresar</a>';
    document.body.prepend(banner);
    document.querySelectorAll('button.btn-sm,button.btn-load,button.btn-completar,button.btn-confirmar,.btn.btn-primary,.btn.btn-success').forEach(b => { b.disabled = true; b.style.opacity = '.3'; });
  },

  async checkSession() {
    const token = this.getSessionToken();
    if (!token) return false;
    try {
      const res = await fetch('/api/tiempos?action=check-session&session_token=' + encodeURIComponent(token));
      if (res.status === 401) { this.showSessionExpired(); return false; }
      const data = await res.json();
      return !!data.ok;
    } catch (e) { return true; }
  },

  wrapFetch(originalFetch) {
    const self = this;
    return async function(url, opts) {
      const res = await originalFetch.call(window, url, opts);
      if (res.status === 401) {
        const clone = res.clone();
        try {
          const data = await clone.json();
          if (data.error && /sesión|session|expirad/i.test(data.error)) {
            self.showSessionExpired();
          }
        } catch(e) {}
      }
      return res;
    };
  }
};

// Helper for pages that don't load auth.js but read mble_session directly
// They can call _getMbleSession() instead of parsing sessionStorage
function _getMbleSession() {
  try { return JSON.parse(localStorage.getItem('mble_session') || sessionStorage.getItem('mble_session') || '{}'); }
  catch(e) { return {}; }
}
