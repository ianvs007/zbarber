/**
 * ==============================================================================
 * CONTROLADOR DE CLIENTES - Z-BARBER
 * ==============================================================================
 * Este archivo contiene todas las operaciones que se pueden hacer con los clientes:
 * 1. Consultar la lista de clientes (con su historial de visitas y compras).
 * 2. Registrar un nuevo cliente.
 * 3. Modificar datos de un cliente existente (nombre, teléfono, email, notas).
 * 4. Eliminar un cliente (protegido para no borrar citas pasadas ni pendientes).
 * 5. Resetear la contraseña de un cliente a solicitud del dueño (Admin).
 * ==============================================================================
 */

import pool from '../config/db.js';
import { SQL_RESERVA_ACTIVA, responderError } from '../utils/agenda.js';
import { encriptarPassword } from '../utils/password.js';

/**
 * FUNCIONALIDAD 1: OBTENER TODOS LOS CLIENTES
 * ------------------------------------------------------------------------------
 * ¿Qué hace?
 * Trae de la base de datos la lista completa de clientes ordenados alfabéticamente.
 *
 * ¿Por qué incluye subconsultas?
 * - Calcula automáticamente cuántas citas ya completó cada cliente (total_visitas).
 * - Suma todo el dinero que ha pagado en citas aprobadas (total_gastado).
 * - Identifica si el cliente ya tiene una cuenta con nombre de usuario para iniciar sesión.
 */
export const getClientes = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.*,
             (SELECT COUNT(*) FROM reserva r WHERE r.id_cliente = c.id_cliente AND r.estado = 'atendida') AS total_visitas,
             (SELECT COALESCE(SUM(p.monto), 0)
                FROM pago p JOIN reserva r ON r.id_reserva = p.id_reserva
               WHERE r.id_cliente = c.id_cliente AND p.estado = 'aprobado') AS total_gastado,
             u.usuario AS nombre_usuario
      FROM cliente c
      LEFT JOIN usuario u ON u.id_cliente = c.id_cliente
      ORDER BY c.nombre ASC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    responderError(res, error, 'getClientes');
  }
};

/**
 * FUNCIONALIDAD 2: REGISTRAR UN NUEVO CLIENTE
 * ------------------------------------------------------------------------------
 * ¿Qué hace?
 * Guarda en la base de datos a un cliente nuevo que el administrador ingresa
 * desde el botón "+ Nuevo Cliente".
 *
 * Reglas sencillas:
 * - El nombre y el teléfono son obligatorios (para poder contactarlo sobre su cita).
 * - El email y las notas (preferencias de corte, alergias, etc.) son opcionales.
 */
export const crearCliente = async (req, res) => {
  try {
    const { nombre, telefono, email, notas, usuario, password } = req.body;
    if (!nombre || !telefono) {
      return res.status(400).json({ success: false, message: 'Nombre y teléfono son obligatorios' });
    }

    const nuevoUsuario = usuario ? String(usuario).trim().toLowerCase() : null;
    if (nuevoUsuario) {
      const [colision] = await pool.query(
        `SELECT id_usuario FROM usuario WHERE usuario = ? LIMIT 1`,
        [nuevoUsuario]
      );
      if (colision.length > 0) {
        return res.status(409).json({
          success: false,
          message: `El nombre de usuario "${nuevoUsuario}" ya pertenece a otra persona. Por favor elige otro.`
        });
      }
    }

    const [result] = await pool.query(
      `INSERT INTO cliente (nombre, telefono, email, notas) VALUES (?, ?, ?, ?)`,
      [nombre.trim(), telefono.trim(), email ? email.trim() : null, notas ? notas.trim() : null]
    );

    const id_cliente = result.insertId;

    // Si se especificó un nombre de usuario, crearle cuenta web inmediatamente
    if (nuevoUsuario) {
      const clave = password && String(password).trim().length >= 4 ? String(password).trim() : '123456';
      const passwordHash = await encriptarPassword(clave);
      await pool.query(
        `INSERT INTO usuario (usuario, password_hash, nombre_completo, rol, id_cliente, estado)
         VALUES (?, ?, ?, 'cliente', ?, 1)`,
        [nuevoUsuario, passwordHash, nombre.trim(), id_cliente]
      );
    }

    res.status(201).json({
      success: true,
      message: 'Cliente creado correctamente',
      id_cliente
    });
  } catch (error) {
    responderError(res, error, 'crearCliente');
  }
};

/**
 * FUNCIONALIDAD 3: ACTUALIZAR DATOS DE UN CLIENTE (Y SU NOMBRE DE USUARIO)
 * ------------------------------------------------------------------------------
 * ¿Qué hace?
 * Modifica los datos personales de un cliente ya existente (si cambió de número,
 * corrigió su nombre, sus notas o si el admin desea cambiarle su nombre de usuario).
 */
export const actualizarCliente = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, telefono, email, notas, usuario } = req.body;

    if (!nombre || !telefono) {
      return res.status(400).json({ success: false, message: 'Nombre y teléfono son obligatorios' });
    }

    // 1. Si especificaron un nombre de usuario, verificar que no colisione con otro
    const nuevoUsuario = usuario ? String(usuario).trim().toLowerCase() : null;
    if (nuevoUsuario) {
      const [colision] = await pool.query(
        `SELECT id_usuario FROM usuario WHERE usuario = ? AND (id_cliente IS NULL OR id_cliente != ?) LIMIT 1`,
        [nuevoUsuario, id]
      );
      if (colision.length > 0) {
        return res.status(409).json({
          success: false,
          message: `El nombre de usuario "${nuevoUsuario}" ya pertenece a otra cuenta. Elige otro.`
        });
      }
    }

    // 2. Actualizar datos en la tabla cliente
    const [result] = await pool.query(
      `UPDATE cliente SET nombre = ?, telefono = ?, email = ?, notas = ? WHERE id_cliente = ?`,
      [nombre.trim(), telefono.trim(), email ? email.trim() : null, notas ? notas.trim() : null, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Cliente no encontrado' });
    }

    // 3. Sincronizar o crear el registro en la tabla usuario
    if (nuevoUsuario) {
      const [existeUsuario] = await pool.query(
        `SELECT id_usuario FROM usuario WHERE id_cliente = ?`,
        [id]
      );

      if (existeUsuario.length > 0) {
        // Si ya tenía cuenta, actualizamos su nombre de usuario y nombre
        await pool.query(
          `UPDATE usuario SET usuario = ?, nombre_completo = ? WHERE id_cliente = ?`,
          [nuevoUsuario, nombre.trim(), id]
        );
      } else {
        // Si no tenía cuenta, le creamos una con clave inicial 123456
        const passwordDefault = await encriptarPassword('123456');
        await pool.query(
          `INSERT INTO usuario (usuario, password_hash, nombre_completo, rol, id_cliente, estado)
           VALUES (?, ?, ?, 'cliente', ?, 1)`,
          [nuevoUsuario, passwordDefault, nombre.trim(), id]
        );
      }
    } else {
      // Si no especificaron usuario pero cambiaron el nombre, sincronizar el nombre en usuario
      await pool.query(
        `UPDATE usuario SET nombre_completo = ? WHERE id_cliente = ?`,
        [nombre.trim(), id]
      );
    }

    res.json({ success: true, message: 'Cliente actualizado correctamente' });
  } catch (error) {
    responderError(res, error, 'actualizarCliente');
  }
};

/**
 * FUNCIONALIDAD 4: ELIMINAR UN CLIENTE (CON PROTECCIONES)
 * ------------------------------------------------------------------------------
 * ¿Qué hace?
 * Permite eliminar un cliente, pero aplica candados de seguridad muy estrictos:
 *
 * Candado 1: Si tiene citas pendientes o confirmadas hoy o a futuro, NO se puede
 *            borrar, porque dejaría citas "fantasmas" sin dueño en la agenda.
 * Candado 2: Si tiene citas en el pasado, NO se borra físicamente para no perder
 *            el historial de ingresos de caja ni la contabilidad de la barbería.
 * Candado 3: Si no tiene ninguna cita histórica, se elimina limpiamente junto
 *            con su usuario de acceso web si existía.
 */
export const eliminarCliente = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Validar que no tenga citas activas o pendientes en la agenda
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

    // 2. Validar que no tenga citas registradas en el historial pasado
    const [historico] = await pool.query(`
      SELECT COUNT(*) AS total FROM reserva WHERE id_cliente = ?
    `, [id]);

    if (historico[0].total > 0) {
      return res.status(400).json({
        success: false,
        message: `⛔ No se puede eliminar este cliente porque cuenta con ${historico[0].total} cita(s) en su historial. Para preservar los registros de reservas y pagos, no se permite borrar clientes con historial.`
      });
    }

    // 3. Eliminar usuario asociado si tenía cuenta web
    await pool.query(`DELETE FROM usuario WHERE id_cliente = ?`, [id]);

    // 4. Eliminar el registro del cliente
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

/**
 * FUNCIONALIDAD 5: RESETEAR O ASIGNAR CONTRASEÑA A UN CLIENTE (ROL ADMIN)
 * ------------------------------------------------------------------------------
 * ¿Qué hace?
 * Cuando un cliente olvida su clave o no puede entrar al sistema, le pide ayuda
 * al dueño de la barbería (Administrador). El administrador puede colocar una
 * nueva contraseña para ese cliente.
 *
 * ¿Cómo funciona por dentro?
 * - Comprueba que la nueva clave tenga al menos 4 caracteres.
 * - La encripta con algoritmo scrypt de alta seguridad (nunca se guarda texto plano).
 * - Caso A: Si el cliente ya tenía cuenta en la tabla `usuario`, le cambia la clave.
 * - Caso B: Si el cliente fue registrado en persona y nunca había creado cuenta web,
 *           el sistema le crea su cuenta automáticamente usando su email o teléfono,
 *           para que desde ese momento ya pueda iniciar sesión.
 */
export const resetPasswordCliente = async (req, res) => {
  try {
    const { id } = req.params;
    const { password_nueva } = req.body;

    if (!password_nueva || String(password_nueva).trim().length < 4) {
      return res.status(400).json({
        success: false,
        message: 'La nueva contraseña debe tener al menos 4 caracteres'
      });
    }

    // 1. Verificar que el cliente exista en la base de datos
    const [clientes] = await pool.query(
      `SELECT id_cliente, nombre, telefono, email FROM cliente WHERE id_cliente = ?`,
      [id]
    );

    if (clientes.length === 0) {
      return res.status(404).json({ success: false, message: 'Cliente no encontrado' });
    }

    const cliente = clientes[0];
    const passwordEncriptada = await encriptarPassword(password_nueva.trim());

    // 2. Buscar si ya tiene una cuenta de usuario vinculada
    const [usuarios] = await pool.query(
      `SELECT id_usuario, usuario FROM usuario WHERE id_cliente = ?`,
      [id]
    );

    if (usuarios.length > 0) {
      // Caso A: Ya tiene cuenta de usuario -> Actualizamos su contraseña
      await pool.query(
        `UPDATE usuario SET password_hash = ?, estado = 1 WHERE id_usuario = ?`,
        [passwordEncriptada, usuarios[0].id_usuario]
      );

      return res.json({
        success: true,
        message: `Contraseña actualizada con éxito para el usuario "${usuarios[0].usuario}".`
      });
    } else {
      // Caso B: No tenía cuenta web -> Le creamos una con su email o teléfono
      let usernameBase = cliente.email ? cliente.email.split('@')[0] : `cli_${cliente.telefono}`;
      usernameBase = usernameBase.toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (!usernameBase) usernameBase = `cli_${cliente.id_cliente}`;

      // Evitar que colisione con otro usuario existente
      const [existe] = await pool.query(`SELECT 1 FROM usuario WHERE usuario = ?`, [usernameBase]);
      const usernameFinal = existe.length > 0 ? `${usernameBase}_${cliente.id_cliente}` : usernameBase;

      await pool.query(
        `INSERT INTO usuario (usuario, password_hash, nombre_completo, rol, id_cliente, estado)
         VALUES (?, ?, ?, 'cliente', ?, 1)`,
        [usernameFinal, passwordEncriptada, cliente.nombre, id]
      );

      return res.json({
        success: true,
        message: `Cuenta creada y contraseña asignada con éxito. Usuario para ingresar: "${usernameFinal}".`
      });
    }
  } catch (error) {
    responderError(res, error, 'resetPasswordCliente');
  }
};
