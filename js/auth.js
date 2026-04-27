window.AUTH = {
  KEY: 'mble_session',

  guardarSesion(usuario) {
    sessionStorage.setItem(this.KEY, JSON.stringify(usuario));
  },

  usuarioActual() {
    const raw = sessionStorage.getItem(this.KEY);
    return raw ? JSON.parse(raw) : null;
  },

  cerrarSesion() {
    sessionStorage.removeItem(this.KEY);
    window.location.href = '/admin.html';
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
  }
};
