/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 10 / 11 / 2025
 * Versión: 1.0
 *
 * Modelo Sequelize: 'barrios'
 * - FK obligatoria a 'localidades' (localidad_id)
 * - Unique (localidad_id, nombre)
 * - created_at / updated_at con underscored
 */

import dotenv from 'dotenv';
import db from '../../DataBase/db.js';
import { DataTypes } from 'sequelize';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

export const BarriosModel = db.define(
  'barrios',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    localidad_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      references: { model: 'localidades', key: 'id' },
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
    tableName: 'barrios',
    freezeTableName: true,
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { name: 'idx_barrios_localidad', fields: ['localidad_id'] },
      { name: 'idx_barrios_estado', fields: ['estado'] },
      { name: 'idx_barrios_created', fields: ['created_at'] },
      {
        name: 'uq_barrios_localidad_nombre',
        unique: true,
        fields: ['localidad_id', 'nombre']
      }
    ],
    defaultScope: { order: [['nombre', 'ASC']] },
    scopes: { activas: { where: { estado: 'activa' } } }
  }
);

export default { BarriosModel };
