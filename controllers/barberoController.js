/**
 * Controlador de Barberos y Matriz de Habilidades con Validación de Citas Pendientes
 * Z-BARBER
 */

import pool from '../config/db.js';
import { SQL_RESERVA_ACTIVA, responderError } from '../utils/agenda.js';

export const getBarberos = async (req, res) => {
  try {
    const [barberos] = await pool.query(`
      SELECT b.*,
             (SELECT COUNT(*) 
              FROM reserva r 
              JOIN reserva_servicio rs ON r.id_reserva = rs.id_reserva 
              WHERE rs.id_barbero = b.id_barbero 
                AND ${SQL_RESERVA_ACTIVA}) AS citas_pendientes
      FROM barbero b 
      ORDER BY b.id_barbero ASC
    `);

    const [habilidades] = await pool.query(`SELECT * FROM barbero_servicio`);

    const data = barberos.map((b) => ({
      ...b,
      servicios_asignados: habilidades
        .filter((h) => h.id_barbero === b.id_barbero)
        .map((h) => h.id_servicio)
    }));

    res.json({ success: true, data });
  } catch (error) {
    responderError(res, error, 'barberos');
  }
};

export const crearBarbero = async (req, res) => {
  try {
    const { nombre, sexo, anos_experiencia, telefono } = req.body;
    if (!nombre) {
      return res.status(400).json({ success: false, message: 'El nombre es obligatorio' });
    }

    const [result] = await pool.query(
      `INSERT INTO barbero (nombre, sexo, anos_experiencia, telefono, estado) VALUES (?, ?, ?, ?, 'activo')`,
      [nombre, sexo || 'M', anos_experiencia || 0, telefono || null]
    );

    res.status(201).json({ success: true, message: 'Barbero creado exitosamente', id_barbero: result.insertId });
  } catch (error) {
    responderError(res, error, 'barberos');
  }
};

export const actualizarBarbero = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, sexo, anos_experiencia, telefono, estado } = req.body;

    // Si se intenta inactivar el barbero, verificar si tiene citas pendientes
    if (estado === 'inactivo' || estado === 'vacaciones') {
      const [pendientes] = await pool.query(`
        SELECT COUNT(*) AS total
        FROM reserva r
        JOIN reserva_servicio rs ON r.id_reserva = rs.id_reserva
        WHERE rs.id_barbero = ? AND ${SQL_RESERVA_ACTIVA}
      `, [id]);

      if (pendientes[0].total > 0) {
        return res.status(400).json({
          success: false,
          message: `No se puede cambiar el estado a '${estado}' porque el barbero tiene ${pendientes[0].total} cita(s) pendiente(s) agendada(s). Reasigna las citas a otro profesional antes de cambiar su estado.`
        });
      }
    }

    await pool.query(
      `UPDATE barbero SET nombre = ?, sexo = ?, anos_experiencia = ?, telefono = ?, estado = ? WHERE id_barbero = ?`,
      [nombre, sexo, anos_experiencia, telefono, estado || 'activo', id]
    );

    res.json({ success: true, message: 'Barbero actualizado correctamente' });
  } catch (error) {
    responderError(res, error, 'barberos');
  }
};

export const eliminarBarbero = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. VALIDACIÓN ESTRICTA: ¿El barbero tiene citas pendientes o confirmadas?
    const [citasPendientes] = await pool.query(`
      SELECT r.id_reserva, r.fecha_reserva, r.hora_reserva, c.nombre AS cliente_nombre
      FROM reserva r
      INNER JOIN reserva_servicio rs ON r.id_reserva = rs.id_reserva
      LEFT JOIN cliente c ON r.id_cliente = c.id_cliente
      WHERE rs.id_barbero = ?
        AND ${SQL_RESERVA_ACTIVA}
    `, [id]);

    if (citasPendientes.length > 0) {
      const cantidad = citasPendientes.length;
      return res.status(400).json({
        success: false,
        message: `⛔ OPERACIÓN BLOQUEADA: No se puede eliminar a este barbero porque tiene ${cantidad} cita(s) pendiente(s) o confirmada(s) asignadas. Debes reasignar sus clientes a otro barbero o completar la atención antes de proceder a la eliminación.`
      });
    }

    // 2. Si tiene citas pasadas en el historial (atendidas o canceladas), hacemos soft-delete (inactivar)
    const [historico] = await pool.query(`
      SELECT COUNT(*) AS total FROM reserva_servicio WHERE id_barbero = ?
    `, [id]);

    if (historico[0].total > 0) {
      await pool.query(`UPDATE barbero SET estado = 'inactivo' WHERE id_barbero = ?`, [id]);
      return res.json({
        success: true,
        message: 'El barbero fue cambiado a estado Inactivo para preservar el historial de citas pasadas.'
      });
    }

    // Si no tiene ningún registro, se elimina físicamente
    await pool.query(`DELETE FROM barbero_servicio WHERE id_barbero = ?`, [id]);
    await pool.query(`DELETE FROM barbero WHERE id_barbero = ?`, [id]);

    res.json({ success: true, message: 'Barbero eliminado permanentemente de la base de datos.' });
  } catch (error) {
    responderError(res, error, 'barberos');
  }
};

export const toggleHabilidad = async (req, res) => {
  try {
    const { id_barbero, id_servicio } = req.body;

    const [existe] = await pool.query(
      `SELECT * FROM barbero_servicio WHERE id_barbero = ? AND id_servicio = ?`,
      [id_barbero, id_servicio]
    );

    if (existe.length > 0) {
      // VALIDACIÓN: Verificar si el barbero tiene citas pendientes para este servicio específico antes de desasignar
      const [citasPendientesServicio] = await pool.query(`
        SELECT COUNT(*) AS total
        FROM reserva r
        INNER JOIN reserva_servicio rs ON r.id_reserva = rs.id_reserva
        WHERE rs.id_barbero = ?
          AND rs.id_servicio = ?
          AND ${SQL_RESERVA_ACTIVA}
      `, [id_barbero, id_servicio]);

      if (citasPendientesServicio[0].total > 0) {
        return res.status(400).json({
          success: false,
          message: `⛔ No se puede desasignar este servicio porque el barbero tiene ${citasPendientesServicio[0].total} cita(s) pendiente(s) agendada(s) para este corte específico. Completa o reasigna esas citas primero.`
        });
      }

      await pool.query(
        `DELETE FROM barbero_servicio WHERE id_barbero = ? AND id_servicio = ?`,
        [id_barbero, id_servicio]
      );
      res.json({ success: true, message: 'Servicio desasignado del barbero', asignado: false });
    } else {
      await pool.query(
        `INSERT INTO barbero_servicio (id_barbero, id_servicio) VALUES (?, ?)`,
        [id_barbero, id_servicio]
      );
      res.json({ success: true, message: 'Servicio asignado al barbero', asignado: true });
    }
  } catch (error) {
    responderError(res, error, 'barberos');
  }
};
