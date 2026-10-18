/**
 * Controlador de Reportes y Gastos
 * Los ingresos son el dinero realmente recibido: pagos aprobados (no incluye reembolsos)
 * Z-BARBER
 */

import pool from '../config/db.js';
import { parsearFecha, responderError } from '../utils/agenda.js';

function rango(columna, desde, hasta, params) {
  let sql = '';
  if (desde) { sql += ` AND ${columna} >= ?`; params.push(desde); }
  if (hasta) { sql += ` AND ${columna} <= ?`; params.push(hasta); }
  return sql;
}

export const getReportesFinancieros = async (req, res) => {
  try {
    const desde = req.query.desde ? parsearFecha(req.query.desde).texto : null;
    const hasta = req.query.hasta ? parsearFecha(req.query.hasta).texto : null;

    const pIngresos = [];
    const [[ingresos]] = await pool.query(
      `SELECT COALESCE(SUM(monto), 0) AS total_ingresos,
              COALESCE(SUM(CASE WHEN tipo = 'anticipo' THEN monto END), 0) AS ingresos_anticipos,
              COALESCE(SUM(CASE WHEN tipo <> 'anticipo' THEN monto END), 0) AS ingresos_local
       FROM pago
       WHERE estado = 'aprobado' ${rango('DATE(COALESCE(revisado_en, subido_en))', desde, hasta, pIngresos)}`,
      pIngresos
    );

    const pGastos = [];
    const [[gastos]] = await pool.query(
      `SELECT COALESCE(SUM(monto), 0) AS total_gastos FROM gasto WHERE 1=1 ${rango('fecha_gasto', desde, hasta, pGastos)}`,
      pGastos
    );

    const pDetalle = [];
    const [gastosDetalle] = await pool.query(
      `SELECT id_gasto, descripcion, monto, categoria, DATE_FORMAT(fecha_gasto, '%Y-%m-%d') AS fecha_gasto
       FROM gasto WHERE 1=1 ${rango('fecha_gasto', desde, hasta, pDetalle)}
       ORDER BY fecha_gasto DESC LIMIT 50`,
      pDetalle
    );

    const pCitas = [];
    const [[citas]] = await pool.query(
      `SELECT COUNT(*) AS total_citas,
              COUNT(CASE WHEN estado = 'atendida' THEN 1 END) AS citas_atendidas,
              COUNT(CASE WHEN estado = 'atendida' AND tipo_atencion = 'sin_reserva' THEN 1 END) AS atenciones_presenciales,
              COUNT(CASE WHEN estado = 'cancelada' THEN 1 END) AS citas_canceladas,
              COUNT(CASE WHEN estado = 'no_asistio' THEN 1 END) AS citas_no_asistio
       FROM reserva WHERE 1=1 ${rango('fecha_reserva', desde, hasta, pCitas)}`,
      pCitas
    );

    const [[pendientes]] = await pool.query(
      `SELECT
         (SELECT COALESCE(SUM(saldo_pendiente), 0) FROM reserva WHERE estado IN ('pendiente', 'confirmada', 'en_espera')) AS saldo_por_cobrar,
         (SELECT COUNT(*) FROM pago WHERE estado = 'en_revision') AS pagos_por_revisar,
         (SELECT COALESCE(SUM(monto), 0) FROM pago WHERE estado = 'por_reembolsar') AS monto_por_reembolsar`
    );

    const pTop = [];
    const [topServicios] = await pool.query(
      `SELECT s.nombre_servicio, COUNT(*) AS total_pedidos
       FROM reserva_servicio rs
       JOIN reserva r ON r.id_reserva = rs.id_reserva
       JOIN servicio s ON rs.id_servicio = s.id_servicio
       WHERE r.estado = 'atendida' ${rango('r.fecha_reserva', desde, hasta, pTop)}
       GROUP BY s.id_servicio, s.nombre_servicio
       ORDER BY total_pedidos DESC
       LIMIT 5`,
      pTop
    );

    const totalIngresos = Number(ingresos.total_ingresos);
    const totalGastos = Number(gastos.total_gastos);

    res.json({
      success: true,
      data: {
        desde,
        hasta,
        total_ingresos: totalIngresos,
        ingresos_anticipos: Number(ingresos.ingresos_anticipos),
        ingresos_local: Number(ingresos.ingresos_local),
        total_gastos: totalGastos,
        ganancia_neta: Number((totalIngresos - totalGastos).toFixed(2)),
        citas_totales: citas.total_citas,
        citas_atendidas: citas.citas_atendidas,
        atenciones_presenciales: citas.atenciones_presenciales,
        citas_canceladas: citas.citas_canceladas,
        citas_no_asistio: citas.citas_no_asistio,
        saldo_por_cobrar: Number(pendientes.saldo_por_cobrar),
        pagos_por_revisar: pendientes.pagos_por_revisar,
        monto_por_reembolsar: Number(pendientes.monto_por_reembolsar),
        top_servicios: topServicios,
        gastos_recientes: gastosDetalle
      }
    });
  } catch (error) {
    responderError(res, error, 'getReportesFinancieros');
  }
};
