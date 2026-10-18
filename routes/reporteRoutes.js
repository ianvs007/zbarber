import { Router } from 'express';
import { getReportesFinancieros } from '../controllers/reporteController.js';

const router = Router();
router.get('/', getReportesFinancieros);

export default router;
