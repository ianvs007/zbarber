import { Router } from 'express';
import {
  getBarberos,
  crearBarbero,
  actualizarBarbero,
  eliminarBarbero,
  toggleHabilidad,
} from '../controllers/barberoController.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();
router.get('/', getBarberos);
router.post('/', requireRole('admin'), crearBarbero);
router.put('/:id', requireRole('admin'), actualizarBarbero);
router.delete('/:id', requireRole('admin'), eliminarBarbero);
router.post('/habilidad', requireRole('admin'), toggleHabilidad);

export default router;
