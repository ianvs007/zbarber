/**
 * Servidor Principal Node.js / Express
 * Z-BARBER (Santa Cruz, Bolivia)
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Rutas
import authRoutes from './routes/authRoutes.js';
import reservaRoutes from './routes/reservaRoutes.js';
import clienteRoutes from './routes/clienteRoutes.js';
import servicioRoutes from './routes/servicioRoutes.js';
import barberoRoutes from './routes/barberoRoutes.js';
import reporteRoutes from './routes/reporteRoutes.js';
import pagoRoutes from './routes/pagoRoutes.js';
import horarioRoutes from './routes/horarioRoutes.js';
import { requireAuth, requireRole } from './middleware/auth.js';
import pool from './config/db.js';
import { expirarReservasVencidas } from './utils/agenda.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin'
  });
  next();
});
// El frontend se sirve desde este mismo servidor; CORS solo se habilita si se define CORS_ORIGIN
app.use(cors({ origin: process.env.CORS_ORIGIN || false }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Servir archivos estáticos del frontend (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// Endpoints API RESTful
app.use('/api/auth', authRoutes);
app.use('/api/reservas', requireAuth, reservaRoutes);
app.use('/api/pagos', requireAuth, pagoRoutes);
app.use('/api/horario', requireAuth, horarioRoutes);
app.use('/api/clientes', requireAuth, requireRole('admin'), clienteRoutes);
app.use('/api/servicios', requireAuth, servicioRoutes);
app.use('/api/barberos', requireAuth, barberoRoutes);
app.use('/api/reportes', requireAuth, requireRole('admin'), reporteRoutes);

// Healthcheck
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'Z-BARBER API', timestamp: new Date().toISOString() });
});

app.use('/api', (req, res) => {
  res.status(404).json({ success: false, message: 'Recurso no encontrado' });
});

// Ruta por defecto para SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Libera cada minuto los horarios cuyo plazo de pago venció
setInterval(() => {
  expirarReservasVencidas(pool).catch(err => console.error('Error expirando reservas:', err.message));
}, 60 * 1000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================================`);
  console.log(`💈 SERVIDOR Z-BARBER INICIADO EN PUERTO ${PORT}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`🗄️ Base de datos: MySQL 8.0 [zbarber]`);
  console.log(`=================================================`);
});
