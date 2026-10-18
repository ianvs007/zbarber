/**
 * Controlador del Horario de Atención (configurable por el administrador)
 * Z-BARBER
 */

import pool from '../config/db.js';
import { ErrorNegocio, horaAMinutos, minutosAHora, responderError } from '../utils/agenda.js';

export const getHorario = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT dia_semana, abierto, hora_apertura, hora_cierre FROM horario_atencion ORDER BY dia_semana`
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    responderError(res, error, 'getHorario');
  }
};

export const actualizarHorario = async (req, res) => {
  let conn;
  try {
    const { dias } = req.body;
    if (!Array.isArray(dias) || dias.length !== 7) throw new ErrorNegocio('Debe enviar el horario de los 7 días');

    const filas = dias.map(d => {
      const dia = Number(d.dia_semana);
      if (!Number.isInteger(dia) || dia < 0 || dia > 6) throw new ErrorNegocio('Día inválido');
      const apertura = horaAMinutos(d.hora_apertura);
      const cierre = horaAMinutos(d.hora_cierre);
      if (cierre <= apertura) throw new ErrorNegocio('La hora de cierre debe ser posterior a la de apertura');
      return [dia, d.abierto ? 1 : 0, minutosAHora(apertura), minutosAHora(cierre)];
    });
    if (new Set(filas.map(f => f[0])).size !== 7) throw new ErrorNegocio('Hay días repetidos en el horario');

    conn = await pool.getConnection();
    await conn.beginTransaction();
    for (const fila of filas) {
      await conn.query(
        `INSERT INTO horario_atencion (dia_semana, abierto, hora_apertura, hora_cierre) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE abierto = VALUES(abierto), hora_apertura = VALUES(hora_apertura), hora_cierre = VALUES(hora_cierre)`,
        fila
      );
    }
    await conn.commit();

    res.json({ success: true, message: 'Horario de atención actualizado' });
  } catch (error) {
    if (conn) await conn.rollback();
    responderError(res, error, 'actualizarHorario');
  } finally {
    conn?.release();
  }
};
