/**
 * Configuración del Administrador: QR de pago y horario de atención - Z-BARBER
 */

let urlQrActual = null;

window.renderConfiguracion = async function() {
  await Promise.all([cargarQr(), cargarHorario()]);
};

async function cargarQr() {
  const contenedor = document.getElementById('qr-actual');
  try {
    const { data } = await apiFetch('/api/pagos/qr').then(r => r.json());
    document.getElementById('qr-banco').value = data.banco || '';
    document.getElementById('qr-titular').value = data.titular || '';

    if (!data.disponible) {
      contenedor.innerHTML = '<p class="aviso alerta">Aún no subiste el QR. Los clientes no podrán pagar sus reservas hasta que lo hagas.</p>';
      return;
    }

    if (urlQrActual) URL.revokeObjectURL(urlQrActual);
    const archivo = await obtenerArchivoProtegido('/api/pagos/qr/imagen');
    urlQrActual = archivo.url;
    contenedor.innerHTML = `<img class="qr-imagen" src="${archivo.url}" alt="QR actual">`;
  } catch (err) {
    contenedor.innerHTML = `<p class="aviso error">${escapeHtml(err.message)}</p>`;
  }
}

async function cargarHorario() {
  const tbody = document.getElementById('tbody-horario');
  try {
    const { data } = await apiFetch('/api/horario').then(r => r.json());
    tbody.innerHTML = data.map(h => `
      <tr data-dia="${h.dia_semana}">
        <td><strong>${DIAS_SEMANA[h.dia_semana]}</strong></td>
        <td><input type="checkbox" class="h-abierto" ${h.abierto ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: var(--gold-bright);"></td>
        <td><input type="time" class="form-control h-apertura" value="${h.hora_apertura.slice(0, 5)}" required></td>
        <td><input type="time" class="form-control h-cierre" value="${h.hora_cierre.slice(0, 5)}" required></td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="aviso error">No se pudo cargar el horario</td></tr>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('form-qr')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const archivo = document.getElementById('qr-archivo').files[0];
    if (archivo && archivo.size > 5 * 1024 * 1024) {
      alert('⚠️ La imagen supera los 5 MB');
      return;
    }

    const datos = new FormData();
    datos.append('banco', document.getElementById('qr-banco').value);
    datos.append('titular', document.getElementById('qr-titular').value);
    if (archivo) datos.append('qr', archivo);

    try {
      const res = await apiFetch('/api/pagos/qr', { method: 'PUT', body: datos });
      const data = await res.json();
      alert((res.ok ? '✅ ' : '⚠️ ') + data.message);
      if (res.ok) {
        document.getElementById('qr-archivo').value = '';
        cargarQr();
      }
    } catch (err) {
      alert('Error conectando con la API');
    }
  });

  document.getElementById('form-horario')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dias = [...document.querySelectorAll('#tbody-horario tr')].map(fila => ({
      dia_semana: Number(fila.dataset.dia),
      abierto: fila.querySelector('.h-abierto').checked,
      hora_apertura: fila.querySelector('.h-apertura').value,
      hora_cierre: fila.querySelector('.h-cierre').value
    }));

    try {
      const res = await apiFetch('/api/horario', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dias })
      });
      const data = await res.json();
      alert((res.ok ? '✅ ' : '⚠️ ') + data.message);
      if (res.ok) cargarHorario();
    } catch (err) {
      alert('Error conectando con la API');
    }
  });
});
