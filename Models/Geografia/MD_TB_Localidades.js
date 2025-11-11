/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 10 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 * Modelo Sequelize para la tabla 'localidades'.
 * - FK obligatoria a 'ciudades' (ciudad_id).
 * - Unique (ciudad_id, nombre) para evitar duplicados dentro de la ciudad.
 * - Timestamps snake_case (created_at / updated_at).
 * - Scope 'activas' para listar rápido.
 *
 */

import dotenv from 'dotenv';
import db from '../../DataBase/db.js';
import { DataTypes } from 'sequelize';
import { CiudadesModel } from './MD_TB_Ciudades.js';
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

export const LocalidadesModel = db.define(
  'localidades',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    ciudad_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      references: {
        model: 'ciudades',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    },
    nombre: {
      type: DataTypes.STRING(120),
      allowNull: false,
      validate: {
        notEmpty: { msg: 'El nombre es obligatorio' },
        len: {
          args: [2, 120],
          msg: 'El nombre debe tener entre 2 y 120 caracteres'
        }
      },
      set(val) {
        this.setDataValue('nombre', (val ?? '').trim());
      }
    },
    estado: {
      type: DataTypes.ENUM('activa', 'inactiva'),
      allowNull: false,
      defaultValue: 'activa'
    }
  },
  {
    tableName: 'localidades',
    freezeTableName: true,
    timestamps: true,
    underscored: true, // created_at / updated_at
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { name: 'idx_localidades_ciudad', fields: ['ciudad_id'] },
      { name: 'idx_localidades_estado', fields: ['estado'] },
      { name: 'idx_localidades_created', fields: ['created_at'] },
      {
        name: 'uq_localidades_ciudad_nombre',
        unique: true,
        fields: ['ciudad_id', 'nombre']
      }
    ],
    defaultScope: {
      order: [['nombre', 'ASC']]
    },
    scopes: {
      activas: { where: { estado: 'activa' } }
    }
  }
);

export default { LocalidadesModel };
