import { Router } from 'express';
import {
  obtenerInfoQr,
  obtenerImagenQr,
  actualizarQr,
  subirComprobante,
  verComprobante,
  aprobarPago,
  rechazarPago,
  marcarReembolsado
} from '../controllers/pagoController.js';
import { requireRole } from '../middleware/auth.js';
import { recibirArchivo } from '../utils/archivos.js';

const router = Router();
router.get('/qr', obtenerInfoQr);
router.get('/qr/imagen', obtenerImagenQr);
router.put('/qr', requireRole('admin'), recibirArchivo('qr'), actualizarQr);

router.post('/reserva/:id/comprobante', requireRole('cliente'), recibirArchivo('comprobante'), subirComprobante);
router.get('/:id/comprobante', verComprobante);
router.put('/:id/aprobar', requireRole('admin'), aprobarPago);
router.put('/:id/rechazar', requireRole('admin'), rechazarPago);
router.put('/:id/reembolsado', requireRole('admin'), marcarReembolsado);

export default router;
