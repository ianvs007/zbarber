/**
 * Panel del Cliente: reservar, pagar el 50% por QR, subir comprobante y cancelar - Z-BARBER
 */

const API_BASE = '/api';
const LIMITE_REEMBOLSO_MIN = 24 * 60;

const ClienteState = {
  user: null,
  reservas: [],
  servicios: [],
  barberos: [],
  horario: [],
  qr: null,
  urlQr: null,
  reservaPago: null,
  finPlazo: null,
  temporizador: null
};

document.addEventListener('DOMContentLoaded', () => {
  ClienteState.user = requireSession('cliente');
  if (!ClienteState.user) return;

  document.getElementById('sidebar-user').textContent = ClienteState.user.nombre_completo;
  document.getElementById('btn-logout').addEventListener('click', () => Auth.cerrarSesion());

  initModales();
  initFormularioReserva();
  initFormularioComprobante();
  cargarDatos();

  setInterval(() => {
    if (!document.querySelector('.modal-overlay.active')) cargarDatos();
  }, 30 * 1000);
});

async function cargarDatos() {
  try {
    const [resRes, servRes, barbRes, horRes, qrRes] = await Promise.all([
      apiFetch(`${API_BASE}/reservas`).then(r => r.json()),
      apiFetch(`${API_BASE}/servicios`).then(r => r.json()),
      apiFetch(`${API_BASE}/barberos`).then(r => r.json()),
      apiFetch(`${API_BASE}/horario`).then(r => r.json()),
      apiFetch(`${API_BASE}/pagos/qr`).then(r => r.json())
    ]);

    ClienteState.reservas = resRes.data || [];
    ClienteState.servicios = (servRes.data || []).filter(s => s.estado === 'activo');
    ClienteState.barberos = (barbRes.data || []).filter(b => b.estado === 'activo');
    ClienteState.horario = horRes.data || [];
    ClienteState.qr = qrRes.data || null;

    renderHorario();
    renderMisReservas();
  } catch (err) {
    console.warn('Error cargando datos:', err);
  }
}

function renderHorario() {
  const lista = document.getElementById('lista-horario');
  if (!lista) return;
  const orden = [1, 2, 3, 4, 5, 6, 0];
  lista.innerHTML = orden.map(dia => {
    const h = ClienteState.horario.find(x => x.dia_semana === dia);
    const texto = h?.abierto ? `${h.hora_apertura.slice(0, 5)} - ${h.hora_cierre.slice(0, 5)}` : 'Cerrado';
    return `<div style="display: flex; justify-content: space-between;"><span>${DIAS_SEMANA[dia]}</span><span>${texto}</span></div>`;
  }).join('');
}

function mensajeEstado(r) {
  const partes = [badgeEstadoReserva(r.estado)];
  if (r.estado === 'pendiente_pago') {
    if (r.pago_estado === 'rechazado') {
      partes.push(`<small style="color: #ffb4b4;">Comprobante rechazado: ${escapeHtml(r.pago_motivo_rechazo)}. Sube otro (último intento).</small>`);
    }
    partes.push(`<small style="color: var(--text-muted);">Tienes ${Math.ceil((r.segundos_para_pagar || 0) / 60)} min para pagar</small>`);
  }
  if (r.estado === 'en_revision') partes.push('<small style="color: var(--text-muted);">La barbería está verificando tu pago</small>');
  if (r.estado === 'confirmada') partes.push(`<small style="color: var(--text-muted);">Paga ${formatoBs(r.saldo_pendiente)} en la barbería</small>`);
  if (r.pago_estado === 'por_reembolsar') partes.push('<small style="color: var(--status-yellow);">Devolución del anticipo en proceso</small>');
  if (r.pago_estado === 'reembolsado') partes.push('<small style="color: var(--status-blue);">Anticipo devuelto</small>');
  if (r.estado === 'cancelada' && r.cancelado_por === 'sistema') partes.push('<small style="color: var(--text-muted);">Venció el plazo de pago</small>');
  return partes.join('<br>');
}

function renderMisReservas() {
  const tbody = document.getElementById('tbody-mis-reservas');
  if (!tbody) return;

  if (ClienteState.reservas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 30px;">Aún no tienes reservas. Usa "Reservar Cita" para agendar una.</td></tr>`;
    return;
  }

  tbody.innerHTML = ClienteState.reservas.map(r => {
    const acciones = [];
    if (r.estado === 'pendiente_pago') {
      acciones.push(`<button class="btn-accion dorado" onclick="abrirPago(${r.id_reserva})">Pagar</button>`);
    }
    if (['pendiente_pago', 'pendiente', 'confirmada', 'en_espera'].includes(r.estado) && r.minutos_para_cita > 0) {
      acciones.push(`<button class="btn-accion rojo" onclick="cancelarReserva(${r.id_reserva})">Cancelar</button>`);
    }

    return `
      <tr>
        <td>${formatoFecha(r.fecha_reserva)}<br>
          <strong style="font-family: monospace; color: var(--gold-bright);">${r.hora_reserva.slice(0, 5)} - ${r.hora_fin.slice(0, 5)}</strong></td>
        <td>${escapeHtml(r.nombre_servicio || '—')}<br><small style="color: var(--text-muted);">${escapeHtml(r.barbero_nombre || '—')}${r.es_domicilio ? ' · Domicilio' : ''}</small></td>
        <td>
          <strong>Total: ${formatoBs(r.monto_total)}</strong><br>
          <small>Anticipo (50%): ${formatoBs(r.anticipo_requerido)}</small><br>
          <small style="color: var(--status-green);">Pagado: ${formatoBs(r.anticipo_pagado)}</small>
        </td>
        <td>${mensajeEstado(r)}</td>
        <td><div class="acciones">${acciones.join('')}</div></td>
      </tr>
    `;
  }).join('');
}

window.cancelarReserva = async function(id) {
  const r = ClienteState.reservas.find(x => x.id_reserva === id);
  if (!r) return;

  let mensaje = '¿Deseas cancelar esta reserva?';
  if (Number(r.anticipo_pagado) > 0) {
    mensaje += r.minutos_para_cita >= LIMITE_REEMBOLSO_MIN
      ? `\n\nFaltan más de 24 horas: se te devolverá el anticipo de ${formatoBs(r.anticipo_pagado)}.`
      : `\n\nATENCIÓN: faltan menos de 24 horas para tu cita. El anticipo de ${formatoBs(r.anticipo_pagado)} NO será devuelto.`;
  }
  if (!confirm(mensaje)) return;

  try {
    const res = await apiFetch(`${API_BASE}/reservas/${id}/cancelar`, { method: 'PUT' });
    const data = await res.json();
    alert((res.ok ? '✅ ' : '⚠️ ') + data.message);
    await cargarDatos();
  } catch (err) {
    alert('Error al cancelar la reserva');
  }
};

/* ===================== MODALES ===================== */
function initModales() {
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      cerrarModales();
      clearInterval(ClienteState.temporizador);
      cargarDatos();
    });
  });

  document.getElementById('btn-open-new-booking').addEventListener('click', () => {
    if (!ClienteState.qr?.disponible) {
      alert('La barbería aún no habilitó los pagos en línea. Intenta más tarde.');
      return;
    }

    document.getElementById('reserva-servicio').innerHTML = ClienteState.servicios.map(s => `
      <option value="${s.id_servicio}">${escapeHtml(s.nombre_servicio)} (${s.duracion_min} min - ${formatoBs(s.precio)})</option>
    `).join('');

    const fecha = document.getElementById('reserva-fecha');
    fecha.min = fechaHoyLocal();
    if (!fecha.value || fecha.value < fecha.min) fecha.value = fecha.min;

    actualizarFormularioReserva();
    document.getElementById('modal-nueva-reserva').classList.add('active');
  });

  ['reserva-servicio', 'reserva-fecha', 'reserva-domicilio'].forEach(id => {
    document.getElementById(id).addEventListener('change', actualizarFormularioReserva);
  });
}

// Solo barberos que realizan el servicio, horario del día elegido y resumen de montos
function actualizarFormularioReserva() {
  const idServicio = Number(document.getElementById('reserva-servicio').value);
  const servicio = ClienteState.servicios.find(s => s.id_servicio === idServicio);
  const disponibles = ClienteState.barberos.filter(b => b.servicios_asignados?.includes(idServicio));

  const barbSelect = document.getElementById('reserva-barbero');
  const seleccionado = barbSelect.value;
  barbSelect.innerHTML = disponibles.length > 0
    ? disponibles.map(b => `<option value="${b.id_barbero}">${escapeHtml(b.nombre)} (${Number(b.anos_experiencia) || 0} años exp)</option>`).join('')
    : '<option value="">Ningún barbero disponible para este servicio</option>';
  if (disponibles.some(b => String(b.id_barbero) === seleccionado)) barbSelect.value = seleccionado;

  const domicilio = document.getElementById('reserva-domicilio');
  document.getElementById('grupo-domicilio').style.display = servicio?.precio_domicilio ? 'flex' : 'none';
  if (!servicio?.precio_domicilio) domicilio.checked = false;

  const fecha = document.getElementById('reserva-fecha').value;
  const infoDia = document.getElementById('reserva-horario-dia');
  if (fecha) {
    const [a, m, d] = fecha.split('-').map(Number);
    const h = ClienteState.horario.find(x => x.dia_semana === new Date(a, m - 1, d).getDay());
    infoDia.textContent = h?.abierto
      ? `Horario de ese día: ${h.hora_apertura.slice(0, 5)} a ${h.hora_cierre.slice(0, 5)}`
      : 'La barbería no atiende ese día.';
  }

  const resumen = document.getElementById('reserva-resumen');
  if (servicio) {
    const total = Number(domicilio.checked ? servicio.precio_domicilio : servicio.precio);
    const anticipo = Math.round(total * 100 / 2) / 100;
    resumen.innerHTML = `Total del servicio: <strong>${formatoBs(total)}</strong> · Duración: ${servicio.duracion_min} min<br>
      Para confirmar debes pagar por QR el <strong>50%: ${formatoBs(anticipo)}</strong> dentro de 20 minutos. El resto se paga en la barbería.`;
  }
}

function initFormularioReserva() {
  const form = document.getElementById('form-nueva-reserva');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
      id_barbero: Number(document.getElementById('reserva-barbero').value),
      servicios_ids: [Number(document.getElementById('reserva-servicio').value)],
      fecha_reserva: document.getElementById('reserva-fecha').value,
      hora_reserva: document.getElementById('reserva-hora').value,
      es_domicilio: document.getElementById('reserva-domicilio').checked ? 1 : 0,
      notas: document.getElementById('reserva-notas').value
    };

    if (!payload.id_barbero) {
      alert('Selecciona un barbero disponible para el servicio');
      return;
    }

    try {
      const res = await apiFetch(`${API_BASE}/reservas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok) {
        alert(`⚠️ ${data.message}`);
        return;
      }

      form.reset();
      cerrarModales();
      await cargarDatos();
      abrirPago(data.data.id_reserva);
    } catch (err) {
      alert('Error conectando con la API');
    }
  });
}

/* ===================== PAGO CON QR ===================== */
window.abrirPago = async function(id) {
  const r = ClienteState.reservas.find(x => x.id_reserva === id);
  if (!r || r.estado !== 'pendiente_pago') return;
  ClienteState.reservaPago = id;

  document.getElementById('pago-monto').textContent = formatoBs(r.anticipo_requerido);
  document.getElementById('pago-detalle').textContent =
    `50% de ${formatoBs(r.monto_total)} · ${r.nombre_servicio} el ${formatoFecha(r.fecha_reserva)} a las ${r.hora_reserva.slice(0, 5)}`;

  const rechazo = document.getElementById('pago-rechazo');
  rechazo.style.display = r.pago_estado === 'rechazado' ? 'block' : 'none';
  rechazo.textContent = r.pago_estado === 'rechazado'
    ? `Tu comprobante anterior fue rechazado: ${r.pago_motivo_rechazo}. Este es tu último intento; si se rechaza de nuevo, la reserva se cancelará.`
    : '';

  const cuenta = [ClienteState.qr?.banco, ClienteState.qr?.titular && `Titular: ${ClienteState.qr.titular}`].filter(Boolean).join(' · ');
  document.getElementById('pago-cuenta').textContent = cuenta;
  document.getElementById('form-comprobante').reset();

  const contenedorQr = document.getElementById('pago-qr');
  contenedorQr.innerHTML = '<p style="text-align: center; color: var(--text-muted);">Cargando QR...</p>';
  document.getElementById('modal-pago').classList.add('active');

  ClienteState.finPlazo = Date.now() + (r.segundos_para_pagar || 0) * 1000;
  clearInterval(ClienteState.temporizador);
  actualizarContador();
  ClienteState.temporizador = setInterval(actualizarContador, 1000);

  try {
    if (!ClienteState.urlQr) {
      ClienteState.urlQr = (await obtenerArchivoProtegido(`${API_BASE}/pagos/qr/imagen`)).url;
    }
    contenedorQr.innerHTML = `<img class="qr-imagen" src="${ClienteState.urlQr}" alt="QR de pago de Z-BARBER">`;
  } catch (err) {
    contenedorQr.innerHTML = `<p class="aviso error">${escapeHtml(err.message)}</p>`;
  }
};

function actualizarContador() {
  const restante = Math.max(0, Math.floor((ClienteState.finPlazo - Date.now()) / 1000));
  document.getElementById('pago-contador').textContent =
    `${String(Math.floor(restante / 60)).padStart(2, '0')}:${String(restante % 60).padStart(2, '0')}`;
  document.getElementById('btn-enviar-comprobante').disabled = restante === 0;

  if (restante === 0) {
    clearInterval(ClienteState.temporizador);
    alert('El plazo para pagar venció y el horario fue liberado. Puedes hacer una nueva reserva.');
    cerrarModales();
    cargarDatos();
  }
}

function initFormularioComprobante() {
  document.getElementById('form-comprobante').addEventListener('submit', async (e) => {
    e.preventDefault();
    const archivo = document.getElementById('comprobante-archivo').files[0];
    if (!archivo) return;
    if (archivo.size > 5 * 1024 * 1024) {
      alert('⚠️ El archivo supera los 5 MB');
      return;
    }

    const datos = new FormData();
    datos.append('comprobante', archivo);
    const nro = document.getElementById('comprobante-nro').value.trim();
    if (nro) datos.append('nro_transaccion', nro);

    const boton = document.getElementById('btn-enviar-comprobante');
    boton.disabled = true;
    try {
      const res = await apiFetch(`${API_BASE}/pagos/reserva/${ClienteState.reservaPago}/comprobante`, {
        method: 'POST',
        body: datos
      });
      const data = await res.json();
      alert((res.ok ? '✅ ' : '⚠️ ') + data.message);
      if (res.ok) {
        clearInterval(ClienteState.temporizador);
        cerrarModales();
        await cargarDatos();
      }
    } catch (err) {
      alert('Error conectando con la API');
    } finally {
      boton.disabled = false;
    }
  });
}
