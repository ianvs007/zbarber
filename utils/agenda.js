/**
 * Reglas de la agenda: horas, montos, horario de atención y antisolapamiento
 * Z-BARBER
 */

export const MINUTOS_PARA_PAGAR = 20;
export const HORAS_LIMITE_REEMBOLSO = 24;
export const MAX_RECHAZOS_PAGO = 2;

// Reservas que ocupan el horario del barbero. Una pendiente_pago solo ocupa mientras no venza.
export const SQL_RESERVA_OCUPA = `(
  r.estado IN ('en_revision', 'pendiente', 'confirmada', 'en_espera', 'atendida')
  OR (r.estado = 'pendiente_pago' AND r.expira_en > NOW())
)`;

// Reservas aún por atender (para bloquear borrado/edición de barberos y servicios)
export const SQL_RESERVA_ACTIVA = `(
  r.estado IN ('en_revision', 'pendiente', 'confirmada', 'en_espera')
  OR (r.estado = 'pendiente_pago' AND r.expira_en > NOW())
)`;

export class ErrorNegocio extends Error {
  constructor(mensaje, status = 400) {
    super(mensaje);
    this.status = status;
  }
}

export function parsearFecha(valor) {
  const texto = String(valor || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) throw new ErrorNegocio('Fecha inválida (formato AAAA-MM-DD)');
  const [a, m, d] = texto.split('-').map(Number);
  const fecha = new Date(a, m - 1, d);
  if (fecha.getFullYear() !== a || fecha.getMonth() !== m - 1 || fecha.getDate() !== d) {
    throw new ErrorNegocio('Fecha inválida');
  }
  return { texto, diaSemana: fecha.getDay() };
}

export function horaAMinutos(valor) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/.exec(String(valor || ''));
  if (!match) throw new ErrorNegocio('Hora inválida (formato HH:MM)');
  return Number(match[1]) * 60 + Number(match[2]);
}

export function minutosAHora(minutos) {
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}:00`;
}

export const aCentavos = (monto) => Math.round(Number(monto) * 100);
export const aBolivianos = (centavos) => Number((centavos / 100).toFixed(2));

export function normalizarIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) throw new ErrorNegocio('Debe elegir al menos un servicio');
  const unicos = [...new Set(ids.map(Number))];
  if (unicos.some(id => !Number.isInteger(id) || id <= 0)) throw new ErrorNegocio('Servicio inválido');
  return unicos;
}

/**
 * Valida barbero y servicios, y calcula duración y monto en centavos.
 * Bloquea la fila del barbero (FOR UPDATE) para serializar reservas concurrentes del mismo barbero.
 */
export async function prepararAtencion(conn, { id_barbero, servicios_ids, es_domicilio }) {
  const ids = normalizarIds(servicios_ids);

  const [barberos] = await conn.query(
    `SELECT id_barbero, nombre, estado FROM barbero WHERE id_barbero = ? FOR UPDATE`,
    [Number(id_barbero)]
  );
  if (barberos.length === 0) throw new ErrorNegocio('Barbero no encontrado', 404);
  if (barberos[0].estado !== 'activo') throw new ErrorNegocio(`El barbero ${barberos[0].nombre} no está disponible`);

  const [servicios] = await conn.query(
    `SELECT s.id_servicio, s.nombre_servicio, s.precio, s.duracion_min, s.estado, sd.precio_domicilio,
            EXISTS(SELECT 1 FROM barbero_servicio bs WHERE bs.id_barbero = ? AND bs.id_servicio = s.id_servicio) AS lo_realiza
     FROM servicio s
     LEFT JOIN servicio_domicilio sd ON sd.id_servicio = s.id_servicio
     WHERE s.id_servicio IN (?)`,
    [Number(id_barbero), ids]
  );

  if (servicios.length !== ids.length) throw new ErrorNegocio('Uno o más servicios no existen');

  const domicilio = Number(es_domicilio) === 1;
  let duracion = 0;
  let totalCentavos = 0;
  const detalle = [];

  for (const s of servicios) {
    if (s.estado !== 'activo') throw new ErrorNegocio(`El servicio "${s.nombre_servicio}" no está disponible`);
    if (!s.lo_realiza) throw new ErrorNegocio(`${barberos[0].nombre} no realiza el servicio "${s.nombre_servicio}"`);
    if (domicilio && !s.precio_domicilio) throw new ErrorNegocio(`El servicio "${s.nombre_servicio}" no está disponible a domicilio`);

    const precio = aCentavos(domicilio ? s.precio_domicilio : s.precio);
    duracion += Number(s.duracion_min);
    totalCentavos += precio;
    detalle.push({ id_servicio: s.id_servicio, precioCentavos: precio });
  }

  return { duracion, totalCentavos, detalle, domicilio };
}

export async function validarHorarioAtencion(conn, diaSemana, inicioMin, finMin) {
  if (finMin > 24 * 60) throw new ErrorNegocio('La atención no puede pasar de la medianoche');

  const [rows] = await conn.query(
    `SELECT abierto, hora_apertura, hora_cierre FROM horario_atencion WHERE dia_semana = ?`,
    [diaSemana]
  );
  const horario = rows[0];
  if (!horario || !horario.abierto) throw new ErrorNegocio('La barbería no atiende ese día');

  const apertura = horaAMinutos(horario.hora_apertura);
  const cierre = horaAMinutos(horario.hora_cierre);
  if (inicioMin < apertura || finMin > cierre) {
    throw new ErrorNegocio(
      `Fuera del horario de atención (${horario.hora_apertura.slice(0, 5)} a ${horario.hora_cierre.slice(0, 5)}). ` +
      `La atención terminaría a las ${minutosAHora(finMin).slice(0, 5)}.`
    );
  }
}

export async function verificarCruceBarbero(conn, id_barbero, fecha, inicio, fin) {
  const [choques] = await conn.query(
    `SELECT r.hora_reserva, r.hora_fin, r.tipo_atencion
     FROM reserva r
     INNER JOIN reserva_servicio rs ON r.id_reserva = rs.id_reserva
     WHERE rs.id_barbero = ? AND r.fecha_reserva = ?
       AND ${SQL_RESERVA_OCUPA}
       AND r.hora_reserva < ? AND r.hora_fin > ?
     LIMIT 1`,
    [id_barbero, fecha, fin, inicio]
  );
  if (choques.length > 0) {
    const c = choques[0];
    const tipo = c.tipo_atencion === 'sin_reserva' ? 'una atención presencial' : 'una reserva';
    throw new ErrorNegocio(`El barbero ya tiene ${tipo} de ${c.hora_reserva.slice(0, 5)} a ${c.hora_fin.slice(0, 5)}.`, 409);
  }
}

export async function verificarCruceCliente(conn, id_cliente, fecha, inicio, fin) {
  const [choques] = await conn.query(
    `SELECT r.hora_reserva, r.hora_fin
     FROM reserva r
     WHERE r.id_cliente = ? AND r.fecha_reserva = ?
       AND ${SQL_RESERVA_OCUPA}
       AND r.hora_reserva < ? AND r.hora_fin > ?
     LIMIT 1`,
    [id_cliente, fecha, fin, inicio]
  );
  if (choques.length > 0) {
    const c = choques[0];
    throw new ErrorNegocio(`Ya tienes una reserva de ${c.hora_reserva.slice(0, 5)} a ${c.hora_fin.slice(0, 5)} ese día.`, 409);
  }
}

// Cancela las reservas cuyo plazo para subir el comprobante venció
export async function expirarReservasVencidas(conn) {
  const [result] = await conn.query(
    `UPDATE reserva
     SET estado = 'cancelada', cancelado_por = 'sistema', cancelado_en = NOW(), saldo_pendiente = 0
     WHERE estado = 'pendiente_pago' AND expira_en <= NOW()`
  );
  return result.affectedRows;
}

export function responderError(res, error, contexto) {
  if (error instanceof ErrorNegocio) {
    return res.status(error.status).json({ success: false, message: error.message });
  }
  console.error(`Error en ${contexto}:`, error);
  res.status(500).json({ success: false, message: 'Error interno del servidor' });
}
