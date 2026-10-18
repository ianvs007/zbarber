/**
 * Utilidades compartidas del frontend - Z-BARBER
 */

// Todo texto que venga de la base de datos debe pasar por aquí antes de insertarse con innerHTML
window.escapeHtml = function(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

window.formatoBs = function(monto) {
  return `Bs ${Number(monto || 0).toFixed(2)}`;
};

window.fechaHoyLocal = function() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
};

window.formatoFecha = function(fechaTexto) {
  if (!fechaTexto) return '—';
  const [a, m, d] = String(fechaTexto).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};

window.DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const ESTADOS_RESERVA = {
  pendiente_pago: { texto: 'Esperando pago', clase: 'badge-yellow' },
  en_revision: { texto: 'Pago en revisión', clase: 'badge-blue' },
  pendiente: { texto: 'Pendiente', clase: 'badge-yellow' },
  confirmada: { texto: 'Confirmada', clase: 'badge-green' },
  en_espera: { texto: 'En espera', clase: 'badge-yellow' },
  atendida: { texto: 'Atendida', clase: 'badge-green' },
  cancelada: { texto: 'Cancelada', clase: 'badge-red' },
  no_asistio: { texto: 'No asistió', clase: 'badge-red' }
};

const ESTADOS_PAGO = {
  en_revision: { texto: 'En revisión', clase: 'badge-blue' },
  aprobado: { texto: 'Aprobado', clase: 'badge-green' },
  rechazado: { texto: 'Rechazado', clase: 'badge-red' },
  por_reembolsar: { texto: 'Reembolso pendiente', clase: 'badge-yellow' },
  reembolsado: { texto: 'Reembolsado', clase: 'badge-blue' }
};

window.badgeEstadoReserva = function(estado) {
  const e = ESTADOS_RESERVA[estado] || { texto: estado, clase: '' };
  return `<span class="badge ${e.clase}">${escapeHtml(e.texto)}</span>`;
};

window.badgeEstadoPago = function(estado) {
  if (!estado) return '';
  const e = ESTADOS_PAGO[estado] || { texto: estado, clase: '' };
  return `<span class="badge ${e.clase}">${escapeHtml(e.texto)}</span>`;
};

// Formato de texto sencillo coloreado (sin apariencia de botón ni fondo)
const COLOR_CLASE = {
  'badge-green': 'verde',
  'badge-blue': 'azul',
  'badge-yellow': 'amarillo',
  'badge-red': 'rojo'
};

window.textoEstadoReserva = function(estado) {
  const e = ESTADOS_RESERVA[estado] || { texto: estado, clase: '' };
  const color = COLOR_CLASE[e.clase] || 'gris';
  return `<span class="texto-estado ${color}">${escapeHtml(e.texto)}</span>`;
};

window.textoEstadoPago = function(estado) {
  if (!estado) return '';
  const e = ESTADOS_PAGO[estado] || { texto: estado, clase: '' };
  const color = COLOR_CLASE[e.clase] || 'gris';
  return `<span class="texto-estado ${color}">${escapeHtml(e.texto)}</span>`;
};

// Descarga un archivo protegido (requiere token) y devuelve una URL local para mostrarlo
window.obtenerArchivoProtegido = async function(url) {
  const res = await apiFetch(url);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'No se pudo cargar el archivo');
  }
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), tipo: blob.type };
};

window.cerrarModales = function() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
};
