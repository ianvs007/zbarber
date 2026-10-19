/**
 * ==============================================================================
 * RUTAS DE CLIENTES (/api/clientes)
 * ==============================================================================
 * Este archivo define los puntos de enlace (endpoints) para gestionar clientes.
 * NOTA DE SEGURIDAD: En server.js todas estas rutas ya están protegidas y solo
 * pueden ser llamadas por un usuario con sesión activa y rol 'admin'.
 * ==============================================================================
 */

import { Router } from 'express';
import {
  getClientes,
  crearCliente,
  actualizarCliente,
  eliminarCliente,
  resetPasswordCliente
} from '../controllers/clienteController.js';

const router = Router();

// GET /api/clientes -> Listar todos los clientes con su historial
router.get('/', getClientes);

// POST /api/clientes -> Crear un cliente nuevo
router.post('/', crearCliente);

// PUT /api/clientes/:id -> Actualizar datos de un cliente (nombre, teléfono, etc.)
router.put('/:id', actualizarCliente);

// DELETE /api/clientes/:id -> Eliminar un cliente (bloqueado si tiene citas activas)
router.delete('/:id', eliminarCliente);

// PUT /api/clientes/:id/password -> Resetear o asignar contraseña a un cliente (Admin)
router.put('/:id/password', resetPasswordCliente);

export default router;
