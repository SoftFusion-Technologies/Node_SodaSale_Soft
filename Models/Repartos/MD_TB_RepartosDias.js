/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 29 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 *  Modelo Sequelize para la tabla 'repartos_dias'.
 *  Define qué días y turnos se realiza cada reparto (frecuencia de reparto).
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

export const RepartosDiasModel = db.define(
  'repartos_dias',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    reparto_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: 'FK → repartos.id',
      validate: {
        notNull: { msg: 'El reparto es requerido' },
        isInt: { msg: 'El campo reparto_id debe ser numérico' },
        min: {
          args: [1],
          msg: 'El reparto debe ser un ID válido'
        }
      }
    },
    dia_semana: {
      type: DataTypes.TINYINT.UNSIGNED || DataTypes.INTEGER.UNSIGNED, // fallback si TINYINT no aplica
      allowNull: false,
      comment: '1 = Lunes ... 7 = Domingo',
      validate: {
        notNull: { msg: 'El día de semana es requerido' },
        isInt: { msg: 'El día de semana debe ser numérico' },
        rango(val) {
          const n = Number(val ?? 0);
          if (n < 1 || n > 7) {
            throw new Error(
              'El día de semana debe estar entre 1 (Lunes) y 7 (Domingo).'
            );
          }
        }
      }
    },
    turno: {
      type: DataTypes.ENUM('maniana', 'tarde', 'noche'),
      allowNull: true,
      comment:
        'Turno opcional: maniana / tarde / noche. Puede ser NULL si no se distingue turno.'
    }
  },
  {
    tableName: 'repartos_dias',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    underscored: true,
    indexes: [
      {
        name: 'uq_repdia_reparto_dia_turno',
        unique: true,
        fields: ['reparto_id', 'dia_semana', 'turno']
      },
      {
        name: 'idx_repdia_reparto',
        fields: ['reparto_id']
      }
    ],
    defaultScope: {
      // sin filtros por defecto
    },
    scopes: {
      // Ej: uso típico -> RepartosDiasModel.scope({ method: ['porReparto', id] })
      porReparto(repartoId) {
        return {
          where: { reparto_id: repartoId }
        };
      }
    }
  }
);

export default { RepartosDiasModel };
