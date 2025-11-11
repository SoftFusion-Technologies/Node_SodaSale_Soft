// ===============================================
// FILE: Models/Vendedores/relacionesVendedores.js
// ===============================================
/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 11 / 11 / 2025
 * Versión: 1.0
 *
 * Concentra las asociaciones del módulo Vendedores:
 * - Vendedores 1..N VendedorBarrio
 * - VendedorBarrio N..1 Barrios
 *
 */

import VendedoresModel from './MD_TB_Vendedores.js';
import VendedorBarrioModel from './MD_TB_VendedorBarrios.js';
import { BarriosModel } from '../Geografia/MD_TB_Barrios.js';

export function initVendedoresRelations() {
  // Vendedor → asignaciones
  VendedoresModel.hasMany(VendedorBarrioModel, {
    as: 'asignaciones',
    foreignKey: 'vendedor_id'
  });

  VendedorBarrioModel.belongsTo(VendedoresModel, {
    as: 'vendedor',
    foreignKey: 'vendedor_id'
  });

  // Asignación → Barrio
  VendedorBarrioModel.belongsTo(BarriosModel, {
    as: 'barrio',
    foreignKey: 'barrio_id'
  });

  // Barrio → Asignaciones
  BarriosModel.hasMany(VendedorBarrioModel, {
    as: 'asignaciones',
    foreignKey: 'barrio_id'
  });
}

export default initVendedoresRelations;
