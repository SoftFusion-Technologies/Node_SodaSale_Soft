/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 10 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 * Modelo Sequelize para la tabla 'ciudades'.
 * - Campos base: nombre, provincia (por defecto Tucumán), estado (activa/inactiva).
 * - Timestamps snake_case (created_at / updated_at).
 * - Unique (nombre, provincia) para evitar duplicados por provincia.
 * - Scope 'activas' para filtrar rápido.
 */

import dotenv from 'dotenv';
import db from '../../DataBase/db.js';
import { DataTypes } from 'sequelize';
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

export const CiudadesModel = db.define(
  'ciudades',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    nombre: {
      type: DataTypes.STRING(120),
      allowNull: false,
      // unique compuesto: se comparte el mismo nombre con 'provincia'
      unique: 'uq_ciudades_nombre_provincia',
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
    provincia: {
      type: DataTypes.STRING(100),
      allowNull: false,
      defaultValue: 'Tucumán',
      unique: 'uq_ciudades_nombre_provincia',
      validate: {
        notEmpty: { msg: 'La provincia es obligatoria' },
        len: { args: [2, 100], msg: 'Provincia inválida' }
      },
      set(val) {
        this.setDataValue('provincia', (val ?? '').trim());
      }
    },
    estado: {
      type: DataTypes.ENUM('activa', 'inactiva'),
      allowNull: false,
      defaultValue: 'activa'
    }
  },
  {
    tableName: 'ciudades',
    timestamps: true,
    underscored: true, // created_at / updated_at
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    freezeTableName: true,
    indexes: [
      { name: 'idx_ciudades_provincia', fields: ['provincia'] },
      { name: 'idx_ciudades_estado', fields: ['estado'] },
      { name: 'idx_ciudades_created', fields: ['created_at'] }
    ],
    defaultScope: {
      order: [['nombre', 'ASC']]
    },
    scopes: {
      activas: { where: { estado: 'activa' } }
    }
  }
);

export default { CiudadesModel };
