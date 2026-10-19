/**
 * ==============================================================================
 * PANEL DE ADMINISTRACIÓN - Z-BARBER (main.js)
 * ==============================================================================
 * Este archivo es el "cerebro" visual de la aplicación web:
 * 1. Controla la sesión (solo permite entrar si eres el Administrador/dueño).
 * 2. Administra la navegación entre pantallas (Dashboard, Reservas, Clientes,
 *    Servicios, Barberos, Finanzas, etc.) sin recargar toda la página.
 * 3. Mantiene en memoria (`AppState`) la información fresca descargada del servidor.
 * 4. Gestiona los formularios para crear y editar datos (CRUD).
 * ==============================================================================
 */

const API_BASE = '/api';

/**
 * ESTADO DE LA APLICACIÓN (AppState)
 * ------------------------------------------------------------------------------
 * Funciona como una libreta de notas en la memoria del navegador donde guardamos:
 * - activeView: Qué pantalla está viendo el administrador en este momento.
 * - user: Los datos del administrador que inició sesión.
 * - reservas, clientes, servicios, barberos: Listas completas de datos.
 * - reportes: Totales de ingresos, gastos y ganancias.
 */
const AppState = {
  activeView: 'dashboard',
  user: null,
  reservas: [],
  clientes: [],
  servicios: [],
  barberos: [],
  reportes: null
};

// PUNTO DE ENTRADA: Se ejecuta automáticamente cuando la página termina de cargar
document.addEventListener('DOMContentLoaded', () => {
  // 1. Validar que el usuario tenga sesión abierta y sea administrador
  AppState.user = requireSession('admin');
  if (!AppState.user) return; // Si no tiene permiso, requireSession lo redirige al login

  // 2. Colocar el nombre del administrador y la fecha de hoy en la cabecera
  document.getElementById('sidebar-user').textContent = `${AppState.user.nombre_completo} (Admin)`;
  document.getElementById('btn-logout').addEventListener('click', () => Auth.cerrarSesion());
  document.getElementById('fecha-hoy').textContent = new Date().toLocaleDateString('es-BO', { day: 'numeric', month: 'long', year: 'numeric' });

  // 3. Encender los componentes del sistema
  initNavigation();   // Enlazar los botones del menú lateral
  initModals();       // Preparar las ventanas emergentes (modales)
  initCrudForms();    // Preparar el envío de formularios
  initReportes();     // Preparar los filtros de fechas de finanzas
  loadInitialData();  // Descargar los datos reales desde la base de datos MySQL

  // 4. Cada 1 minuto revisa si entraron pagos nuevos o si expiró alguna reserva
  setInterval(() => {
    if (!document.querySelector('.modal-overlay.active')) loadInitialData();
  }, 60 * 1000);
});

function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      switchView(item.dataset.view);
    });
  });

  document.getElementById('buscador-global')?.addEventListener('input', () => {
    if (AppState.activeView !== 'reservas') switchView('reservas');
    else window.renderReservas?.();
  });
}

function switchView(viewName) {
  AppState.activeView = viewName;
  document.querySelectorAll('.nav-item').forEach(i => {
    i.classList.toggle('active', i.dataset.view === viewName);
  });

  document.querySelectorAll('.view-section').forEach(sec => {
    sec.style.display = sec.id === `view-${viewName}` ? 'block' : 'none';
  });

  if (viewName === 'dashboard') {
    window.renderDashboard?.();
  } else if (viewName === 'reservas') {
    window.renderReservas?.();
  } else if (viewName === 'servicios') {
    renderServicios();
  } else if (viewName === 'barberos') {
    renderBarberos();
  } else if (viewName === 'clientes') {
    renderClientes();
  } else if (viewName === 'finanzas' || viewName === 'reportes') {
    renderFinanzas();
  } else if (viewName === 'configuracion') {
    window.renderConfiguracion?.();
  }
}

function initModals() {
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', cerrarModales);
  });

  document.getElementById('btn-open-new-client')?.addEventListener('click', () => {
    document.getElementById('form-nuevo-cliente')?.reset();
    document.getElementById('modal-nuevo-cliente').classList.add('active');
  });

  document.getElementById('btn-open-new-service')?.addEventListener('click', () => {
    document.getElementById('modal-nuevo-servicio').classList.add('active');
  });

  document.getElementById('btn-open-new-barber')?.addEventListener('click', () => {
    document.getElementById('modal-nuevo-barbero').classList.add('active');
  });

  document.getElementById('btn-cambiar-password')?.addEventListener('click', () => {
    document.getElementById('form-cambiar-password')?.reset();
    document.getElementById('modal-cambiar-password').classList.add('active');
  });
}

async function loadInitialData() {
  try {
    const hoy = fechaHoyLocal();
    const [resRes, cliRes, servRes, barbRes, repHoy] = await Promise.all([
      apiFetch(`${API_BASE}/reservas`).then(r => r.json()).catch(() => ({ data: [] })),
      apiFetch(`${API_BASE}/clientes`).then(r => r.json()).catch(() => ({ data: [] })),
      apiFetch(`${API_BASE}/servicios`).then(r => r.json()).catch(() => ({ data: [] })),
      apiFetch(`${API_BASE}/barberos`).then(r => r.json()).catch(() => ({ data: [] })),
      apiFetch(`${API_BASE}/reportes?desde=${hoy}&hasta=${hoy}`).then(r => r.json()).catch(() => ({ data: null }))
    ]);

    AppState.reservas = resRes.data || [];
    AppState.clientes = cliRes.data || [];
    AppState.servicios = servRes.data || [];
    AppState.barberos = barbRes.data || [];
    AppState.reporteHoy = repHoy.data;

    actualizarBadgePagos();
    window.renderDashboard?.();
    if (AppState.activeView === 'reservas') window.renderReservas?.();
    renderServicios();
    renderBarberos();
    renderClientes();
  } catch (err) {
    console.warn('Error cargando datos de la API:', err);
  }
}

function actualizarBadgePagos() {
  const enRevision = AppState.reservas.filter(r => r.estado === 'en_revision').length;
  const badge = document.getElementById('badge-pagos');
  if (badge) {
    badge.textContent = enRevision;
    badge.style.display = enRevision > 0 ? 'inline-block' : 'none';
  }
}

/* ==========================================================
   CRUD DE SERVICIOS
   ========================================================== */
function renderServicios() {
  const tbody = document.getElementById('tbody-servicios');
  if (!tbody) return;

  if (AppState.servicios.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 24px;">No hay servicios registrados en la base de datos.</td></tr>`;
    return;
  }

  tbody.innerHTML = AppState.servicios.map(s => {
    const pendientes = s.reservas_pendientes || 0;
    const isActivo = s.estado !== 'inactivo';

    return `
      <tr>
        <td style="font-family: monospace; color: var(--text-muted);">#${s.id_servicio}</td>
        <td><strong>${escapeHtml(s.nombre_servicio)}</strong></td>
        <td style="color: var(--gold-bright); font-weight: bold;">${formatoBs(s.precio)}</td>
        <td>${s.precio_domicilio ? `<span style="color: var(--status-blue); font-weight: bold;">${formatoBs(s.precio_domicilio)}</span>` : '<span style="color: var(--text-muted);">—</span>'}</td>
        <td>${s.duracion_min} min</td>
        <td>${pendientes > 0 ? `<span class="badge badge-yellow">${pendientes} activa(s)</span>` : '<span style="color: var(--text-muted); font-size: 11px;">0 pendientes</span>'}</td>
        <td><span class="badge ${isActivo ? 'badge-green' : 'badge-red'}">${isActivo ? 'Activo' : 'En pausa'}</span></td>
        <td style="text-align: right;">
          <div class="acciones">
            <button class="btn-gold" style="padding: 4px 10px; font-size: 11px;" onclick="abrirEditarServicio(${s.id_servicio})">Editar</button>
            <button class="btn-accion" onclick="togglePausarServicio(${s.id_servicio})">${isActivo ? 'Pausar' : 'Activar'}</button>
            <button class="btn-accion rojo" onclick="eliminarServicio(${s.id_servicio})">Eliminar</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.abrirEditarServicio = function(id) {
  const s = AppState.servicios.find(item => item.id_servicio === id);
  if (!s) return;

  document.getElementById('edit-serv-id').value = s.id_servicio;
  document.getElementById('edit-serv-nombre').value = s.nombre_servicio;
  document.getElementById('edit-serv-precio').value = s.precio;
  document.getElementById('edit-serv-domicilio').value = s.precio_domicilio || 0;
  document.getElementById('edit-serv-duracion').value = s.duracion_min;

  document.getElementById('modal-editar-servicio').classList.add('active');
};

window.togglePausarServicio = async function(id) {
  const serv = AppState.servicios.find(s => s.id_servicio === id);
  if (!serv) return;

  try {
    const res = await apiFetch(`${API_BASE}/servicios/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre_servicio: serv.nombre_servicio,
        precio: serv.precio,
        duracion_min: serv.duracion_min,
        estado: serv.estado === 'activo' ? 'inactivo' : 'activo'
      })
    });
    const data = await res.json();
    if (!res.ok) alert('⚠️ ' + data.message);
    await loadInitialData();
  } catch (err) {
    console.error(err);
  }
};

window.eliminarServicio = async function(id) {
  const alertBox = document.getElementById('alert-servicios');
  if (alertBox) alertBox.style.display = 'none';

  if (!confirm('¿Estás seguro de que deseas eliminar este servicio?')) return;

  try {
    const res = await apiFetch(`${API_BASE}/servicios/${id}`, { method: 'DELETE' });
    const data = await res.json();

    if (!res.ok) {
      alertBox.textContent = `⚠️ VALIDACIÓN BLOQUEADA: ${data.message}`;
      alertBox.style.display = 'block';
      return;
    }

    alert('✅ ' + data.message);
    await loadInitialData();
  } catch (err) {
    alert('Error al intentar eliminar el servicio');
  }
};

/* ==========================================================
   CRUD DE BARBEROS Y MATRIZ DE HABILIDADES
   ========================================================== */
function renderBarberos() {
  const grid = document.getElementById('grid-barberos');
  if (grid) {
    grid.innerHTML = AppState.barberos.map(b => {
      const pendientes = b.citas_pendientes || 0;
      return `
        <div class="kpi-card" style="position: relative;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <h3 style="color: var(--gold-bright); font-size: 18px;">${escapeHtml(b.nombre)}</h3>
              <p style="font-size: 12px; color: var(--text-muted); margin: 4px 0;">${Number(b.anos_experiencia) || 0} años de experiencia | ${escapeHtml(b.sexo)}</p>
              <small style="color: var(--text-secondary);">${escapeHtml(b.telefono || 'Sin teléfono')}</small>
            </div>
            <button class="btn-accion rojo" onclick="eliminarBarbero(${b.id_barbero})">Eliminar</button>
          </div>
          <div style="margin-top: 12px; display: flex; justify-content: space-between; align-items: center;">
            <span class="badge ${b.estado === 'activo' ? 'badge-green' : 'badge-red'}">${escapeHtml(b.estado)}</span>
            <small style="color: ${pendientes > 0 ? 'var(--status-yellow)' : 'var(--text-muted)'}; font-weight: bold;">
              ${pendientes > 0 ? `${pendientes} citas activas` : '0 pendientes'}
            </small>
          </div>
        </div>
      `;
    }).join('');
  }

  renderMatrizHabilidades();
}

function renderMatrizHabilidades() {
  const theadTr = document.getElementById('thead-matriz-tr');
  const tbody = document.getElementById('tbody-matriz-habilidades');
  if (!theadTr || !tbody) return;

  theadTr.innerHTML = `
    <th>Servicio</th>
    <th>Precio</th>
    ${AppState.barberos.map(b => `<th style="text-align: center;">${escapeHtml(b.nombre)}</th>`).join('')}
  `;

  tbody.innerHTML = AppState.servicios.map(s => `
    <tr>
      <td><strong>${escapeHtml(s.nombre_servicio)}</strong></td>
      <td style="color: var(--gold-bright); font-weight: bold;">${formatoBs(s.precio)}</td>
      ${AppState.barberos.map(b => `
        <td style="text-align: center;">
          <input type="checkbox" style="cursor: pointer; width: 16px; height: 16px; accent-color: var(--gold-bright);" ${b.servicios_asignados?.includes(s.id_servicio) ? 'checked' : ''} onchange="toggleHabilidadBarbero(${b.id_barbero}, ${s.id_servicio})">
        </td>
      `).join('')}
    </tr>
  `).join('');
}

window.toggleHabilidadBarbero = async function(id_barbero, id_servicio) {
  const alertBox = document.getElementById('alert-barberos');
  if (alertBox) alertBox.style.display = 'none';

  try {
    const res = await apiFetch(`${API_BASE}/barberos/habilidad`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_barbero, id_servicio })
    });
    const data = await res.json();

    if (!res.ok) {
      alertBox.textContent = `⚠️ VALIDACIÓN BLOQUEADA: ${data.message}`;
      alertBox.style.display = 'block';
    }
    await loadInitialData();
  } catch (err) {
    alert('Error al modificar asignación de servicio');
  }
};

window.eliminarBarbero = async function(id) {
  const alertBox = document.getElementById('alert-barberos');
  if (alertBox) alertBox.style.display = 'none';

  if (!confirm('¿Estás seguro de que deseas eliminar este barbero?')) return;

  try {
    const res = await apiFetch(`${API_BASE}/barberos/${id}`, { method: 'DELETE' });
    const data = await res.json();

    if (!res.ok) {
      alertBox.textContent = `⚠️ VALIDACIÓN BLOQUEADA: ${data.message}`;
      alertBox.style.display = 'block';
      return;
    }

    alert('✅ ' + data.message);
    await loadInitialData();
  } catch (err) {
    alert('Error al intentar eliminar el barbero');
  }
};

/* ==========================================================
   FORMULARIOS DE CREACIÓN / EDICIÓN (LISTENERS)
   ========================================================== */
async function enviarFormulario(url, method, payload, mensajeOk, form) {
  try {
    const res = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (res.ok) {
      alert('✅ ' + (mensajeOk || data.message));
      cerrarModales();
      form?.reset();
      await loadInitialData();
    } else {
      alert('⚠️ ' + data.message);
    }
  } catch (err) {
    alert('Error conectando con la API');
  }
}

function initCrudForms() {
  const formNuevoServicio = document.getElementById('form-nuevo-servicio');
  formNuevoServicio?.addEventListener('submit', (e) => {
    e.preventDefault();
    enviarFormulario(`${API_BASE}/servicios`, 'POST', {
      nombre_servicio: document.getElementById('nuevo-serv-nombre').value,
      precio: Number(document.getElementById('nuevo-serv-precio').value),
      precio_domicilio: Number(document.getElementById('nuevo-serv-domicilio').value),
      duracion_min: Number(document.getElementById('nuevo-serv-duracion').value)
    }, 'Servicio creado con éxito', formNuevoServicio);
  });

  const formEditarServicio = document.getElementById('form-editar-servicio');
  formEditarServicio?.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-serv-id').value;
    enviarFormulario(`${API_BASE}/servicios/${id}`, 'PUT', {
      nombre_servicio: document.getElementById('edit-serv-nombre').value,
      precio: Number(document.getElementById('edit-serv-precio').value),
      precio_domicilio: Number(document.getElementById('edit-serv-domicilio').value),
      duracion_min: Number(document.getElementById('edit-serv-duracion').value)
    }, 'Servicio actualizado con éxito');
  });

  const formCambiarPassword = document.getElementById('form-cambiar-password');
  formCambiarPassword?.addEventListener('submit', (e) => {
    e.preventDefault();
    const password_actual = document.getElementById('pass-actual').value;
    const password_nueva = document.getElementById('pass-nueva').value;
    if (password_nueva !== document.getElementById('pass-confirmar').value) {
      alert('⚠️ La nueva contraseña y su confirmación no coinciden');
      return;
    }
    enviarFormulario(`${API_BASE}/auth/password`, 'PUT', { password_actual, password_nueva }, null, formCambiarPassword);
  });

  const formNuevoBarbero = document.getElementById('form-nuevo-barbero');
  formNuevoBarbero?.addEventListener('submit', (e) => {
    e.preventDefault();
    enviarFormulario(`${API_BASE}/barberos`, 'POST', {
      nombre: document.getElementById('nuevo-barb-nombre').value,
      sexo: document.getElementById('nuevo-barb-sexo').value,
      anos_experiencia: Number(document.getElementById('nuevo-barb-exp').value),
      telefono: document.getElementById('nuevo-barb-tel').value
    }, 'Barbero registrado con éxito', formNuevoBarbero);
  });

  // Formulario: Registro de un nuevo cliente
  const formNuevoCliente = document.getElementById('form-nuevo-cliente');
  formNuevoCliente?.addEventListener('submit', (e) => {
    e.preventDefault();
    enviarFormulario(`${API_BASE}/clientes`, 'POST', {
      nombre: document.getElementById('nuevo-cli-nombre').value,
      usuario: document.getElementById('nuevo-cli-usuario')?.value || null,
      telefono: document.getElementById('nuevo-cli-telefono').value,
      email: document.getElementById('nuevo-cli-email').value || null,
      notas: document.getElementById('nuevo-cli-notas').value || null
    }, 'Cliente registrado con éxito', formNuevoCliente);
  });

  // Formulario: Edición de datos personales de un cliente
  const formEditarCliente = document.getElementById('form-editar-cliente');
  formEditarCliente?.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-cli-id').value;
    enviarFormulario(`${API_BASE}/clientes/${id}`, 'PUT', {
      nombre: document.getElementById('edit-cli-nombre').value,
      usuario: document.getElementById('edit-cli-usuario')?.value || null,
      telefono: document.getElementById('edit-cli-telefono').value,
      email: document.getElementById('edit-cli-email').value || null,
      notas: document.getElementById('edit-cli-notas').value || null
    }, 'Cliente actualizado con éxito');
  });

  // Formulario: Resetear contraseña de cliente (Rol Administrador)
  const formResetPasswordCliente = document.getElementById('form-reset-password-cliente');
  formResetPasswordCliente?.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('reset-cli-id').value;
    const password = document.getElementById('reset-cli-password').value;
    const confirmar = document.getElementById('reset-cli-confirmar').value;

    if (password !== confirmar) {
      alert('⚠️ La nueva contraseña y su confirmación no coinciden.');
      return;
    }

    enviarFormulario(`${API_BASE}/clientes/${id}/password`, 'PUT', {
      password_nueva: password
    }, 'Contraseña del cliente actualizada con éxito', formResetPasswordCliente);
  });
}

/**
 * RENDERIZAR TABLA DE CLIENTES
 * ------------------------------------------------------------------------------
 * ¿Qué hace?
 * Dibuja cada fila en el Directorio de Clientes. Muestra su ID, nombre, usuario web
 * (si tiene), teléfono, email, número de visitas y los botones de acción (Editar, Clave, Eliminar).
 */
function renderClientes() {
  const tbody = document.getElementById('tbody-clientes');
  if (!tbody) return;

  if (AppState.clientes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">No hay clientes registrados.</td></tr>`;
    return;
  }

  tbody.innerHTML = AppState.clientes.map(c => `
    <tr>
      <td style="font-family: monospace; color: var(--text-muted);">#${String(c.id_cliente).padStart(3, '0')}</td>
      <td><strong>${escapeHtml(c.nombre)}</strong></td>
      <td>${c.nombre_usuario ? `<span style="color: var(--gold-bright); font-family: monospace; font-size: 12px; font-weight: 600;">@${escapeHtml(c.nombre_usuario)}</span>` : '<span style="color: var(--text-muted); font-size: 11px;">(Sin usuario)</span>'}</td>
      <td>${escapeHtml(c.telefono)}</td>
      <td>${escapeHtml(c.email || '—')}</td>
      <td>${Number(c.total_visitas) || 0}</td>
      <td style="text-align: right;">
        <div class="acciones">
          <button class="btn-gold" style="padding: 4px 10px; font-size: 11px;" onclick="abrirEditarCliente(${c.id_cliente})" title="Editar datos del cliente">Editar</button>
          <button class="btn-accion dorado" style="padding: 4px 10px; font-size: 11px;" onclick="abrirResetPasswordCliente(${c.id_cliente})" title="Resetear contraseña a solicitud del cliente">Clave</button>
          <button class="btn-accion rojo" onclick="eliminarCliente(${c.id_cliente})" title="Eliminar cliente">Eliminar</button>
        </div>
      </td>
    </tr>
  `).join('');
}

/**
 * ABRIR VENTANA DE EDICIÓN DE CLIENTE
 * Carga los datos actuales del cliente en las cajas de texto del modal.
 */
window.abrirEditarCliente = function(id) {
  const c = AppState.clientes.find(item => item.id_cliente === id);
  if (!c) return;

  document.getElementById('edit-cli-id').value = c.id_cliente;
  document.getElementById('edit-cli-nombre').value = c.nombre || '';
  document.getElementById('edit-cli-usuario').value = c.nombre_usuario || '';
  document.getElementById('edit-cli-telefono').value = c.telefono || '';
  document.getElementById('edit-cli-email').value = c.email || '';
  document.getElementById('edit-cli-notas').value = c.notas || '';

  document.getElementById('modal-editar-cliente').classList.add('active');
};

/**
 * ABRIR VENTANA DE RESETEO DE CONTRASEÑA
 * Muestra el nombre y usuario del cliente, y limpia los campos para colocar la nueva clave.
 */
window.abrirResetPasswordCliente = function(id) {
  const c = AppState.clientes.find(item => item.id_cliente === id);
  if (!c) return;

  document.getElementById('reset-cli-id').value = c.id_cliente;
  document.getElementById('reset-cli-password').value = '';
  document.getElementById('reset-cli-confirmar').value = '';

  const infoEl = document.getElementById('reset-cli-info');
  if (infoEl) {
    infoEl.innerHTML = `Cliente: <strong>${escapeHtml(c.nombre)}</strong> ${c.nombre_usuario ? `· Usuario de acceso: <span style="color: var(--gold-bright); font-weight: bold;">${escapeHtml(c.nombre_usuario)}</span>` : '<br><span style="color: var(--text-muted); font-size: 11px;">(El cliente aún no tenía cuenta web, se le creará una automáticamente)</span>'}`;
  }

  document.getElementById('modal-reset-password-cliente').classList.add('active');
};

/**
 * ELIMINAR CLIENTE
 * Pide confirmación al administrador y se comunica con la API para borrar al cliente.
 * Si el cliente tiene citas activas o pasadas, el servidor responderá bloqueando la acción.
 */
window.eliminarCliente = async function(id) {
  const alertBox = document.getElementById('alert-clientes');
  if (alertBox) alertBox.style.display = 'none';

  if (!confirm('¿Estás seguro de que deseas eliminar este cliente?')) return;

  try {
    const res = await apiFetch(`${API_BASE}/clientes/${id}`, { method: 'DELETE' });
    const data = await res.json();

    if (!res.ok) {
      if (alertBox) {
        alertBox.textContent = data.message;
        alertBox.style.display = 'block';
      } else {
        alert('⚠️ ' + data.message);
      }
      return;
    }

    alert('✅ ' + data.message);
    await loadInitialData();
  } catch (err) {
    alert('Error al intentar eliminar el cliente');
  }
};

/* ==========================================================
   FINANZAS Y REPORTES
   ========================================================== */
function initReportes() {
  const desde = document.getElementById('rep-desde');
  const hasta = document.getElementById('rep-hasta');

  document.getElementById('btn-rep-aplicar')?.addEventListener('click', renderFinanzas);
  document.getElementById('btn-rep-mes')?.addEventListener('click', () => {
    const hoy = fechaHoyLocal();
    desde.value = `${hoy.slice(0, 8)}01`;
    hasta.value = hoy;
    renderFinanzas();
  });
  document.getElementById('btn-rep-todo')?.addEventListener('click', () => {
    desde.value = '';
    hasta.value = '';
    renderFinanzas();
  });
}

async function renderFinanzas() {
  const desde = document.getElementById('rep-desde')?.value;
  const hasta = document.getElementById('rep-hasta')?.value;
  const params = new URLSearchParams();
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);

  try {
    const res = await apiFetch(`${API_BASE}/reportes?${params}`).then(r => r.json());
    if (!res.success) {
      alert('⚠️ ' + res.message);
      return;
    }
    const d = res.data;
    const set = (id, texto) => { const el = document.getElementById(id); if (el) el.textContent = texto; };

    set('rep-periodo', desde || hasta
      ? `Periodo: ${desde ? formatoFecha(desde) : 'inicio'} al ${hasta ? formatoFecha(hasta) : 'hoy'}`
      : 'Periodo: todo el historial');
    set('rep-ingresos', formatoBs(d.total_ingresos));
    set('rep-ingresos-detalle', `Anticipos QR: ${formatoBs(d.ingresos_anticipos)} · En local: ${formatoBs(d.ingresos_local)}`);
    set('rep-gastos', formatoBs(d.total_gastos));
    set('rep-utilidad', formatoBs(d.ganancia_neta));
    set('rep-saldo', formatoBs(d.saldo_por_cobrar));
    set('rep-reembolsos', formatoBs(d.monto_por_reembolsar));
    set('rep-citas', d.citas_totales);
    set('rep-citas-detalle', `Atendidas: ${d.citas_atendidas} (presenciales: ${d.atenciones_presenciales}) · Canceladas: ${d.citas_canceladas} · No asistió: ${d.citas_no_asistio}`);

    const utilidad = document.getElementById('rep-utilidad');
    if (utilidad) utilidad.style.color = d.ganancia_neta < 0 ? 'var(--status-red)' : 'var(--status-green)';

    const tbodyGastos = document.getElementById('tbody-gastos');
    if (tbodyGastos) {
      tbodyGastos.innerHTML = d.gastos_recientes.length === 0
        ? `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 24px;">Sin gastos en el periodo.</td></tr>`
        : d.gastos_recientes.map(g => `
          <tr>
            <td style="font-family: monospace;">${formatoFecha(g.fecha_gasto)}</td>
            <td><strong>${escapeHtml(g.descripcion)}</strong></td>
            <td><span class="badge badge-blue">${escapeHtml(g.categoria || 'General')}</span></td>
            <td style="color: var(--status-red); font-weight: bold;">${formatoBs(g.monto)}</td>
          </tr>
        `).join('');
    }
  } catch (err) {
    console.warn(err);
  }
}

window.AppState = AppState;
window.switchView = switchView;
window.loadInitialData = loadInitialData;
