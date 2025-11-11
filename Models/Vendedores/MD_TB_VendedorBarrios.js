// ===============================
// FILE: Models/Vendedores/MD_TB_VendedorBarrios.js
// ===============================
/*
 * Programador: Benjamin Orellana
 * Fecha: 11 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 * Modelo Sequelize para la tabla 'vendedor_barrios'.
 * - Respeta DDL (INT UNSIGNED en FKs, DATETIME en fechas).
 * - Columnas: asignado_desde/hasta, estado, vigente_flag (generada en DB).
 * - Scopes útiles: vigentes.
 */

import dotenv from 'dotenv';
import db from '../../DataBase/db.js';
import { DataTypes, Op } from 'sequelize';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

export const VendedorBarrioModel = db.define(
  'vendedor_barrios',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true
    },

    vendedor_id: {
      type: DataTypes.INTEGER.UNSIGNED, // INT UNSIGNED para matchear FK
      allowNull: false
    },

    barrio_id: {
      type: DataTypes.INTEGER.UNSIGNED, // INT UNSIGNED para matchear FK
      allowNull: false
    },

    asignado_desde: {
      type: DataTypes.DATE, // DATETIME en DDL
      allowNull: false,
      defaultValue: db.Sequelize.literal('CURRENT_TIMESTAMP')
    },

    asignado_hasta: {
      type: DataTypes.DATE, // NULL = vigente
      allowNull: true,
      validate: {
        rangoFechas(value) {
          if (value && this.asignado_desde && value < this.asignado_desde) {
            throw new Error(
              'asignado_hasta no puede ser menor que asignado_desde.'
            );
          }
        }
      }
    },

    estado: {
      type: DataTypes.ENUM('activo', 'inactivo'),
      allowNull: false,
      defaultValue: 'activo'
    },

    // Columna generada en MySQL (STORED): IF(asignado_hasta IS NULL, 1, NULL)
    // La definimos como legible; MySQL la calculará (no enviar en INSERT/UPDATE)
    vigente_flag: {
      type: DataTypes.TINYINT,
      allowNull: true
    },

    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: db.Sequelize.literal('CURRENT_TIMESTAMP')
    },

    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: db.Sequelize.literal('CURRENT_TIMESTAMP')
    }
  },
  {
    tableName: 'vendedor_barrios',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    underscored: true,
    defaultScope: {
      order: [
        ['asignado_desde', 'DESC'],
        ['id', 'DESC']
      ]
    },
    scopes: {
      vigentes: {
        where: {
          asignado_hasta: { [Op.is]: null },
          estado: 'activo'
        }
      }
    },
    indexes: [
      // Repetimos los índices/uniques que ya están en la DB para que Sequelize los conozca
      {
        name: 'uq_barrio_un_vigente',
        unique: true,
        fields: ['barrio_id', 'vigente_flag']
      },
      {
        name: 'uq_vendor_barrio_vigente',
        unique: true,
        fields: ['vendedor_id', 'barrio_id', 'vigente_flag']
      },
      { name: 'idx_vb_vendedor', fields: ['vendedor_id'] },
      { name: 'idx_vb_barrio', fields: ['barrio_id'] },
      { name: 'idx_vb_desde', fields: ['asignado_desde'] },
      { name: 'idx_vb_hasta', fields: ['asignado_hasta'] },
      { name: 'idx_vb_estado', fields: ['estado'] }
    ]
  }
);

export default VendedorBarrioModel;
