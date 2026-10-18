/**
 * Límite de intentos fallidos de inicio de sesión (en memoria)
 * Bloquea por IP + usuario tras varios fallos para frenar ataques de fuerza bruta.
 * Z-BARBER
 */

const MAX_FALLOS = 5;
const VENTANA_MS = 15 * 60 * 1000;
const fallos = new Map();

const clave = (req) => `${req.ip}|${String(req.body?.usuario || '').toLowerCase()}`;

export function limitarLogin(req, res, next) {
  const registro = fallos.get(clave(req));
  if (registro && registro.bloqueadoHasta > Date.now()) {
    const minutos = Math.ceil((registro.bloqueadoHasta - Date.now()) / 60000);
    return res.status(429).json({
      success: false,
      message: `Demasiados intentos fallidos. Intente nuevamente en ${minutos} minuto(s).`
    });
  }
  next();
}

export function registrarFallo(req) {
  const k = clave(req);
  const ahora = Date.now();
  const registro = fallos.get(k);
  const vigente = registro && ahora - registro.desde < VENTANA_MS;
  const intentos = vigente ? registro.intentos + 1 : 1;

  fallos.set(k, {
    desde: vigente ? registro.desde : ahora,
    intentos,
    bloqueadoHasta: intentos >= MAX_FALLOS ? ahora + VENTANA_MS : 0
  });
}

export function limpiarFallos(req) {
  fallos.delete(clave(req));
}

setInterval(() => {
  const ahora = Date.now();
  for (const [k, r] of fallos) {
    if (ahora - r.desde > VENTANA_MS && r.bloqueadoHasta < ahora) fallos.delete(k);
  }
}, VENTANA_MS).unref();
