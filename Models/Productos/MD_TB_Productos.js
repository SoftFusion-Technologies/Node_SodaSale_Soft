/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 10 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 * Modelo Sequelize para la tabla 'productos'.
 * Incluye validaciones de coherencia (presentación vs pack, rango de IVA) e índices.
 *
 * Tema: Modelos - Productos
 * Capa: Backend
 */

import dotenv from 'dotenv';
import db from '../../DataBase/db.js';
import { DataTypes } from 'sequelize';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

export const ProductosModel = db.define(
  'productos',
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    nombre: {
      type: DataTypes.STRING(120),
      allowNull: false,
      validate: {
        notEmpty: { msg: 'El nombre es requerido' }
      },
      set(val) {
        this.setDataValue('nombre', (val ?? '').trim());
      }
    },
    codigo_sku: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
      set(val) {
        // Normalizamos: trim + mayúsculas
        this.setDataValue(
          'codigo_sku',
          (val ?? '').toString().trim().toUpperCase()
        );
      },
      validate: {
        notEmpty: { msg: 'El código SKU es requerido' }
      }
    },
    presentacion: {
      type: DataTypes.ENUM('unidad', 'pack'),
      allowNull: false,
      defaultValue: 'unidad'
    },
    pack_cantidad: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 1
    },
    unidad_medida: {
      type: DataTypes.ENUM('u', 'ml', 'l', 'g', 'kg'),
      allowNull: true,
      defaultValue: 'u'
    },
    contenido: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    },
    barra_ean13: {
      type: DataTypes.STRING(13),
      allowNull: true,
      unique: true,
      validate: {
        len: { args: [8, 13], msg: 'El EAN debe tener entre 8 y 13 dígitos' },
        is: { args: /^[0-9]+$/i, msg: 'El EAN debe ser numérico' }
      }
    },
    iva_porcentaje: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 21.0
    },
    estado: {
      type: DataTypes.ENUM('activo', 'inactivo'),
      allowNull: false,
      defaultValue: 'activo'
    },
    notas: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  },
  {
    tableName: 'productos',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    underscored: true,
    indexes: [
      { name: 'idx_productos_nombre', fields: ['nombre'] },
      { name: 'idx_productos_estado', fields: ['estado'] }
    ],
    validate: {
      ivaRange() {
        const iva = Number(this.iva_porcentaje ?? 0);
        if (iva < 0 || iva > 27) {
          throw new Error('IVA fuera de rango (0–27).');
        }
      },
      presentacionPack() {
        const pres = this.presentacion;
        const cant = Number(this.pack_cantidad ?? 0);
        if (pres === 'unidad' && cant !== 1) {
          throw new Error(
            'Para presentación "unidad", pack_cantidad debe ser 1.'
          );
        }
        if (pres === 'pack' && !(cant > 1)) {
          throw new Error(
            'Para presentación "pack", pack_cantidad debe ser > 1.'
          );
        }
      }
    },
    defaultScope: {
      // nada por defecto
      // where: { estado: 'activo' }
    },
    scopes: {
      activos: { where: { estado: 'activo' } },
      inactivos: { where: { estado: 'inactivo' } }
    }
  }
);

export default { ProductosModel };
