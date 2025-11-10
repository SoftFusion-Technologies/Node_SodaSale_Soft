/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 08 / 11 /2025
 * Versión: 1.0
 *
 * Descripción:
 * Este archivo (routes.js) define las rutas HTTP para operaciones CRUD en la tabla 'locales'
 * Tema: Rutas - Locales
 *
 * Capa: Backend
 */

import express from 'express'; // Importar la librería de Express
const router = express.Router(); // Inicializar el router
import { authenticateToken } from '../Security/auth.js'; // Importar las funciones del archivo auth.js

// Importar controladores de locales inicio
import {
  OBRS_Locales_CTS,
  OBR_Local_CTS,
  CR_Local_CTS,
  ER_Local_CTS,
  UR_Local_CTS
} from '../Controllers/CTS_TB_Locales.js';
// Importar controladores de locales fin

// Importar controladores de usuarios inicio
import {
  OBRS_Usuarios_CTS,
  OBR_Usuario_CTS,
  CR_Usuario_CTS,
  ER_Usuario_CTS,
  UR_Usuario_CTS
} from '../Controllers/CTS_TB_Users.js';
// Importar controladores de usuarios fin

// Importar controladores de producto fin
import {
  OBRS_Productos_CTS,
  OBR_Producto_CTS,
  CR_Producto_CTS,
  UR_Producto_CTS,
  ER_Producto_CTS,
  UR_Producto_Estado_CTS
} from '../Controllers/Productos/CTS_TB_Productos.js';
// Importar controladores de producto fin

// ----------------------------------------------------------------
// Rutas para operaciones CRUD en la tabla 'locales'
// ----------------------------------------------------------------

// Obtener todos los locales
router.get('/locales', OBRS_Locales_CTS);

// Obtener un solo local por ID
router.get('/locales/:id', OBR_Local_CTS);

// Crear un nuevo local
router.post('/locales', CR_Local_CTS);

// Eliminar un local por ID
router.delete('/locales/:id', ER_Local_CTS);

// Actualizar un local por ID
router.put('/locales/:id', UR_Local_CTS);


// ----------------------------------------------------------------
// Rutas para operaciones CRUD en la tabla 'usuarios'
// ----------------------------------------------------------------

router.post('/usuarios', authenticateToken, CR_Usuario_CTS);
router.put('/usuarios/:id', authenticateToken, UR_Usuario_CTS);
router.delete('/usuarios/:id', authenticateToken, ER_Usuario_CTS);
router.get('/usuarios', authenticateToken, OBRS_Usuarios_CTS);



// ----------------------------------------------------------------
// Rutas para operaciones CRUD en la tabla 'productos'
// ----------------------------------------------------------------
// Listado con paginación flexible
// GET /productos?q=&estado=&presentacion=&page=&pageSize=&limit=&offset=&mode=keyset&last_id=&orderBy=&orderDir=&count=0
router.get('/productos', OBRS_Productos_CTS);

// Detalle
router.get('/productos/:id', OBR_Producto_CTS);

// Alta
router.post('/productos', CR_Producto_CTS);

// Update
router.put('/productos/:id', UR_Producto_CTS);

// Baja (lógica por defecto; hard con ?hard=1)
router.delete('/productos/:id', ER_Producto_CTS);

// Cambiar estado directo (útil para activar/inactivar desde el listado)
router.patch('/productos/:id/estado', UR_Producto_Estado_CTS);
export default router;
