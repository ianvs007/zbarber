/**
 * Controlador de Servicios con Validación de Integridad de Reservas
 * Z-BARBER
 */

import pool from '../config/db.js';
import { SQL_RESERVA_ACTIVA, responderError } from '../utils/agenda.js';

export const getServicios = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.*, sd.precio_domicilio,
             (SELECT COUNT(*) 
              FROM reserva r 
              JOIN reserva_servicio rs ON r.id_reserva = rs.id_reserva 
              WHERE rs.id_servicio = s.id_servicio 
                AND ${SQL_RESERVA_ACTIVA}) AS reservas_pendientes
      FROM servicio s
      LEFT JOIN servicio_domicilio sd ON s.id_servicio = sd.id_servicio
      ORDER BY s.id_servicio ASC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    responderError(res, error, 'servicios');
  }
};

export const crearServicio = async (req, res) => {
  try {
    const { nombre_servicio, precio, duracion_min, precio_domicilio, descripcion } = req.body;
    if (!nombre_servicio || !precio || !duracion_min) {
      return res.status(400).json({ success: false, message: 'Faltan campos obligatorios' });
    }
    if (!(Number(precio) > 0) || !(Number.isInteger(Number(duracion_min)) && Number(duracion_min) > 0)) {
      return res.status(400).json({ success: false, message: 'Precio y duración deben ser mayores a 0' });
    }

    const [result] = await pool.query(
      `INSERT INTO servicio (nombre_servicio, precio, duracion_min, estado) VALUES (?, ?, ?, 'activo')`,
      [nombre_servicio, precio, duracion_min]
    );

    const id_servicio = result.insertId;

    if (precio_domicilio && Number(precio_domicilio) > 0) {
      await pool.query(
        `INSERT INTO servicio_domicilio (id_servicio, precio_domicilio) VALUES (?, ?)`,
        [id_servicio, precio_domicilio]
      );
    }

    res.status(201).json({ success: true, message: 'Servicio creado exitosamente', id_servicio });
  } catch (error) {
    responderError(res, error, 'servicios');
  }
};

export const actualizarServicio = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre_servicio, precio, duracion_min, estado, precio_domicilio } = req.body;

    // 1. Verificar si existen reservas pendientes o activas asociadas a este servicio
    const [pendientesRows] = await pool.query(`
      SELECT COUNT(r.id_reserva) AS total_pendientes
      FROM reserva r
      INNER JOIN reserva_servicio rs ON r.id_reserva = rs.id_reserva
      WHERE rs.id_servicio = ?
        AND ${SQL_RESERVA_ACTIVA}
    `, [id]);

    const totalPendientes = pendientesRows[0].total_pendientes;

    // Obtener servicio actual para comparar si cambiaron la duración
    const [actualRows] = await pool.query(`SELECT duracion_min, estado FROM servicio WHERE id_servicio = ?`, [id]);
    if (actualRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Servicio no encontrado' });
    }

    const duracionActual = actualRows[0].duracion_min;
    if (estado && !['activo', 'inactivo'].includes(estado)) {
      return res.status(400).json({ success: false, message: 'Estado de servicio inválido' });
    }
    if (precio !== undefined && !(Number(precio) > 0)) {
      return res.status(400).json({ success: false, message: 'El precio debe ser mayor a 0' });
    }
    if (duracion_min !== undefined && !(Number.isInteger(Number(duracion_min)) && Number(duracion_min) > 0)) {
      return res.status(400).json({ success: false, message: 'La duración debe ser un número entero de minutos mayor a 0' });
    }

    // Si tiene reservas pendientes y quieren cambiar la duración:
    // Bloquear cambio de duración para no arruinar la grilla horaria ya comprometida con el cliente
    if (totalPendientes > 0 && duracion_min && Number(duracion_min) !== Number(duracionActual)) {
      return res.status(400).json({
        success: false,
        message: `No se puede modificar la duración de este servicio (${duracionActual} min) porque tiene ${totalPendientes} cita(s) pendiente(s) agendada(s). Alterar la duración causaría solapamientos con las horas pactadas. Puedes modificar el precio o pausar el servicio para nuevos clientes.`
      });
    }

    // Actualizar servicio
    await pool.query(
      `UPDATE servicio SET nombre_servicio = ?, precio = ?, duracion_min = ?, estado = ? WHERE id_servicio = ?`,
      [nombre_servicio, precio, duracion_min || duracionActual, estado || actualRows[0].estado, id]
    );

    // Actualizar o insertar tarifa a domicilio
    if (precio_domicilio !== undefined) {
      const [domicilioRows] = await pool.query(`SELECT id_servicio_domicilio FROM servicio_domicilio WHERE id_servicio = ?`, [id]);
      if (domicilioRows.length > 0) {
        if (Number(precio_domicilio) > 0) {
          await pool.query(`UPDATE servicio_domicilio SET precio_domicilio = ? WHERE id_servicio = ?`, [precio_domicilio, id]);
        } else {
          await pool.query(`DELETE FROM servicio_domicilio WHERE id_servicio = ?`, [id]);
        }
      } else if (Number(precio_domicilio) > 0) {
        await pool.query(`INSERT INTO servicio_domicilio (id_servicio, precio_domicilio) VALUES (?, ?)`, [id, precio_domicilio]);
      }
    }

    res.json({ success: true, message: 'Servicio actualizado correctamente' });
  } catch (error) {
    responderError(res, error, 'servicios');
  }
};

export const eliminarServicio = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. VALIDACIÓN ESTRICTA: Verificar si el servicio tiene reservas pendientes o confirmadas
    const [pendientesRows] = await pool.query(`
      SELECT r.id_reserva, r.fecha_reserva, r.hora_reserva, c.nombre AS cliente_nombre
      FROM reserva r
      INNER JOIN reserva_servicio rs ON r.id_reserva = rs.id_reserva
      LEFT JOIN cliente c ON r.id_cliente = c.id_cliente
      WHERE rs.id_servicio = ?
        AND ${SQL_RESERVA_ACTIVA}
    `, [id]);

    if (pendientesRows.length > 0) {
      const cantidad = pendientesRows.length;
      const primeraCita = pendientesRows[0];
      return res.status(400).json({
        success: false,
        message: `⛔ OPERACIÓN BLOQUEADA: No se puede eliminar este servicio porque tiene ${cantidad} cita(s) pendiente(s) o confirmada(s) (ej: Cliente ${primeraCita.cliente_nombre || 'Cliente'} el ${primeraCita.fecha_reserva} a las ${primeraCita.hora_reserva}). Debes atender o cancelar esas citas antes de eliminar, o poner el servicio en estado 'En Pausa' para no aceptar nuevas reservas.`
      });
    }

    // 2. Si no tiene citas pendientes, verificar si tiene historial pasado (atendida/cancelada)
    const [historicoRows] = await pool.query(`
      SELECT COUNT(*) AS total_historico FROM reserva_servicio WHERE id_servicio = ?
    `, [id]);

    if (historicoRows[0].total_historico > 0) {
      // Para preservar la integridad histórica contable, se realiza soft-delete (marcar como inactivo)
      await pool.query(`UPDATE servicio SET estado = 'inactivo' WHERE id_servicio = ?`, [id]);
      return res.json({
        success: true,
        message: 'El servicio fue archivado e inactivado correctamente para preservar el historial de citas pasadas.'
      });
    }

    // Si no tiene ningún registro asociado, se elimina físicamente de la base de datos
    await pool.query(`DELETE FROM barbero_servicio WHERE id_servicio = ?`, [id]);
    await pool.query(`DELETE FROM servicio_domicilio WHERE id_servicio = ?`, [id]);
    await pool.query(`DELETE FROM servicio WHERE id_servicio = ?`, [id]);

    res.json({ success: true, message: 'Servicio eliminado permanentemente de la base de datos.' });
  } catch (error) {
    responderError(res, error, 'servicios');
  }
};
