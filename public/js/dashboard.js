/**
 * Dashboard & KPIs - Z-BARBER
 * Indicadores del día calculados con datos reales de la base de datos
 */

window.renderDashboard = function() {
  const reservas = window.AppState?.reservas || [];
  const hoy = fechaHoyLocal();
  const delDia = reservas
    .filter(r => r.fecha_reserva === hoy && r.estado !== 'cancelada')
    .sort((a, b) => a.hora_reserva.localeCompare(b.hora_reserva));
  const porRevisar = reservas.filter(r => r.estado === 'en_revision').length;

  const set = (id, texto) => { const el = document.getElementById(id); if (el) el.textContent = texto; };
  set('kpi-ingresos-hoy', formatoBs(window.AppState?.reporteHoy?.total_ingresos));
  set('kpi-citas-hoy', delDia.length);
  set('kpi-clientes', (window.AppState?.clientes || []).length);
  set('kpi-pendientes', porRevisar);

  const aviso = document.getElementById('aviso-pagos-dashboard');
  if (aviso) {
    aviso.style.display = porRevisar > 0 ? 'block' : 'none';
    aviso.innerHTML = `Tienes <strong>${porRevisar}</strong> comprobante(s) de pago esperando revisión.
      <button class="btn-accion dorado" style="margin-left: 8px;" onclick="verReservasPorEstado('en_revision')">Revisar ahora</button>`;
  }

  const tbody = document.getElementById('tbody-reservas-hoy');
  if (!tbody) return;

  if (delDia.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">No hay citas para hoy.</td></tr>`;
    return;
  }

  tbody.innerHTML = delDia.map(r => `
    <tr>
      <td style="font-family: monospace; font-weight: bold; color: var(--gold-bright);">${r.hora_reserva.slice(0, 5)} - ${r.hora_fin.slice(0, 5)}</td>
      <td><strong>${escapeHtml(r.cliente_nombre)}</strong></td>
      <td>${escapeHtml(r.nombre_servicio || '—')}</td>
      <td>${escapeHtml(r.barbero_nombre || '—')}</td>
      <td>${badgeEstadoReserva(r.estado)}</td>
      <td><button class="btn-gold" style="padding: 4px 10px; font-size: 11px;" onclick="verReservasDeFecha('${hoy}')">Gestionar</button></td>
    </tr>
  `).join('');
};

window.verReservasPorEstado = function(estado) {
  document.getElementById('filtro-estado').value = estado;
  document.getElementById('filtro-fecha').value = '';
  window.switchView('reservas');
};

window.verReservasDeFecha = function(fecha) {
  document.getElementById('filtro-estado').value = 'all';
  document.getElementById('filtro-fecha').value = fecha;
  window.switchView('reservas');
};
