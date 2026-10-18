/**
 * Encripta las contraseñas de la tabla usuario que aún estén en texto plano.
 * Es seguro ejecutarlo varias veces: omite las que ya están encriptadas.
 * Uso: npm run encriptar-passwords
 */

import pool from '../config/db.js';
import { encriptarPassword, estaEncriptada } from '../utils/password.js';

try {
  const [usuarios] = await pool.query(`SELECT id_usuario, usuario, password_hash FROM usuario`);
  const pendientes = usuarios.filter(u => !estaEncriptada(u.password_hash));

  for (const u of pendientes) {
    await pool.query(
      `UPDATE usuario SET password_hash = ? WHERE id_usuario = ?`,
      [await encriptarPassword(u.password_hash), u.id_usuario]
    );
    console.log(`[OK] Contraseña encriptada: ${u.usuario}`);
  }

  console.log(`Usuarios revisados: ${usuarios.length} | Encriptados ahora: ${pendientes.length}`);
} catch (error) {
  console.error('Error encriptando contraseñas:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
