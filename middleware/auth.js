/**
 * Middleware de Autenticación y Control de Acceso por Rol
 * Z-BARBER
 *
 * Token firmado con HMAC-SHA256 (crypto nativo de Node): <payload_base64url>.<firma>
 */

import crypto from 'crypto';

const DURACION_SESION_MS = 8 * 60 * 60 * 1000;

// Si no hay SESSION_SECRET en .env, las sesiones se invalidan al reiniciar el servidor
const SECRETO_TEMPORAL = crypto.randomBytes(32).toString('hex');

function firmar(payload) {
  const secreto = process.env.SESSION_SECRET || SECRETO_TEMPORAL;
  return crypto.createHmac('sha256', secreto).update(payload).digest('base64url');
}

export function generarToken(user) {
  const payload = Buffer.from(JSON.stringify({
    id_usuario: user.id_usuario,
    usuario: user.usuario,
    nombre_completo: user.nombre_completo,
    rol: user.rol,
    id_cliente: user.id_cliente ?? null,
    exp: Date.now() + DURACION_SESION_MS
  })).toString('base64url');

  return `${payload}.${firmar(payload)}`;
}

function verificarToken(token) {
  const [payload, firma] = String(token).split('.');
  if (!payload || !firma) return null;

  const esperada = firmar(payload);
  if (firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = token ? verificarToken(token) : null;

  if (!user) {
    return res.status(401).json({ success: false, message: 'Sesión no válida o expirada. Inicie sesión nuevamente.' });
  }

  req.user = user;
  next();
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.rol)) {
    return res.status(403).json({ success: false, message: 'No tiene permisos para realizar esta acción' });
  }
  next();
};
