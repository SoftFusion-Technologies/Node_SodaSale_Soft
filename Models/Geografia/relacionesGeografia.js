/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 10 / 11 / 2025
 * Versión: 1.0
 *
 * Relaciones entre: Ciudades ↔ Localidades ↔ Barrios
 * Uso: import './Models/Geografia/relacionesGeografia.js' en tu APP (una vez)
 */

import { CiudadesModel } from './MD_TB_Ciudades.js';
import { LocalidadesModel } from './MD_TB_Localidades.js';
import { BarriosModel } from './MD_TB_Barrios.js';

let _initialized = false;

export function initGeografiaRelations() {
  if (_initialized) return;
  _initialized = true;

  // Ciudad 1—N Localidades
  CiudadesModel.hasMany(LocalidadesModel, {
    as: 'localidades',
    foreignKey: 'ciudad_id',
    onUpdate: 'CASCADE',
    onDelete: 'RESTRICT'
  });
  LocalidadesModel.belongsTo(CiudadesModel, {
    as: 'ciudad',
    foreignKey: 'ciudad_id'
  });

  // Localidad 1—N Barrios
  LocalidadesModel.hasMany(BarriosModel, {
    as: 'barrios',
    foreignKey: 'localidad_id',
    onUpdate: 'CASCADE',
    onDelete: 'RESTRICT'
  });
  BarriosModel.belongsTo(LocalidadesModel, {
    as: 'localidad',
    foreignKey: 'localidad_id'
  });
}

// Inicializa al importar (si preferís llamarlo manual, comentá esta línea)
initGeografiaRelations();

export default { initGeografiaRelations };
