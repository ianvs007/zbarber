/**
 * Controlador de Reservas con Antisolapamiento, Pago de Anticipo por QR y Atención Presencial
 * Z-BARBER
 */

import pool from '../config/db.js';
import {
  MINUTOS_PARA_PAGAR,
  HORAS_LIMITE_REEMBOLSO,
  ErrorNegocio,
  parsearFecha,
  horaAMinutos,
  minutosAHora,
  aBolivianos,
  prepararAtencion,
  validarHorarioAtencion,
  verificarCruceBarbero,
  verificarCruceCliente,
  expirarReservasVencidas,
  responderError
} from '../utils/agenda.js';

const ESTADOS_POR_ATENDER = ['pendiente', 'confirmada', 'en_espera'];

// READ COMMITTED: cada verificación de cruce ve las reservas confirmadas por otras transacciones
async function iniciarTransaccion() {
  const conn = await pool.getConnection();
  await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
  await conn.beginTransaction();
  return conn;
}

async function insertarDetalle(conn, id_reserva, id_barbero, detalle) {
  for (const d of detalle) {
    await conn.query(
      `INSERT INTO reserva_servicio (id_reserva, id_servicio, id_barbero, precio_aplicado) VALUES (?, ?, ?, ?)`,
      [id_reserva, d.id_servicio, id_barbero, aBolivianos(d.precioCentavos)]
    );
  }
}

async function bloquearReserva(conn, id, user) {
  const [rows] = await conn.query(
    `SELECT r.*, TIMESTAMPDIFF(MINUTE, NOW(), TIMESTAMP(r.fecha_reserva, r.hora_reserva)) AS minutos_para_cita
     FROM reserva r WHERE r.id_reserva = ? FOR UPDATE`,
    [id]
  );
  const reserva = rows[0];
  if (!reserva || (user.rol === 'cliente' && reserva.id_cliente !== user.id_cliente)) {
    throw new ErrorNegocio('Reserva no encontrada', 404);
  }
  return reserva;
}

export const getReservas = async (req, res) => {
  try {
    await expirarReservasVencidas(pool);

    const { fecha, id_barbero, estado } = req.query;
    let sql = `
      SELECT r.id_reserva, r.id_cliente, r.tipo_atencion, r.estado,
             DATE_FORMAT(r.fecha_reserva, '%Y-%m-%d') AS fecha_reserva,
             r.hora_reserva, r.hora_fin, r.es_domicilio,
             r.monto_total, r.anticipo_requerido, r.anticipo_pagado, r.saldo_pendiente,
             r.notas, r.rechazos_pago, r.cancelado_por,
             c.nombre AS cliente_nombre, c.telefono AS cliente_telefono,
             b.id_barbero, b.nombre AS barbero_nombre,
             (SELECT GROUP_CONCAT(s.nombre_servicio ORDER BY s.nombre_servicio SEPARATOR ' + ')
                FROM reserva_servicio rs JOIN servicio s ON s.id_servicio = rs.id_servicio
               WHERE rs.id_reserva = r.id_reserva) AS nombre_servicio,
             TIMESTAMPDIFF(MINUTE, NOW(), TIMESTAMP(r.fecha_reserva, r.hora_reserva)) AS minutos_para_cita,
             IF(r.estado = 'pendiente_pago', GREATEST(TIMESTAMPDIFF(SECOND, NOW(), r.expira_en), 0), NULL) AS segundos_para_pagar,
             p.id_pago, p.estado AS pago_estado, p.monto AS pago_monto, p.metodo AS pago_metodo,
             p.motivo_rechazo AS pago_motivo_rechazo, p.nro_transaccion AS pago_nro_transaccion
      FROM reserva r
      JOIN cliente c ON c.id_cliente = r.id_cliente
      LEFT JOIN barbero b ON b.id_barbero =
        (SELECT MIN(rs.id_barbero) FROM reserva_servicio rs WHERE rs.id_reserva = r.id_reserva)
      LEFT JOIN pago p ON p.id_pago =
        (SELECT MAX(p2.id_pago) FROM pago p2 WHERE p2.id_reserva = r.id_reserva AND p2.tipo = 'anticipo')
      WHERE 1=1
    `;
    const params = [];

    if (req.user.rol === 'cliente') {
      sql += ` AND r.id_cliente = ?`;
      params.push(req.user.id_cliente);
    }
    if (fecha) {
      sql += ` AND r.fecha_reserva = ?`;
      params.push(parsearFecha(fecha).texto);
    }
    if (id_barbero && id_barbero !== 'all') {
      sql += ` AND b.id_barbero = ?`;
      params.push(Number(id_barbero));
    }
    if (estado && estado !== 'all') {
      sql += ` AND r.estado = ?`;
      params.push(estado);
    }

    sql += ` ORDER BY r.fecha_reserva DESC, r.hora_reserva DESC LIMIT 300`;

    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    responderError(res, error, 'getReservas');
  }
};

// Reserva en línea del cliente: retiene el horario mientras sube el comprobante del 50%
export const crearReserva = async (req, res) => {
  let conn;
  try {
    if (!req.user.id_cliente) throw new ErrorNegocio('La cuenta no está vinculada a un cliente', 403);

    const { id_barbero, servicios_ids, fecha_reserva, hora_reserva, es_domicilio = 0, notas = '' } = req.body;
    if (!id_barbero) throw new ErrorNegocio('Debe elegir un barbero');
    const fecha = parsearFecha(fecha_reserva);
    const inicioMin = horaAMinutos(hora_reserva);

    const [[qr]] = await pool.query(`SELECT qr_archivo IS NOT NULL AS disponible FROM configuracion_pago WHERE id = 1`);
    if (!qr?.disponible) throw new ErrorNegocio('La barbería aún no habilitó los pagos en línea. Intenta más tarde.', 503);

    await expirarReservasVencidas(pool);
    conn = await iniciarTransaccion();

    const atencion = await prepararAtencion(conn, { id_barbero, servicios_ids, es_domicilio });
    const finMin = inicioMin + atencion.duracion;
    await validarHorarioAtencion(conn, fecha.diaSemana, inicioMin, finMin);

    const inicio = minutosAHora(inicioMin);
    const fin = minutosAHora(finMin);

    const [[{ en_pasado }]] = await conn.query(`SELECT TIMESTAMP(?, ?) <= NOW() AS en_pasado`, [fecha.texto, inicio]);
    if (en_pasado) throw new ErrorNegocio('No se puede reservar en una fecha u hora que ya pasó');

    await conn.query(`SELECT id_cliente FROM cliente WHERE id_cliente = ? FOR UPDATE`, [req.user.id_cliente]);
    await verificarCruceBarbero(conn, Number(id_barbero), fecha.texto, inicio, fin);
    await verificarCruceCliente(conn, req.user.id_cliente, fecha.texto, inicio, fin);

    const total = aBolivianos(atencion.totalCentavos);
    const anticipo = aBolivianos(Math.round(atencion.totalCentavos / 2));

    const [insert] = await conn.query(
      `INSERT INTO reserva
        (id_cliente, tipo_atencion, estado, expira_en, fecha_reserva, hora_reserva, hora_fin, es_domicilio,
         monto_total, anticipo_requerido, anticipo_pagado, saldo_pendiente, notas)
       VALUES (?, 'con_reserva', 'pendiente_pago', DATE_ADD(NOW(), INTERVAL ? MINUTE), ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [req.user.id_cliente, MINUTOS_PARA_PAGAR, fecha.texto, inicio, fin, atencion.domicilio ? 1 : 0,
        total, anticipo, total, String(notas).slice(0, 500)]
    );
    await insertarDetalle(conn, insert.insertId, Number(id_barbero), atencion.detalle);

    await conn.commit();

    res.status(201).json({
      success: true,
      message: `Horario reservado. Tienes ${MINUTOS_PARA_PAGAR} minutos para pagar el anticipo y subir el comprobante.`,
      data: {
        id_reserva: insert.insertId,
        hora_reserva: inicio,
        hora_fin: fin,
        monto_total: total,
        anticipo_requerido: anticipo,
        minutos_para_pagar: MINUTOS_PARA_PAGAR
      }
    });
  } catch (error) {
    if (conn) await conn.rollback();
    responderError(res, error, 'crearReserva');
  } finally {
    conn?.release();
  }
};

// Cliente sin reserva atendido en el local: se registra solo si el barbero no tiene reservas en ese horario
export const registrarPresencial = async (req, res) => {
  let conn;
  try {
    const { id_cliente, cliente_nombre, cliente_telefono, id_barbero, servicios_ids, hora_inicio, metodo_pago, notas = '' } = req.body;

    if (!id_barbero) throw new ErrorNegocio('Debe elegir un barbero');
    if (!['efectivo', 'qr'].includes(metodo_pago)) throw new ErrorNegocio('Método de pago inválido');
    if (!id_cliente && (!cliente_nombre?.trim() || !cliente_telefono?.trim())) {
      throw new ErrorNegocio('Seleccione un cliente o ingrese nombre y teléfono del cliente nuevo');
    }
    const inicioMin = horaAMinutos(hora_inicio);

    await expirarReservasVencidas(pool);
    conn = await iniciarTransaccion();

    const [[hoy]] = await conn.query(`SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS fecha`);
    const fecha = parsearFecha(hoy.fecha);

    const atencion = await prepararAtencion(conn, { id_barbero, servicios_ids, es_domicilio: 0 });
    const finMin = inicioMin + atencion.duracion;
    await validarHorarioAtencion(conn, fecha.diaSemana, inicioMin, finMin);

    const inicio = minutosAHora(inicioMin);
    const fin = minutosAHora(finMin);
    await verificarCruceBarbero(conn, Number(id_barbero), fecha.texto, inicio, fin);

    let idCliente = Number(id_cliente) || null;
    if (idCliente) {
      const [existe] = await conn.query(`SELECT id_cliente FROM cliente WHERE id_cliente = ? FOR UPDATE`, [idCliente]);
      if (existe.length === 0) throw new ErrorNegocio('Cliente no encontrado', 404);
      await verificarCruceCliente(conn, idCliente, fecha.texto, inicio, fin);
    } else {
      const [nuevo] = await conn.query(
        `INSERT INTO cliente (nombre, telefono) VALUES (?, ?)`,
        [cliente_nombre.trim().slice(0, 100), cliente_telefono.trim().slice(0, 20)]
      );
      idCliente = nuevo.insertId;
    }

    const total = aBolivianos(atencion.totalCentavos);
    const [insert] = await conn.query(
      `INSERT INTO reserva
        (id_cliente, tipo_atencion, estado, fecha_reserva, hora_reserva, hora_fin, hora_llegada, es_domicilio,
         monto_total, anticipo_requerido, anticipo_pagado, saldo_pendiente, notas)
       VALUES (?, 'sin_reserva', 'atendida', ?, ?, ?, ?, 0, ?, 0, ?, 0, ?)`,
      [idCliente, fecha.texto, inicio, fin, inicio, total, total, String(notas).slice(0, 500)]
    );
    await insertarDetalle(conn, insert.insertId, Number(id_barbero), atencion.detalle);

    await conn.query(
      `INSERT INTO pago (id_reserva, tipo, metodo, monto, estado, revisado_por, revisado_en)
       VALUES (?, 'total', ?, ?, 'aprobado', ?, NOW())`,
      [insert.insertId, metodo_pago, total, req.user.id_usuario]
    );

    await conn.commit();
    res.status(201).json({
      success: true,
      message: `Atención presencial registrada de ${inicio.slice(0, 5)} a ${fin.slice(0, 5)} por Bs ${total.toFixed(2)}`,
      data: { id_reserva: insert.insertId, monto_total: total }
    });
  } catch (error) {
    if (conn) await conn.rollback();
    responderError(res, error, 'registrarPresencial');
  } finally {
    conn?.release();
  }
};

export const cancelarReserva = async (req, res) => {
  let conn;
  try {
    const esCliente = req.user.rol === 'cliente';
    conn = await iniciarTransaccion();
    const reserva = await bloquearReserva(conn, req.params.id, req.user);

    if (reserva.estado === 'en_revision') {
      throw new ErrorNegocio(esCliente
        ? 'Tu comprobante está en revisión. Espera la respuesta de la barbería antes de cancelar.'
        : 'Primero aprueba o rechaza el comprobante de esta reserva.');
    }
    if (!['pendiente_pago', ...ESTADOS_POR_ATENDER].includes(reserva.estado)) {
      throw new ErrorNegocio(`No se puede cancelar una reserva en estado "${reserva.estado}"`);
    }
    if (esCliente && reserva.minutos_para_cita <= 0) {
      throw new ErrorNegocio('La hora de la cita ya pasó; no se puede cancelar');
    }

    let mensaje = 'Reserva cancelada correctamente.';
    const [pagos] = await conn.query(
      `SELECT id_pago, monto FROM pago WHERE id_reserva = ? AND tipo = 'anticipo' AND estado = 'aprobado' FOR UPDATE`,
      [reserva.id_reserva]
    );

    if (pagos.length > 0) {
      const anticipo = Number(pagos[0].monto).toFixed(2);
      const conReembolso = !esCliente || reserva.minutos_para_cita >= HORAS_LIMITE_REEMBOLSO * 60;

      if (conReembolso) {
        await conn.query(`UPDATE pago SET estado = 'por_reembolsar' WHERE id_pago = ?`, [pagos[0].id_pago]);
        mensaje += ` Se devolverá el anticipo de Bs ${anticipo}.`;
      } else {
        mensaje += ` Por cancelar con menos de ${HORAS_LIMITE_REEMBOLSO} horas de anticipación, el anticipo de Bs ${anticipo} no se devuelve.`;
      }
    }

    await conn.query(
      `UPDATE reserva SET estado = 'cancelada', cancelado_por = ?, cancelado_en = NOW(), saldo_pendiente = 0, expira_en = NULL
       WHERE id_reserva = ?`,
      [esCliente ? 'cliente' : 'admin', reserva.id_reserva]
    );

    await conn.commit();
    res.json({ success: true, message: mensaje });
  } catch (error) {
    if (conn) await conn.rollback();
    responderError(res, error, 'cancelarReserva');
  } finally {
    conn?.release();
  }
};

// El cliente fue atendido: se cobra el saldo restante en el local
export const atenderReserva = async (req, res) => {
  let conn;
  try {
    const { metodo_pago } = req.body;
    if (!['efectivo', 'qr'].includes(metodo_pago)) throw new ErrorNegocio('Método de pago inválido');

    conn = await iniciarTransaccion();
    const reserva = await bloquearReserva(conn, req.params.id, req.user);

    if (!ESTADOS_POR_ATENDER.includes(reserva.estado)) {
      throw new ErrorNegocio(`Solo se pueden atender reservas confirmadas (estado actual: "${reserva.estado}")`);
    }

    const saldoCentavos = Math.round(Number(reserva.monto_total) * 100) - Math.round(Number(reserva.anticipo_pagado) * 100);
    if (saldoCentavos > 0) {
      await conn.query(
        `INSERT INTO pago (id_reserva, tipo, metodo, monto, estado, revisado_por, revisado_en)
         VALUES (?, 'saldo', ?, ?, 'aprobado', ?, NOW())`,
        [reserva.id_reserva, metodo_pago, aBolivianos(saldoCentavos), req.user.id_usuario]
      );
    }

    await conn.query(
      `UPDATE reserva SET estado = 'atendida', anticipo_pagado = monto_total, saldo_pendiente = 0 WHERE id_reserva = ?`,
      [reserva.id_reserva]
    );

    await conn.commit();
    res.json({
      success: true,
      message: saldoCentavos > 0
        ? `Cita atendida. Saldo cobrado: Bs ${aBolivianos(saldoCentavos).toFixed(2)}`
        : 'Cita atendida. No había saldo pendiente.'
    });
  } catch (error) {
    if (conn) await conn.rollback();
    responderError(res, error, 'atenderReserva');
  } finally {
    conn?.release();
  }
};

// El cliente no se presentó: el anticipo pagado no se devuelve
export const marcarNoAsistio = async (req, res) => {
  let conn;
  try {
    conn = await iniciarTransaccion();
    const reserva = await bloquearReserva(conn, req.params.id, req.user);

    if (!ESTADOS_POR_ATENDER.includes(reserva.estado)) {
      throw new ErrorNegocio(`No se puede marcar inasistencia en estado "${reserva.estado}"`);
    }
    if (reserva.minutos_para_cita > 0) {
      throw new ErrorNegocio('Solo se puede marcar inasistencia cuando ya llegó la hora de la cita');
    }

    await conn.query(`UPDATE reserva SET estado = 'no_asistio', saldo_pendiente = 0 WHERE id_reserva = ?`, [reserva.id_reserva]);
    await conn.commit();
    res.json({ success: true, message: 'Reserva marcada como "no asistió". El anticipo queda como ingreso.' });
  } catch (error) {
    if (conn) await conn.rollback();
    responderError(res, error, 'marcarNoAsistio');
  } finally {
    conn?.release();
  }
};
