import { Router } from 'express';
import {
  getServicios,
  crearServicio,
  actualizarServicio,
  eliminarServicio,
} from '../controllers/servicioController.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();
router.get('/', getServicios);
router.post('/', requireRole('admin'), crearServicio);
router.put('/:id', requireRole('admin'), actualizarServicio);
router.delete('/:id', requireRole('admin'), eliminarServicio);

export default router;
