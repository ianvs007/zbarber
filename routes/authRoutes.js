import { Router } from 'express';
import { login, registro, me, cambiarPassword } from '../controllers/authController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { limitarLogin } from '../middleware/limiteIntentos.js';

const router = Router();
router.post('/login', limitarLogin, login);
router.post('/registro', registro);
router.get('/me', requireAuth, me);
router.put('/password', requireAuth, requireRole('admin'), cambiarPassword);

export default router;
