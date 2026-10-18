/**
 * Pantalla de Inicio de Sesión y Registro de Clientes - Z-BARBER
 */

(function() {
  const sesionActual = Auth.usuario();
  if (Auth.token() && sesionActual) {
    window.location.replace(Auth.rutaInicio(sesionActual));
    return;
  }

  const errorBox = document.getElementById('auth-error');
  const formLogin = document.getElementById('form-login');
  const formRegistro = document.getElementById('form-registro');

  function mostrarError(mensaje) {
    errorBox.textContent = mensaje;
    errorBox.style.display = mensaje ? 'block' : 'none';
  }

  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const esLogin = tab.dataset.tab === 'login';
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t === tab));
      formLogin.style.display = esLogin ? 'block' : 'none';
      formRegistro.style.display = esLogin ? 'none' : 'block';
      mostrarError('');
    });
  });

  async function enviar(url, payload) {
    mostrarError('');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok) {
        mostrarError(data.message || 'No se pudo completar la operación');
        return;
      }

      Auth.guardar(data.token, data.user);
      window.location.replace(Auth.rutaInicio(data.user));
    } catch (err) {
      mostrarError('Error conectando con el servidor');
    }
  }

  formLogin.addEventListener('submit', (e) => {
    e.preventDefault();
    enviar('/api/auth/login', {
      usuario: document.getElementById('login-usuario').value.trim(),
      password: document.getElementById('login-password').value
    });
  });

  formRegistro.addEventListener('submit', (e) => {
    e.preventDefault();
    enviar('/api/auth/registro', {
      nombre: document.getElementById('reg-nombre').value.trim(),
      telefono: document.getElementById('reg-telefono').value.trim(),
      email: document.getElementById('reg-email').value.trim(),
      usuario: document.getElementById('reg-usuario').value.trim(),
      password: document.getElementById('reg-password').value
    });
  });
})();
