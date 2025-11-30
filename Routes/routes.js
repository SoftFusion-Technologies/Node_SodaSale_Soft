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
  CR_Bulk_Localidades_CTS,
  UR_Localidad_CTS,
  PR_Localidad_Estado_CTS,
  ER_Localidad_CTS
} from '../Controllers/Geografia/CTS_TB_Localidades.js';

import {
  OBRS_Barrios_CTS,
  OBR_Barrio_CTS,
  CR_Barrio_CTS,
  CR_Bulk_Barrios_CTS,
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
  CR_VB_BulkAsignar_CTS,
  UR_VB_Cerrar_CTS,
  UR_VB_Estado_CTS,
  ER_VB_CTS
} from '../Controllers/Vendedores/CTS_TB_VendedorBarrios.js';
// Importar controladores de vendedores fin

// Importar controladores de clientes inicio
import {
  OBRS_Clientes_CTS, // GET    /clientes
  OBR_Cliente_CTS, // GET    /clientes/:id
  CR_Cliente_CTS, // POST   /clientes
  UR_Cliente_CTS, // PUT    /clientes/:id
  UR_Cliente_Estado_CTS, // PATCH  /clientes/:id/estado
  ER_Cliente_CTS // DELETE /clientes/:id?hard=1
} from '../Controllers/Clientes/CTS_TB_Clientes.js';
// Importar controladores de clientes fin

// Importar controladores de ventas inicio
import {
  OBRS_Ventas_CTS,
  OBR_Venta_CTS,
  CR_Venta_CTS,
  UR_Venta_CTS,
  UR_Venta_Anular_CTS,
  ER_Venta_CTS,
  UR_Venta_RecalcularTotal_CTS,
  CR_VentasReparto_Masiva_CTS,
  OBRS_VentasDeudoresFiado_CTS
} from '../Controllers/Ventas/CTS_TB_Ventas.js';

import {
  OBRS_VentasItems_CTS,
  CR_VentasItems_CTS,
  UR_VentasItem_CTS,
  ER_VentasItem_CTS,
  RP_VentasItems_CTS
} from '../Controllers/Ventas/CTS_TB_VentasDetalle.js';
// Importar controladores de ventas fin

// Importar controladores de repartos ini

import {
  OBRS_Repartos_CTS,
  OBR_Reparto_CTS,
  CR_Reparto_CTS,
  UR_Reparto_CTS,
  ER_Reparto_CTS,
  UR_Reparto_Estado_CTS
} from '../Controllers/Repartos/CTS_TB_Repartos.js';

import {
  OBRS_RepartoClientes_CTS,
  OBR_RepartoCliente_CTS,
  CR_RepartoCliente_CTS,
  UR_RepartoCliente_CTS,
  ER_RepartoCliente_CTS,
  UR_RepartoCliente_Estado_CTS,
  CR_Reparto_AsignarClientesMasivo_CTS
} from '../Controllers/Repartos/CTS_TB_RepartoClientes.js';

import {
  OBRS_RepartosUsuarios_CTS,
  OBR_RepartoUsuario_CTS,
  CR_RepartoUsuario_CTS,
  UR_RepartoUsuario_CTS,
  ER_RepartoUsuario_CTS,
  UR_RepartoUsuario_Activo_CTS
} from '../Controllers/Repartos/CTS_TB_RepartosUsuarios.js';

import {
  OBRS_RepartosDias_CTS,
  OBR_RepartoDia_CTS,
  CR_RepartoDia_CTS,
  UR_RepartoDia_CTS,
  ER_RepartoDia_CTS
} from '../Controllers/Repartos/CTS_TB_RepartosDias.js';

// ----------------------------------------------------------------
// Importamos controladores de Cobranzas a Clientes
// ----------------------------------------------------------------
import {
  OBRS_CobranzasClientes_CTS,
  OBR_CobranzaCliente_CTS,
  CR_CobranzaCliente_CTS,
  ER_CobranzaCliente_CTS
} from '../Controllers/Cobranzas/CTS_TB_CobranzasClientes.js';

// ----------------------------------------------------------------
// CxC / Deuda de clientes
// ----------------------------------------------------------------
import { OBR_CxcDeudaCliente_CTS } from '../Controllers/Cobranzas/CTS_TB_CxcClientes.js';

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
router.get('/usr@@soft', OBRS_Usuarios_CTS);
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
router.post('/geo/localidades/bulk', CR_Bulk_Localidades_CTS);
router.put('/geo/localidades/:id', UR_Localidad_CTS);
router.patch('/geo/localidades/:id/estado', PR_Localidad_Estado_CTS);
router.delete('/geo/localidades/:id', ER_Localidad_CTS);

// ----------------------------------------------------------------
// Rutas para operaciones CRUD en la tabla 'barrios'
// ----------------------------------------------------------------
router.get('/geo/barrios', OBRS_Barrios_CTS);
router.get('/geo/barrios/:id', OBR_Barrio_CTS);
router.post('/geo/barrios', CR_Barrio_CTS);
router.post('/geo/barrios/bulk', CR_Bulk_Barrios_CTS);
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
router.post('/vendedor_barrios/bulk', CR_VB_BulkAsignar_CTS);
router.patch('/vendedores/:id/barrios/:asigId/cerrar', UR_VB_Cerrar_CTS); // body: { hasta? }
router.patch('/vendedores/:id/barrios/:asigId/estado', UR_VB_Estado_CTS); // body: { estado }
router.delete('/vendedores/:id/barrios/:asigId', ER_VB_CTS); // ?hard=1 para borrar vigente

// ----------------------------------------------------------------
// Rutas para operaciones CRUD en la tabla 'clientes'
// ----------------------------------------------------------------
// Listado con filtros/paginación
router.get('/clientes', OBRS_Clientes_CTS);

// Detalle por ID (incluye geografía)
router.get('/clientes/:id', OBR_Cliente_CTS);

// Crear cliente
router.post('/clientes', CR_Cliente_CTS);

// Actualizar cliente
router.put('/clientes/:id', UR_Cliente_CTS);

// Cambiar estado (activo/inactivo)
router.patch('/clientes/:id/estado', UR_Cliente_Estado_CTS);

// Eliminar (soft por defecto, hard con ?hard=1)
router.delete('/clientes/:id', ER_Cliente_CTS);

// ----------------------------------------------------------------
// Rutas para operaciones CRUD en la tabla 'clientes'
// ----------------------------------------------------------------
router.get('/ventas/deudores-fiado', OBRS_VentasDeudoresFiado_CTS);
router.get('/ventas', OBRS_Ventas_CTS);
router.get('/ventas/:id', OBR_Venta_CTS);
router.post('/ventas', CR_Venta_CTS);
router.put('/ventas/:id', UR_Venta_CTS);
router.patch('/ventas/:id/anular', UR_Venta_Anular_CTS);
router.delete('/ventas/:id', ER_Venta_CTS);
router.post('/ventas/:ventaId/recalcular', UR_Venta_RecalcularTotal_CTS);
router.post('/ventas/reparto-masiva', CR_VentasReparto_Masiva_CTS);
// ----------------------------------------------------------------
// Rutas para operaciones CRUD en la tabla 'clientes'
// ----------------------------------------------------------------
router.get('/ventas/:ventaId/items', OBRS_VentasItems_CTS);
router.post('/ventas/:ventaId/items', CR_VentasItems_CTS); // 1 o n ítems
router.put('/ventas/:ventaId/items/:itemId', UR_VentasItem_CTS);
router.delete('/ventas/:ventaId/items/:itemId', ER_VentasItem_CTS);
router.post('/ventas/:ventaId/items/replace', RP_VentasItems_CTS); // reemplazo total

// ----------------------------------------------------------------
// Rutas para operaciones CRUD en la tabla 'repartos'
// ----------------------------------------------------------------
// GET /repartos?q=&ciudad_id=&estado=&page=&pageSize=&limit=&offset=&mode=keyset&last_id=&orderBy=&orderDir=&count=0&withCiudad=1
router.get('/repartos', OBRS_Repartos_CTS);

// Detalle
// GET /repartos/:id?withCiudad=1
router.get('/repartos/:id', OBR_Reparto_CTS);

// Alta (con rango explícito o capacidad)
router.post('/repartos', CR_Reparto_CTS);

// Update
router.put('/repartos/:id', UR_Reparto_CTS);

// Baja (lógica por defecto; hard con ?soft=0 para hard, etc.)
router.delete('/repartos/:id', ER_Reparto_CTS);

// Cambiar estado directo
router.patch('/repartos/:id/estado', UR_Reparto_Estado_CTS);

// ----------------------------------------------------------------
// Rutas para asignación de clientes a repartos (reparto_clientes)
// ----------------------------------------------------------------
// GET /repartos-clientes?reparto_id=&cliente_id=&estado=&page=&pageSize=&orderBy=&orderDir=&withReparto=1&withCliente=1
router.get('/repartos-clientes', OBRS_RepartoClientes_CTS);

// Detalle
router.get('/repartos-clientes/:id', OBR_RepartoCliente_CTS);

// Alta (si no se manda numero_rango, se asigna automático)
router.post('/repartos-clientes', CR_RepartoCliente_CTS);

// Update
router.put('/repartos-clientes/:id', UR_RepartoCliente_CTS);

// Baja (lógica con ?soft=1, hard por defecto)
router.delete('/repartos-clientes/:id', ER_RepartoCliente_CTS);

// Cambiar estado
router.patch('/repartos-clientes/:id/estado', UR_RepartoCliente_Estado_CTS);

// ----------------------------------------------------------------
// Asignación masiva de clientes a un reparto
// POST /repartos/:id/asignar-clientes
// body: { cliente_ids: [1,2,3,...], reset?: boolean }
// ----------------------------------------------------------------
router.post(
  '/repartos/:id/asignar-clientes',
  CR_Reparto_AsignarClientesMasivo_CTS
);

// ----------------------------------------------------------------
// Rutas para asignación de usuarios a repartos (repartos_usuarios)
// ----------------------------------------------------------------
// GET /repartos-usuarios?reparto_id=&usuario_id=&rol=&activo=&page=&pageSize=&orderBy=&orderDir=&withReparto=1&withUsuario=1
router.get('/repartos-usuarios', OBRS_RepartosUsuarios_CTS);

// Detalle
router.get('/repartos-usuarios/:id', OBR_RepartoUsuario_CTS);

// Alta
router.post('/repartos-usuarios', CR_RepartoUsuario_CTS);

// Update
router.put('/repartos-usuarios/:id', UR_RepartoUsuario_CTS);

// Baja (soft con ?soft=1 → activo=false, hard por defecto)
router.delete('/repartos-usuarios/:id', ER_RepartoUsuario_CTS);

// Cambiar flag activo directo
router.patch('/repartos-usuarios/:id/activo', UR_RepartoUsuario_Activo_CTS);

// ----------------------------------------------------------------
// Rutas para días y turnos de reparto (repartos_dias)
// ----------------------------------------------------------------
// GET /repartos-dias?reparto_id=&dia_semana=&turno=&page=&pageSize=&orderBy=&orderDir=&withReparto=1
router.get('/repartos-dias', OBRS_RepartosDias_CTS);

// Detalle
router.get('/repartos-dias/:id', OBR_RepartoDia_CTS);

// Alta
router.post('/repartos-dias', CR_RepartoDia_CTS);

// Update
router.put('/repartos-dias/:id', UR_RepartoDia_CTS);

// Baja (hard delete)
router.delete('/repartos-dias/:id', ER_RepartoDia_CTS);

// ===============================
// Rutas Cobranzas a Clientes
// ===============================
router.get('/cobranzas-clientes', OBRS_CobranzasClientes_CTS);

router.get('/cobranzas-clientes/:id', OBR_CobranzaCliente_CTS);

router.post('/cobranzas-clientes', CR_CobranzaCliente_CTS);

// Usar con cuidado (ver comentario en controlador)
router.delete('/cobranzas-clientes/:id', ER_CobranzaCliente_CTS);

// ===============================
// CxC - Deuda por cliente
// ===============================
router.get('/cxc/clientes/:id/deuda', OBR_CxcDeudaCliente_CTS);

export default router;
