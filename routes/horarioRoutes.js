import { Router } from 'express';
import { getHorario, actualizarHorario } from '../controllers/horarioController.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();
router.get('/', getHorario);
router.put('/', requireRole('admin'), actualizarHorario);

export default router;
