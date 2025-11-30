// ===============================================
// FILE: Models/Repartos/relacionesRepartos.js
// ===============================================
/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 29 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 *  Concentra las asociaciones núcleo del módulo de Repartos:
 *
 *  Geografía:
 *  - Ciudades 1..N Repartos (repartos.ciudad_id)
 *
 *  Repartos ↔ Clientes:
 *  - Repartos 1..N RepartoClientes (reparto_clientes.reparto_id)
 *  - Clientes 1..N RepartoClientes (reparto_clientes.cliente_id)
 *  - Relación N..M Repartos ↔ Clientes vía tabla intermedia RepartoClientes
 *
 *  Repartos ↔ Usuarios:
 *  - Repartos 1..N RepartosUsuarios (repartos_usuarios.reparto_id)
 *  - Usuarios 1..N RepartosUsuarios (repartos_usuarios.usuario_id)
 *
 *  Repartos ↔ Días:
 *  - Repartos 1..N RepartosDias (repartos_dias.reparto_id)
 *
 * Tema: Relaciones - Repartos
 * Capa: Backend
 */

import { CiudadesModel } from '../Geografia/MD_TB_Ciudades.js';
import { ClientesModel } from '../Clientes/MD_TB_Clientes.js';
import { UserModel } from '../MD_TB_Users.js';

import { RepartosModel } from './MD_TB_Repartos.js';
import { RepartoClientesModel } from './MD_TB_RepartoClientes.js';
import { RepartosUsuariosModel } from './MD_TB_RepartosUsuarios.js';
import { RepartosDiasModel } from './MD_TB_RepartosDias.js';

export function initRelacionesRepartos() {
  // ===============================
  // Geografía: Ciudad ↔ Repartos
  // ===============================
  CiudadesModel.hasMany(RepartosModel, {
    as: 'repartos',
    foreignKey: 'ciudad_id'
  });

  RepartosModel.belongsTo(CiudadesModel, {
    as: 'ciudad',
    foreignKey: 'ciudad_id'
  });

  // ===============================
  // Repartos ↔ Clientes (tabla intermedia reparto_clientes)
  // ===============================

  // Relación directa Reparto → RepartoClientes
  RepartosModel.hasMany(RepartoClientesModel, {
    as: 'asignaciones_clientes',
    foreignKey: 'reparto_id'
    // onDelete: 'RESTRICT'  // normalmente se usa estado inactivo en vez de borrar
  });

  RepartoClientesModel.belongsTo(RepartosModel, {
    as: 'reparto',
    foreignKey: 'reparto_id'
  });

  // Cliente ↔ RepartoClientes
  ClientesModel.hasMany(RepartoClientesModel, {
    as: 'asignaciones_repartos',
    foreignKey: 'cliente_id'
  });

  RepartoClientesModel.belongsTo(ClientesModel, {
    as: 'cliente',
    foreignKey: 'cliente_id'
  });

  // Relación N..M Repartos ↔ Clientes (vía tabla intermedia)
  RepartosModel.belongsToMany(ClientesModel, {
    through: RepartoClientesModel,
    as: 'clientes',
    foreignKey: 'reparto_id',
    otherKey: 'cliente_id'
  });

  ClientesModel.belongsToMany(RepartosModel, {
    through: RepartoClientesModel,
    as: 'repartos',
    foreignKey: 'cliente_id',
    otherKey: 'reparto_id'
  });

  // ===============================
  // Repartos ↔ Usuarios (equipo de reparto)
  // ===============================
  RepartosModel.hasMany(RepartosUsuariosModel, {
    as: 'equipo',
    foreignKey: 'reparto_id'
  });

  RepartosUsuariosModel.belongsTo(RepartosModel, {
    as: 'reparto',
    foreignKey: 'reparto_id'
  });

  UserModel.hasMany(RepartosUsuariosModel, {
    as: 'repartos_asignados',
    foreignKey: 'usuario_id'
  });

  RepartosUsuariosModel.belongsTo(UserModel, {
    as: 'usuario',
    foreignKey: 'usuario_id'
  });

  // ===============================
  // Repartos ↔ Días de reparto
  // ===============================
  RepartosModel.hasMany(RepartosDiasModel, {
    as: 'dias',
    foreignKey: 'reparto_id'
  });

  RepartosDiasModel.belongsTo(RepartosModel, {
    as: 'reparto',
    foreignKey: 'reparto_id'
  });
}


export default initRelacionesRepartos;
