import { Router } from 'express';
import {
  getReservas,
  crearReserva,
  registrarPresencial,
  cancelarReserva,
  atenderReserva,
  marcarNoAsistio
} from '../controllers/reservaController.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();
router.get('/', getReservas);
router.post('/', requireRole('cliente'), crearReserva);
router.post('/presencial', requireRole('admin'), registrarPresencial);
router.put('/:id/cancelar', cancelarReserva);
router.put('/:id/atender', requireRole('admin'), atenderReserva);
router.put('/:id/no-asistio', requireRole('admin'), marcarNoAsistio);

export default router;
