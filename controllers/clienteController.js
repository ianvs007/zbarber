/**
 * Controlador de Clientes
 * Z-BARBER
 */

import pool from '../config/db.js';
import { SQL_RESERVA_ACTIVA, responderError } from '../utils/agenda.js';

export const getClientes = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.*,
             (SELECT COUNT(*) FROM reserva r WHERE r.id_cliente = c.id_cliente AND r.estado = 'atendida') AS total_visitas,
             (SELECT COALESCE(SUM(p.monto), 0)
                FROM pago p JOIN reserva r ON r.id_reserva = p.id_reserva
               WHERE r.id_cliente = c.id_cliente AND p.estado = 'aprobado') AS total_gastado
      FROM cliente c
      ORDER BY c.nombre ASC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    responderError(res, error, 'getClientes');
  }
};

export const crearCliente = async (req, res) => {
  try {
    const { nombre, telefono, email, notas } = req.body;
    if (!nombre || !telefono) {
      return res.status(400).json({ success: false, message: 'Nombre y teléfono son obligatorios' });
    }

    const [result] = await pool.query(
      `INSERT INTO cliente (nombre, telefono, email, notas) VALUES (?, ?, ?, ?)`,
      [nombre.trim(), telefono.trim(), email ? email.trim() : null, notas ? notas.trim() : null]
    );

    res.status(201).json({
      success: true,
      message: 'Cliente creado correctamente',
      id_cliente: result.insertId
    });
  } catch (error) {
    responderError(res, error, 'crearCliente');
  }
};

export const actualizarCliente = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, telefono, email, notas } = req.body;

    if (!nombre || !telefono) {
      return res.status(400).json({ success: false, message: 'Nombre y teléfono son obligatorios' });
    }

    const [result] = await pool.query(
      `UPDATE cliente SET nombre = ?, telefono = ?, email = ?, notas = ? WHERE id_cliente = ?`,
      [nombre.trim(), telefono.trim(), email ? email.trim() : null, notas ? notas.trim() : null, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Cliente no encontrado' });
    }

    res.json({ success: true, message: 'Cliente actualizado correctamente' });
  } catch (error) {
    responderError(res, error, 'actualizarCliente');
  }
};

export const eliminarCliente = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Validar que no tenga citas activas o pendientes
    const [citasPendientes] = await pool.query(`
      SELECT r.id_reserva, r.fecha_reserva, r.hora_reserva
      FROM reserva r
      WHERE r.id_cliente = ?
        AND ${SQL_RESERVA_ACTIVA}
    `, [id]);

    if (citasPendientes.length > 0) {
      const cantidad = citasPendientes.length;
      return res.status(400).json({
        success: false,
        message: `⛔ OPERACIÓN BLOQUEADA: No se puede eliminar este cliente porque tiene ${cantidad} cita(s) pendiente(s) o activa(s). Debes atender o cancelar esas citas antes de eliminar.`
      });
    }

    // 2. Validar que no tenga citas registradas en el historial (preservar auditoría)
    const [historico] = await pool.query(`
      SELECT COUNT(*) AS total FROM reserva WHERE id_cliente = ?
    `, [id]);

    if (historico[0].total > 0) {
      return res.status(400).json({
        success: false,
        message: `⛔ No se puede eliminar este cliente porque cuenta con ${historico[0].total} cita(s) en su historial. Para preservar los registros de reservas y pagos, no se permite borrar clientes con historial.`
      });
    }

    // 3. Eliminar usuario asociado si existe
    await pool.query(`DELETE FROM usuario WHERE id_cliente = ?`, [id]);

    // 4. Eliminar cliente
    const [result] = await pool.query(`DELETE FROM cliente WHERE id_cliente = ?`, [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Cliente no encontrado' });
    }

    res.json({ success: true, message: 'Cliente eliminado correctamente' });
  } catch (error) {
    if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.code === 'ER_ROW_IS_REFERENCED') {
      return res.status(400).json({
        success: false,
        message: 'No se puede eliminar este cliente porque tiene registros asociados en el sistema.'
      });
    }
    responderError(res, error, 'eliminarCliente');
  }
};
