/**
 * Subida segura de archivos (comprobantes de pago y QR del negocio)
 * - Se guardan fuera de /public con nombre aleatorio
 * - El tipo se valida por la firma real del archivo, no por la extensión
 * Z-BARBER
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { ErrorNegocio } from './agenda.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DIR_UPLOADS = path.join(__dirname, '..', 'uploads');

export const TAMANO_MAXIMO_BYTES = 5 * 1024 * 1024;

const FIRMAS = [
  { mime: 'image/png', ext: '.png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', ext: '.jpg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'application/pdf', ext: '.pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }
];

const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANO_MAXIMO_BYTES, files: 1, fields: 10 }
});

// Middleware que acepta un único archivo y traduce los errores de multer a mensajes claros
export const recibirArchivo = (campo) => (req, res, next) => {
  subida.single(campo)(req, res, (err) => {
    if (!err) return next();
    const mensaje = err.code === 'LIMIT_FILE_SIZE'
      ? `El archivo supera el máximo de ${TAMANO_MAXIMO_BYTES / 1024 / 1024} MB`
      : 'No se pudo procesar el archivo enviado';
    res.status(400).json({ success: false, message: mensaje });
  });
};

export function detectarTipo(buffer, mimesPermitidos) {
  const tipo = FIRMAS.find(f => f.bytes.every((b, i) => buffer[i] === b));
  if (!tipo || !mimesPermitidos.includes(tipo.mime)) {
    const nombres = mimesPermitidos.map(m => m.split('/')[1].toUpperCase().replace('JPEG', 'JPG')).join(', ');
    throw new ErrorNegocio(`Formato de archivo no permitido. Solo se acepta: ${nombres}`);
  }
  return tipo;
}

export const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

export async function guardarArchivo(carpeta, buffer, tipo) {
  const dir = path.join(DIR_UPLOADS, carpeta);
  await fs.mkdir(dir, { recursive: true });
  const nombre = `${crypto.randomUUID()}${tipo.ext}`;
  await fs.writeFile(path.join(dir, nombre), buffer, { flag: 'wx' });
  return nombre;
}

export async function eliminarArchivo(carpeta, nombre) {
  if (!nombre) return;
  await fs.unlink(path.join(DIR_UPLOADS, carpeta, path.basename(nombre))).catch(() => {});
}

export function enviarArchivo(res, carpeta, nombre, mime) {
  res.set({
    'Content-Type': mime,
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store'
  });
  res.sendFile(path.join(DIR_UPLOADS, carpeta, path.basename(nombre)), (err) => {
    if (err && !res.headersSent) res.status(404).json({ success: false, message: 'Archivo no encontrado' });
  });
}
