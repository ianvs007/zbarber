/**
 * Controlador de Pagos por QR: QR del negocio, comprobantes, aprobación y reembolsos
 * Z-BARBER
 */

import pool from '../config/db.js';
import {
  MINUTOS_PARA_PAGAR,
  MAX_RECHAZOS_PAGO,
  ErrorNegocio,
  responderError
} from '../utils/agenda.js';
import { detectarTipo, sha256, guardarArchivo, eliminarArchivo, enviarArchivo } from '../utils/archivos.js';

const MIMES_COMPROBANTE = ['image/jpeg', 'image/png', 'application/pdf'];
const MIMES_QR = ['image/jpeg', 'image/png'];

async function iniciarTransaccion() {
  const conn = await pool.getConnection();
  await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
  await conn.beginTransaction();
  return conn;
}

async function bloquearPagoEnRevision(conn, id_pago) {
  const [rows] = await conn.query(
    `SELECT p.*, r.estado AS reserva_estado, r.monto_total, r.anticipo_pagado, r.rechazos_pago
     FROM pago p JOIN reserva r ON r.id_reserva = p.id_reserva
     WHERE p.id_pago = ? FOR UPDATE`,
    [id_pago]
  );
  const pago = rows[0];
  if (!pago) throw new ErrorNegocio('Pago no encontrado', 404);
  if (pago.estado !== 'en_revision') throw new ErrorNegocio(`Este pago ya fue procesado (estado: "${pago.estado}")`, 409);
  if (pago.reserva_estado !== 'en_revision') throw new ErrorNegocio('La reserva de este pago ya no está en revisión', 409);
  return pago;
}

/* ===================== QR DEL NEGOCIO ===================== */

export const obtenerInfoQr = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT banco, titular, actualizado_en, qr_archivo IS NOT NULL AS disponible FROM configuracion_pago WHERE id = 1`
    );
    const info = rows[0] || { disponible: 0 };
    res.json({ success: true, data: { ...info, disponible: Boolean(info.disponible) } });
  } catch (error) {
    responderError(res, error, 'obtenerInfoQr');
  }
};

export const obtenerImagenQr = async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT qr_archivo, qr_mime FROM configuracion_pago WHERE id = 1`);
    if (!rows[0]?.qr_archivo) throw new ErrorNegocio('La barbería aún no configuró su QR de pago', 404);
    enviarArchivo(res, 'qr', rows[0].qr_archivo, rows[0].qr_mime);
  } catch (error) {
    responderError(res, error, 'obtenerImagenQr');
  }
};

export const actualizarQr = async (req, res) => {
  let nuevoArchivo = null;
  try {
    const banco = String(req.body.banco || '').trim().slice(0, 100) || null;
    const titular = String(req.body.titular || '').trim().slice(0, 100) || null;

    const [rows] = await pool.query(`SELECT qr_archivo FROM configuracion_pago WHERE id = 1`);
    const anterior = rows[0]?.qr_archivo || null;

    let mime = null;
    if (req.file) {
      const tipo = detectarTipo(req.file.buffer, MIMES_QR);
      nuevoArchivo = await guardarArchivo('qr', req.file.buffer, tipo);
      mime = tipo.mime;
    } else if (!anterior) {
      throw new ErrorNegocio('Debe subir la imagen del QR');
    }

    await pool.query(
      `INSERT INTO configuracion_pago (id, qr_archivo, qr_mime, banco, titular) VALUES (1, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         qr_archivo = COALESCE(VALUES(qr_archivo), qr_archivo),
         qr_mime = COALESCE(VALUES(qr_mime), qr_mime),
         banco = VALUES(banco), titular = VALUES(titular)`,
      [nuevoArchivo, mime, banco, titular]
    );

    if (nuevoArchivo && anterior) await eliminarArchivo('qr', anterior);
    res.json({ success: true, message: nuevoArchivo ? 'QR de pago actualizado' : 'Datos de la cuenta actualizados' });
  } catch (error) {
    if (nuevoArchivo) await eliminarArchivo('qr', nuevoArchivo);
    responderError(res, error, 'actualizarQr');
  }
};

/* ===================== COMPROBANTES ===================== */

export const subirComprobante = async (req, res) => {
  let conn;
  let archivo = null;
  try {
    if (!req.file) throw new ErrorNegocio('Debe adjuntar el comprobante de pago');

    const tipo = detectarTipo(req.file.buffer, MIMES_COMPROBANTE);
    const hash = sha256(req.file.buffer);

    const nroTransaccion = String(req.body.nro_transaccion || '').trim() || null;
    if (nroTransaccion && !/^[A-Za-z0-9-]{3,50}$/.test(nroTransaccion)) {
      throw new ErrorNegocio('El número de transacción solo puede tener letras, números y guiones (3 a 50 caracteres)');
    }

    conn = await iniciarTransaccion();

    const [rows] = await conn.query(
      `SELECT id_reserva, estado, anticipo_requerido, expira_en > NOW() AS vigente
       FROM reserva WHERE id_reserva = ? AND id_cliente = ? FOR UPDATE`,
      [req.params.id, req.user.id_cliente]
    );
    const reserva = rows[0];
    if (!reserva) throw new ErrorNegocio('Reserva no encontrada', 404);
    if (reserva.estado !== 'pendiente_pago') {
      throw new ErrorNegocio(reserva.estado === 'en_revision'
        ? 'Ya enviaste un comprobante; está en revisión'
        : 'Esta reserva no está esperando un pago');
    }
    if (!reserva.vigente) {
      throw new ErrorNegocio(`El plazo de ${MINUTOS_PARA_PAGAR} minutos para pagar venció y el horario fue liberado. Realiza una nueva reserva.`);
    }

    const [duplicados] = await conn.query(
      `SELECT comprobante_sha256 = ? AS mismo_archivo FROM pago
       WHERE comprobante_sha256 = ? OR (? IS NOT NULL AND nro_transaccion = ?) LIMIT 1`,
      [hash, hash, nroTransaccion, nroTransaccion]
    );
    if (duplicados.length > 0) {
      throw new ErrorNegocio(duplicados[0].mismo_archivo
        ? 'Este comprobante ya fue enviado anteriormente'
        : 'Ese número de transacción ya fue registrado en otro pago', 409);
    }

    archivo = await guardarArchivo('comprobantes', req.file.buffer, tipo);

    await conn.query(
      `INSERT INTO pago (id_reserva, tipo, metodo, monto, estado, comprobante_archivo, comprobante_mime, comprobante_sha256, nro_transaccion)
       VALUES (?, 'anticipo', 'qr', ?, 'en_revision', ?, ?, ?, ?)`,
      [reserva.id_reserva, reserva.anticipo_requerido, archivo, tipo.mime, hash, nroTransaccion]
    );
    await conn.query(`UPDATE reserva SET estado = 'en_revision', expira_en = NULL WHERE id_reserva = ?`, [reserva.id_reserva]);

    await conn.commit();
    res.status(201).json({ success: true, message: 'Comprobante enviado. La barbería verificará tu pago y confirmará la reserva.' });
  } catch (error) {
    if (conn) await conn.rollback();
    if (archivo) await eliminarArchivo('comprobantes', archivo);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'Este comprobante o número de transacción ya fue registrado' });
    }
    responderError(res, error, 'subirComprobante');
  } finally {
    conn?.release();
  }
};

export const verComprobante = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.comprobante_archivo, p.comprobante_mime, r.id_cliente
       FROM pago p JOIN reserva r ON r.id_reserva = p.id_reserva WHERE p.id_pago = ?`,
      [req.params.id]
    );
    const pago = rows[0];
    if (!pago || !pago.comprobante_archivo || (req.user.rol === 'cliente' && pago.id_cliente !== req.user.id_cliente)) {
      throw new ErrorNegocio('Comprobante no encontrado', 404);
    }
    enviarArchivo(res, 'comprobantes', pago.comprobante_archivo, pago.comprobante_mime);
  } catch (error) {
    responderError(res, error, 'verComprobante');
  }
};

/* ===================== REVISIÓN DEL DUEÑO ===================== */

export const aprobarPago = async (req, res) => {
  let conn;
  try {
    conn = await iniciarTransaccion();
    const pago = await bloquearPagoEnRevision(conn, req.params.id);

    await conn.query(
      `UPDATE pago SET estado = 'aprobado', revisado_por = ?, revisado_en = NOW() WHERE id_pago = ?`,
      [req.user.id_usuario, pago.id_pago]
    );
    await conn.query(
      `UPDATE reserva
       SET estado = 'confirmada',
           anticipo_pagado = anticipo_pagado + ?,
           saldo_pendiente = GREATEST(monto_total - anticipo_pagado, 0)
       WHERE id_reserva = ?`,
      [pago.monto, pago.id_reserva]
    );

    await conn.commit();
    res.json({ success: true, message: `Pago de Bs ${Number(pago.monto).toFixed(2)} aprobado. La reserva quedó confirmada.` });
  } catch (error) {
    if (conn) await conn.rollback();
    responderError(res, error, 'aprobarPago');
  } finally {
    conn?.release();
  }
};

export const rechazarPago = async (req, res) => {
  let conn;
  try {
    const motivo = String(req.body.motivo || '').trim();
    if (motivo.length < 3 || motivo.length > 255) throw new ErrorNegocio('Indique el motivo del rechazo (3 a 255 caracteres)');

    conn = await iniciarTransaccion();
    const pago = await bloquearPagoEnRevision(conn, req.params.id);

    await conn.query(
      `UPDATE pago SET estado = 'rechazado', motivo_rechazo = ?, revisado_por = ?, revisado_en = NOW() WHERE id_pago = ?`,
      [motivo, req.user.id_usuario, pago.id_pago]
    );

    const rechazos = Number(pago.rechazos_pago) + 1;
    let mensaje;

    if (rechazos >= MAX_RECHAZOS_PAGO) {
      await conn.query(
        `UPDATE reserva SET estado = 'cancelada', rechazos_pago = ?, cancelado_por = 'admin', cancelado_en = NOW(),
                saldo_pendiente = 0, expira_en = NULL
         WHERE id_reserva = ?`,
        [rechazos, pago.id_reserva]
      );
      mensaje = `Comprobante rechazado por ${rechazos}ª vez. La reserva fue cancelada y el horario quedó libre.`;
    } else {
      await conn.query(
        `UPDATE reserva SET estado = 'pendiente_pago', rechazos_pago = ?, expira_en = DATE_ADD(NOW(), INTERVAL ? MINUTE)
         WHERE id_reserva = ?`,
        [rechazos, MINUTOS_PARA_PAGAR, pago.id_reserva]
      );
      mensaje = `Comprobante rechazado. El cliente tiene ${MINUTOS_PARA_PAGAR} minutos para subir otro comprobante (último intento).`;
    }

    await conn.commit();
    res.json({ success: true, message: mensaje });
  } catch (error) {
    if (conn) await conn.rollback();
    responderError(res, error, 'rechazarPago');
  } finally {
    conn?.release();
  }
};

export const marcarReembolsado = async (req, res) => {
  try {
    const [result] = await pool.query(
      `UPDATE pago SET estado = 'reembolsado' WHERE id_pago = ? AND estado = 'por_reembolsar'`,
      [req.params.id]
    );
    if (result.affectedRows === 0) throw new ErrorNegocio('Este pago no está pendiente de reembolso', 409);
    res.json({ success: true, message: 'Reembolso registrado' });
  } catch (error) {
    responderError(res, error, 'marcarReembolsado');
  }
};
