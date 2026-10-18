/**
 * Encriptación de contraseñas con scrypt (crypto nativo de Node)
 * Formato almacenado: scrypt$<sal_hex>$<hash_hex>
 * Z-BARBER
 */

import crypto from 'crypto';

const PREFIJO = 'scrypt';
const LONGITUD_CLAVE = 64;

function derivar(password, sal) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), sal, LONGITUD_CLAVE, (err, clave) => (err ? reject(err) : resolve(clave)));
  });
}

export async function encriptarPassword(password) {
  const sal = crypto.randomBytes(16).toString('hex');
  const clave = await derivar(password, sal);
  return `${PREFIJO}$${sal}$${clave.toString('hex')}`;
}

export async function verificarPassword(password, almacenado) {
  const [prefijo, sal, hash] = String(almacenado || '').split('$');
  if (prefijo !== PREFIJO || !sal || !hash) return false;

  const esperado = Buffer.from(hash, 'hex');
  const clave = await derivar(password, sal);
  return esperado.length === clave.length && crypto.timingSafeEqual(esperado, clave);
}

export function estaEncriptada(almacenado) {
  return String(almacenado || '').startsWith(`${PREFIJO}$`);
}
