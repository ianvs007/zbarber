/**
 * Módulo de Reservas y Pagos del Administrador - Z-BARBER
 * Revisión de comprobantes QR, atención, inasistencia, cancelación, reembolsos y atención presencial
 */

const ReservasState = {
  pagoEnRevision: null,
  reservaPorAtender: null,
  urlComprobante: null
};

function filtrarReservas() {
  const estado = document.getElementById('filtro-estado')?.value || 'all';
  const fecha = document.getElementById('filtro-fecha')?.value || '';
  const texto = (document.getElementById('buscador-global')?.value || '').trim().toLowerCase();

  return (window.AppState?.reservas || []).filter(r =>
    (estado === 'all' || r.estado === estado) &&
    (!fecha || r.fecha_reserva === fecha) &&
    (!texto || [r.cliente_nombre, r.cliente_telefono, r.nombre_servicio, r.barbero_nombre]
      .some(v => String(v || '').toLowerCase().includes(texto)))
  );
}

function accionesReserva(r) {
  const acciones = [];
  const porAtender = ['pendiente', 'confirmada', 'en_espera'].includes(r.estado);

  if (r.estado === 'en_revision' && r.id_pago) {
    acciones.push(`<button class="btn-accion dorado" onclick="abrirRevisionPago(${r.id_reserva})">Revisar pago</button>`);
  } else if (r.id_pago && r.pago_metodo === 'qr') {
    acciones.push(`<button class="btn-accion" onclick="abrirRevisionPago(${r.id_reserva})">Comprobante</button>`);
  }
  if (porAtender) {
    acciones.push(`<button class="btn-accion verde" onclick="abrirAtender(${r.id_reserva})">Atender</button>`);
    if (r.minutos_para_cita <= 0) {
      acciones.push(`<button class="btn-accion" onclick="marcarNoAsistio(${r.id_reserva})">No asistió</button>`);
    }
  }
  if (porAtender || r.estado === 'pendiente_pago') {
    acciones.push(`<button class="btn-accion rojo" onclick="cancelarReservaAdmin(${r.id_reserva})">Cancelar</button>`);
  }
  if (r.pago_estado === 'por_reembolsar') {
    acciones.push(`<button class="btn-accion azul" onclick="marcarReembolsado(${r.id_pago}, ${Number(r.pago_monto)})">Marcar reembolsado</button>`);
  }
  return acciones.join('');
}

function detalleEstado(r) {
  const partes = [];
  partes.push(`<div>${textoEstadoReserva(r.estado)}</div>`);

  if (r.estado === 'pendiente_pago' && r.segundos_para_pagar != null) {
    partes.push(`<small style="color: var(--text-muted); font-size: 11px;">Vence en ${Math.ceil(r.segundos_para_pagar / 60)} min</small>`);
  }

  if (r.pago_estado && r.estado !== 'en_revision') {
    partes.push(`
      <div class="pago-frances">
        <span class="pago-label">Pago:</span>
        <div class="pago-tabulado">${textoEstadoPago(r.pago_estado)}</div>
      </div>
    `);
  }

  if (r.pago_estado === 'rechazado' && r.pago_motivo_rechazo) {
    partes.push(`<small style="color: var(--status-red); font-size: 11px;">Rechazo ${r.rechazos_pago}/2: ${escapeHtml(r.pago_motivo_rechazo)}</small>`);
  }

  if (r.estado === 'cancelada' && r.cancelado_por) {
    partes.push(`<small style="color: var(--text-muted); font-size: 11px;">por ${escapeHtml(r.cancelado_por)}</small>`);
  }

  return `<div class="estado-stack">${partes.join('')}</div>`;
}

window.renderReservas = function() {
  const tbody = document.getElementById('tbody-todas-reservas');
  if (!tbody) return;

  const reservas = filtrarReservas();
  if (reservas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 30px;">No hay reservas con esos filtros.</td></tr>`;
    return;
  }

  tbody.innerHTML = reservas.map(r => `
    <tr>
      <td style="font-family: monospace;">
        ${formatoFecha(r.fecha_reserva)}<br>
        <strong style="color: var(--gold-bright);">${r.hora_reserva.slice(0, 5)} - ${r.hora_fin.slice(0, 5)}</strong>
      </td>
      <td><strong>${escapeHtml(r.cliente_nombre)}</strong><br><small style="color: var(--text-muted);">${escapeHtml(r.cliente_telefono)}</small></td>
      <td>${escapeHtml(r.nombre_servicio || '—')}<br><small style="color: var(--text-muted);">${escapeHtml(r.barbero_nombre || '—')}</small></td>
      <td style="text-align: center; vertical-align: middle;">
        ${r.tipo_atencion === 'sin_reserva'
          ? '<span class="texto-estado gris">Presencial</span>'
          : '<span class="texto-estado verde">Reserva</span>'}
        ${r.es_domicilio ? '<br><span class="texto-estado dorado" style="font-size: 11px;">Domicilio</span>' : ''}
      </td>
      <td>
        <strong>${formatoBs(r.monto_total)}</strong><br>
        <small style="color: var(--status-green);">Pagado: ${formatoBs(r.anticipo_pagado)}</small><br>
        <small style="color: var(--gold-bright);">Saldo: ${formatoBs(r.saldo_pendiente)}</small>
      </td>
      <td style="text-align: left; vertical-align: middle;">${detalleEstado(r)}</td>
      <td style="text-align: center; vertical-align: middle;">
        <div class="acciones centradas">
          ${accionesReserva(r) || '<span style="color: var(--text-muted); font-size: 14px;">—</span>'}
        </div>
      </td>
    </tr>
  `).join('');
};

async function accionReserva(url, body, confirmacion) {
  if (confirmacion && !confirm(confirmacion)) return;
  try {
    const res = await apiFetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const data = await res.json();
    alert((res.ok ? '✅ ' : '⚠️ ') + data.message);
    if (res.ok) {
      cerrarModales();
      await window.loadInitialData();
      window.renderReservas();
    }
  } catch (err) {
    alert('Error conectando con la API');
  }
}

window.cancelarReservaAdmin = function(id) {
  accionReserva(`/api/reservas/${id}/cancelar`, null,
    '¿Cancelar esta reserva? Si el cliente ya pagó el anticipo, quedará pendiente de reembolso.');
};

window.marcarNoAsistio = function(id) {
  accionReserva(`/api/reservas/${id}/no-asistio`, null, '¿Confirmas que el cliente no se presentó? El anticipo queda como ingreso.');
};

window.marcarReembolsado = function(idPago, monto) {
  accionReserva(`/api/pagos/${idPago}/reembolsado`, null,
    `¿Confirmas que ya devolviste ${formatoBs(monto)} al cliente?`);
};

/* ===================== ATENDER Y COBRAR SALDO ===================== */
window.abrirAtender = function(id) {
  const r = window.AppState.reservas.find(x => x.id_reserva === id);
  if (!r) return;
  ReservasState.reservaPorAtender = id;
  document.getElementById('atender-datos').innerHTML = `
    <p><strong>${escapeHtml(r.cliente_nombre)}</strong> — ${escapeHtml(r.nombre_servicio)}</p>
    <p>Total: ${formatoBs(r.monto_total)} · Pagado: ${formatoBs(r.anticipo_pagado)}</p>
    <p class="monto-pagar">Cobrar: ${formatoBs(r.saldo_pendiente)}</p>
  `;
  document.getElementById('modal-atender').classList.add('active');
};

/* ===================== REVISIÓN DE COMPROBANTE ===================== */
window.abrirRevisionPago = async function(id) {
  const r = window.AppState.reservas.find(x => x.id_reserva === id);
  if (!r) return;
  ReservasState.pagoEnRevision = r.id_pago;
  const enRevision = r.estado === 'en_revision';

  document.getElementById('revision-datos').innerHTML = `
    <p><strong>${escapeHtml(r.cliente_nombre)}</strong> (${escapeHtml(r.cliente_telefono)}) — ${escapeHtml(r.nombre_servicio)}</p>
    <p>Cita: ${formatoFecha(r.fecha_reserva)} a las ${r.hora_reserva.slice(0, 5)} con ${escapeHtml(r.barbero_nombre)}</p>
    <p>Monto que debe figurar en tu banco: <strong style="color: var(--gold-bright); font-size: 16px;">${formatoBs(r.pago_monto)}</strong>
       (50% de ${formatoBs(r.monto_total)})</p>
    ${r.pago_nro_transaccion ? `<p>N° de transacción indicado: <strong>${escapeHtml(r.pago_nro_transaccion)}</strong></p>` : ''}
    ${r.rechazos_pago > 0 ? `<p style="color: #ffb4b4;">Este cliente ya tuvo ${r.rechazos_pago} comprobante(s) rechazado(s). Si rechazas este, la reserva se cancelará.</p>` : ''}
    ${!enRevision ? `<p>Estado del pago: ${badgeEstadoPago(r.pago_estado)}</p>` : ''}
  `;
  ['btn-aprobar-pago', 'btn-rechazar-pago'].forEach(b => { document.getElementById(b).style.display = enRevision ? '' : 'none'; });
  document.getElementById('revision-motivo').closest('.form-group').style.display = enRevision ? '' : 'none';
  document.getElementById('revision-motivo').value = '';

  const visor = document.getElementById('revision-visor');
  visor.innerHTML = '<p style="color: var(--text-muted);">Cargando comprobante...</p>';
  document.getElementById('modal-revisar-pago').classList.add('active');

  try {
    if (ReservasState.urlComprobante) URL.revokeObjectURL(ReservasState.urlComprobante);
    const archivo = await obtenerArchivoProtegido(`/api/pagos/${r.id_pago}/comprobante`);
    ReservasState.urlComprobante = archivo.url;
    visor.innerHTML = archivo.tipo === 'application/pdf'
      ? `<iframe class="visor-comprobante" src="${archivo.url}" title="Comprobante"></iframe>`
      : `<img class="visor-comprobante" src="${archivo.url}" alt="Comprobante de pago">`;
  } catch (err) {
    visor.innerHTML = `<p class="aviso error">${escapeHtml(err.message)}</p>`;
  }
};

/* ===================== ATENCIÓN PRESENCIAL ===================== */
function actualizarBarberosPresencial() {
  const idServicio = Number(document.getElementById('pres-servicio').value);
  const servicio = window.AppState.servicios.find(s => s.id_servicio === idServicio);
  const disponibles = window.AppState.barberos.filter(b => b.estado === 'activo' && b.servicios_asignados?.includes(idServicio));

  document.getElementById('pres-barbero').innerHTML = disponibles.length > 0
    ? disponibles.map(b => `<option value="${b.id_barbero}">${escapeHtml(b.nombre)}</option>`).join('')
    : '<option value="">Ningún barbero realiza este servicio</option>';
  document.getElementById('pres-total').textContent = servicio
    ? `Total a cobrar: ${formatoBs(servicio.precio)} (${servicio.duracion_min} min)` : '';
}

function abrirPresencial() {
  const clientes = window.AppState.clientes;
  document.getElementById('pres-cliente').innerHTML =
    '<option value="nuevo">+ Cliente nuevo</option>' +
    clientes.map(c => `<option value="${c.id_cliente}">${escapeHtml(c.nombre)} (${escapeHtml(c.telefono)})</option>`).join('');
  document.getElementById('pres-nuevo-cliente').style.display = 'grid';

  document.getElementById('pres-servicio').innerHTML = window.AppState.servicios
    .filter(s => s.estado === 'activo')
    .map(s => `<option value="${s.id_servicio}">${escapeHtml(s.nombre_servicio)} (${s.duracion_min} min - ${formatoBs(s.precio)})</option>`)
    .join('');
  actualizarBarberosPresencial();

  const ahora = new Date();
  document.getElementById('pres-hora').value = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
  document.getElementById('modal-presencial').classList.add('active');
}

document.addEventListener('DOMContentLoaded', () => {
  ['filtro-estado', 'filtro-fecha'].forEach(id => document.getElementById(id)?.addEventListener('change', window.renderReservas));
  document.getElementById('btn-limpiar-filtros')?.addEventListener('click', () => {
    document.getElementById('filtro-estado').value = 'all';
    document.getElementById('filtro-fecha').value = '';
    document.getElementById('buscador-global').value = '';
    window.renderReservas();
  });

  document.getElementById('btn-aprobar-pago')?.addEventListener('click', () => {
    accionReserva(`/api/pagos/${ReservasState.pagoEnRevision}/aprobar`, null,
      '¿Confirmas que verificaste en tu banco que el pago fue recibido?');
  });

  document.getElementById('btn-rechazar-pago')?.addEventListener('click', () => {
    const motivo = document.getElementById('revision-motivo').value.trim();
    if (motivo.length < 3) {
      alert('Escribe el motivo del rechazo para que el cliente sepa qué corregir.');
      return;
    }
    accionReserva(`/api/pagos/${ReservasState.pagoEnRevision}/rechazar`, { motivo }, '¿Rechazar este comprobante?');
  });

  document.getElementById('btn-confirmar-atencion')?.addEventListener('click', () => {
    accionReserva(`/api/reservas/${ReservasState.reservaPorAtender}/atender`, {
      metodo_pago: document.getElementById('atender-metodo').value
    });
  });

  document.getElementById('btn-open-presencial')?.addEventListener('click', abrirPresencial);
  document.getElementById('pres-servicio')?.addEventListener('change', actualizarBarberosPresencial);
  document.getElementById('pres-cliente')?.addEventListener('change', (e) => {
    document.getElementById('pres-nuevo-cliente').style.display = e.target.value === 'nuevo' ? 'grid' : 'none';
  });

  const form = document.getElementById('form-presencial');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cliente = document.getElementById('pres-cliente').value;
    const payload = {
      id_barbero: Number(document.getElementById('pres-barbero').value),
      servicios_ids: [Number(document.getElementById('pres-servicio').value)],
      hora_inicio: document.getElementById('pres-hora').value,
      metodo_pago: document.getElementById('pres-metodo').value,
      notas: document.getElementById('pres-notas').value
    };
    if (cliente === 'nuevo') {
      payload.cliente_nombre = document.getElementById('pres-nombre').value;
      payload.cliente_telefono = document.getElementById('pres-telefono').value;
    } else {
      payload.id_cliente = Number(cliente);
    }

    try {
      const res = await apiFetch('/api/reservas/presencial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      alert((res.ok ? '✅ ' : '⚠️ ') + data.message);
      if (res.ok) {
        cerrarModales();
        form.reset();
        await window.loadInitialData();
      }
    } catch (err) {
      alert('Error conectando con la API');
    }
  });
});
