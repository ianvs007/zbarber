/**
 * Controlador de Autenticación (contraseñas encriptadas con scrypt)
 * Z-BARBER
 */

import pool from '../config/db.js';
import { generarToken } from '../middleware/auth.js';
import { encriptarPassword, verificarPassword } from '../utils/password.js';
import { registrarFallo, limpiarFallos } from '../middleware/limiteIntentos.js';

function respuestaSesion(user) {
  const datos = {
    id_usuario: user.id_usuario,
    usuario: user.usuario,
    nombre_completo: user.nombre_completo,
    rol: user.rol,
    id_cliente: user.id_cliente ?? null
  };
  return { token: generarToken(datos), user: datos };
}

export const login = async (req, res) => {
  try {
    const { usuario, password } = req.body;

    if (!usuario || !password) {
      return res.status(400).json({ success: false, message: 'Usuario y contraseña requeridos' });
    }

    const [rows] = await pool.query(
      `SELECT id_usuario, usuario, password_hash, nombre_completo, rol, id_cliente
       FROM usuario
       WHERE usuario = ? AND estado = 1`,
      [usuario]
    );

    if (rows.length === 0 || !(await verificarPassword(password, rows[0].password_hash))) {
      registrarFallo(req);
      return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });
    }

    limpiarFallos(req);
    res.json({
      success: true,
      message: 'Inicio de sesión exitoso',
      ...respuestaSesion(rows[0])
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
};

export const registro = async (req, res) => {
  let connection;
  try {
    const { nombre, telefono, email, usuario, password } = req.body;

    if (!nombre || !telefono || !usuario || !password) {
      return res.status(400).json({
        success: false,
        message: 'Nombre, teléfono, usuario y contraseña son obligatorios'
      });
    }
    if (String(password).length < 4) {
      return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 4 caracteres' });
    }

    connection = await pool.getConnection();

    const [existe] = await connection.query(`SELECT 1 FROM usuario WHERE usuario = ? LIMIT 1`, [usuario]);
    if (existe.length > 0) {
      connection.release();
      return res.status(409).json({ success: false, message: 'El nombre de usuario ya está en uso' });
    }

    const passwordEncriptada = await encriptarPassword(password);

    await connection.beginTransaction();

    const [insertCliente] = await connection.query(
      `INSERT INTO cliente (nombre, telefono, email) VALUES (?, ?, ?)`,
      [nombre, telefono, email || null]
    );
    const id_cliente = insertCliente.insertId;

    const [insertUsuario] = await connection.query(
      `INSERT INTO usuario (usuario, password_hash, nombre_completo, rol, id_cliente)
       VALUES (?, ?, ?, 'cliente', ?)`,
      [usuario, passwordEncriptada, nombre, id_cliente]
    );

    await connection.commit();
    connection.release();

    res.status(201).json({
      success: true,
      message: 'Cuenta creada correctamente',
      ...respuestaSesion({
        id_usuario: insertUsuario.insertId,
        usuario,
        nombre_completo: nombre,
        rol: 'cliente',
        id_cliente
      })
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'El nombre de usuario ya está en uso' });
    }
    console.error('Error en registro:', error);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
};

export const cambiarPassword = async (req, res) => {
  try {
    const { password_actual, password_nueva } = req.body;

    if (!password_actual || !password_nueva) {
      return res.status(400).json({ success: false, message: 'Contraseña actual y nueva son obligatorias' });
    }
    if (String(password_nueva).length < 4) {
      return res.status(400).json({ success: false, message: 'La nueva contraseña debe tener al menos 4 caracteres' });
    }

    const [rows] = await pool.query(
      `SELECT password_hash FROM usuario WHERE id_usuario = ? AND estado = 1`,
      [req.user.id_usuario]
    );
    if (rows.length === 0 || !(await verificarPassword(password_actual, rows[0].password_hash))) {
      return res.status(400).json({ success: false, message: 'La contraseña actual es incorrecta' });
    }

    await pool.query(
      `UPDATE usuario SET password_hash = ? WHERE id_usuario = ?`,
      [await encriptarPassword(password_nueva), req.user.id_usuario]
    );

    res.json({ success: true, message: 'Contraseña actualizada correctamente' });
  } catch (error) {
    console.error('Error al cambiar contraseña:', error);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
};

export const me = (req, res) => {
  res.json({ success: true, user: req.user });
};
