/**
 * Sesión del usuario y llamadas autenticadas a la API - Z-BARBER
 */

const Auth = {
  TOKEN_KEY: 'zbarber_token',
  USER_KEY: 'zbarber_user',

  guardar(token, user) {
    localStorage.setItem(this.TOKEN_KEY, token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  },

  token() {
    return localStorage.getItem(this.TOKEN_KEY);
  },

  usuario() {
    try {
      return JSON.parse(localStorage.getItem(this.USER_KEY));
    } catch {
      return null;
    }
  },

  rutaInicio(user) {
    return user?.rol === 'admin' ? '/' : '/cliente.html';
  },

  cerrarSesion() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    window.location.replace('/login.html');
  }
};

// Redirige al login si no hay sesión, o a su panel si el rol no corresponde a esta página
window.requireSession = function(rolPermitido) {
  const user = Auth.usuario();
  if (!Auth.token() || !user) {
    window.location.replace('/login.html');
    return null;
  }
  if (rolPermitido && user.rol !== rolPermitido) {
    window.location.replace(Auth.rutaInicio(user));
    return null;
  }
  return user;
};

window.apiFetch = async function(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = Auth.token();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    Auth.cerrarSesion();
    throw new Error('Sesión expirada');
  }
  return res;
};

window.Auth = Auth;
