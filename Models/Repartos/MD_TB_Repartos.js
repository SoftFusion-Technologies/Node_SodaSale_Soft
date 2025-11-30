/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 29 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 *  Modelo Sequelize para la tabla 'repartos'.
 *  Representa los recorridos/zona de reparto por ciudad, con rangos de numeración
 *  no superpuestos y estado de actividad.
 *
 * Tema: Modelos - Repartos
 * Capa: Backend
 */

import dotenv from 'dotenv';
import db from '../../DataBase/db.js';
import { DataTypes } from 'sequelize';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

export const RepartosModel = db.define(
  'repartos',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    ciudad_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      validate: {
        notNull: { msg: 'La ciudad es requerida' },
        isInt: { msg: 'El campo ciudad_id debe ser numérico' },
        min: {
          args: [1],
          msg: 'La ciudad debe ser un ID válido'
        }
      }
    },
    nombre: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: {
        notEmpty: { msg: 'El nombre del reparto es requerido' }
      },
      set(val) {
        // Normalizamos: trim + mayúsculas suaves
        const limpio = (val ?? '').toString().trim();
        this.setDataValue('nombre', limpio);
      }
    },
    rango_min: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      validate: {
        notNull: { msg: 'El rango mínimo es requerido' },
        isInt: { msg: 'El rango mínimo debe ser numérico' }
      }
    },
    rango_max: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      validate: {
        notNull: { msg: 'El rango máximo es requerido' },
        isInt: { msg: 'El rango máximo debe ser numérico' }
      }
    },
    estado: {
      type: DataTypes.ENUM('activo', 'inactivo'),
      allowNull: false,
      defaultValue: 'activo'
    },
    observaciones: {
      type: DataTypes.STRING(255),
      allowNull: true,
      set(val) {
        const limpio = (val ?? '').toString().trim();
        this.setDataValue('observaciones', limpio || null);
      }
    }
  },
  {
    tableName: 'repartos',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    underscored: true,
    indexes: [
      {
        name: 'uq_repartos_ciudad_nombre',
        unique: true,
        fields: ['ciudad_id', 'nombre']
      },
      {
        name: 'idx_repartos_ciudad',
        fields: ['ciudad_id']
      },
      {
        name: 'idx_repartos_estado',
        fields: ['estado']
      }
    ],
    validate: {
      rangoValido() {
        const min = Number(this.rango_min ?? 0);
        const max = Number(this.rango_max ?? 0);
        if (max < min) {
          throw new Error(
            'El rango máximo no puede ser menor que el rango mínimo.'
          );
        }
      }
    },
    defaultScope: {
      // filtrar solo activos:
      // where: { estado: 'activo' }
    },
    scopes: {
      activos: { where: { estado: 'activo' } },
      inactivos: { where: { estado: 'inactivo' } }
    }
  }
);

export default { RepartosModel };
