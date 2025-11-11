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

// Importar controladores de producto inicio
import {
  OBRS_Productos_CTS,
  OBR_Producto_CTS,
  CR_Producto_CTS,
  UR_Producto_CTS,
  ER_Producto_CTS,
  UR_Producto_Estado_CTS
} from '../Controllers/Productos/CTS_TB_Productos.js';
// Importar controladores de producto fin

// Importar controladores de geografia inicio
import {
  OBRS_Ciudades_CTS,
  OBR_Ciudad_CTS,
  CR_Ciudad_CTS,
  UR_Ciudad_CTS,
  PR_Ciudad_Estado_CTS,
  ER_Ciudad_CTS
} from '../Controllers/Geografia/CTS_TB_Ciudades.js';

import {
  OBRS_Localidades_CTS,
  OBR_Localidad_CTS,
  CR_Localidad_CTS,
  UR_Localidad_CTS,
  PR_Localidad_Estado_CTS,
  ER_Localidad_CTS
} from '../Controllers/Geografia/CTS_TB_Localidades.js';

import {
  OBRS_Barrios_CTS,
  OBR_Barrio_CTS,
  CR_Barrio_CTS,
  UR_Barrio_CTS,
  PR_Barrio_Estado_CTS,
  ER_Barrio_CTS
} from '../Controllers/Geografia/CTS_TB_Barrios.js';

// Importar controladores de geografia fin

// Importar controladores de vendedores inicio
import {
  OBRS_Vendedores_CTS,
  OBR_Vendedor_CTS,
  CR_Vendedor_CTS,
  UR_Vendedor_CTS,
  UR_Vendedor_Estado_CTS,
  ER_Vendedor_CTS
} from '../Controllers/Vendedores/CTS_TB_Vendedores.js';

import {
  OBRS_VB_CTS,
  OBRS_VB_PorVendedor_CTS,
  CR_VB_Asigna_CTS,
  UR_VB_Cerrar_CTS,
  UR_VB_Estado_CTS,
  ER_VB_CTS
} from '../Controllers/Vendedores/CTS_TB_VendedorBarrios.js';
// Importar controladores de vendedores fin

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

// ----------------------------------------------------------------
// Rutas para operaciones CRUD en la tabla 'ciudades'
// ----------------------------------------------------------------
router.get('/geo/ciudades', OBRS_Ciudades_CTS);
router.get('/geo/ciudades/:id', OBR_Ciudad_CTS);
router.post('/geo/ciudades', CR_Ciudad_CTS);
router.put('/geo/ciudades/:id', UR_Ciudad_CTS);
router.patch('/geo/ciudades/:id/estado', PR_Ciudad_Estado_CTS);
router.delete('/geo/ciudades/:id', ER_Ciudad_CTS);

// ----------------------------------------------------------------
// Rutas para operaciones CRUD en la tabla 'localidades'
// ----------------------------------------------------------------
router.get('/geo/localidades', OBRS_Localidades_CTS);
router.get('/geo/localidades/:id', OBR_Localidad_CTS);
router.post('/geo/localidades', CR_Localidad_CTS);
router.put('/geo/localidades/:id', UR_Localidad_CTS);
router.patch('/geo/localidades/:id/estado', PR_Localidad_Estado_CTS);
router.delete('/geo/localidades/:id', ER_Localidad_CTS);

// ----------------------------------------------------------------
// Rutas para operaciones CRUD en la tabla 'barrios'
// ----------------------------------------------------------------
router.get('/geo/barrios', OBRS_Barrios_CTS);
router.get('/geo/barrios/:id', OBR_Barrio_CTS);
router.post('/geo/barrios', CR_Barrio_CTS);
router.put('/geo/barrios/:id', UR_Barrio_CTS);
router.patch('/geo/barrios/:id/estado', PR_Barrio_Estado_CTS);
router.delete('/geo/barrios/:id', ER_Barrio_CTS);


// ----------------------------------------------------------------
// Rutas para operaciones CRUD en la tabla 'vendedores'
// ----------------------------------------------------------------
router.get('/vendedores', OBRS_Vendedores_CTS);
router.get('/vendedores/:id', OBR_Vendedor_CTS);
router.post('/vendedores', CR_Vendedor_CTS);
router.put('/vendedores/:id', UR_Vendedor_CTS);
router.patch('/vendedores/:id/estado', UR_Vendedor_Estado_CTS);
router.delete('/vendedores/:id', ER_Vendedor_CTS);

// ----------------------------------------------------------------
// Rutas para operaciones CRUD en la tabla 'vendedores_barrios'
// ----------------------------------------------------------------
// Global
router.get('/vendedor_barrios', OBRS_VB_CTS);

// Por vendedor
router.get('/vendedores/:id/barrios', OBRS_VB_PorVendedor_CTS);
router.post('/vendedores/:id/barrios', CR_VB_Asigna_CTS); // body: { barrio_id, asignado_desde?, asignado_hasta?, estado?, autoClose? }
router.patch('/vendedores/:id/barrios/:asigId/cerrar', UR_VB_Cerrar_CTS); // body: { hasta? }
router.patch('/vendedores/:id/barrios/:asigId/estado', UR_VB_Estado_CTS);  // body: { estado }
router.delete('/vendedores/:id/barrios/:asigId', ER_VB_CTS);               // ?hard=1 para borrar vigente
export default router;
