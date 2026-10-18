/**
 * Configuración de Conexión a Base de Datos MySQL con mysql2/promise
 * Z-BARBER - Santa Cruz, Bolivia
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'zbarber',
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

let pool;

try {
  pool = mysql.createPool(dbConfig);
  console.log(`[DB] Pool de conexiones MySQL configurado para ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
} catch (error) {
  console.error('[DB] Error creando pool MySQL:', error.message);
}

export default pool;
