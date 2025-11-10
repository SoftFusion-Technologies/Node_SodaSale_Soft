// config/importConfig.js
import { CategoriasModel } from '../Models/Stock/MD_TB_Categorias.js';
import { ProductosModel } from '../Models/Stock/MD_TB_Productos.js';
import { StockModel } from '../Models/Stock/MD_TB_Stock.js';

export default {
  categorias: {
    model: CategoriasModel,
    required: ['nombre'],
    optional: ['descripcion', 'estado'],
    transform: (row) => ({
      nombre: row.nombre,
      descripcion: row.descripcion || null,
      estado: row.estado?.toLowerCase() === 'inactivo' ? 'inactivo' : 'activo'
    })
  },

  productos: {
    model: ProductosModel,
    required: ['nombre', 'precio'],
    optional: ['descripcion', 'imagen_url', 'estado', 'categoria_id'],
    transform: (row) => ({
      nombre: row.nombre,
      descripcion: row.descripcion || null,
      precio: parseFloat(row.precio) || 0,
      imagen_url: row.imagen_url || null,
      estado: row.estado?.toLowerCase() === 'inactivo' ? 'inactivo' : 'activo',
      categoria_id: row.categoria_id || null
    })
  },

  stock: {
    model: StockModel,
    required: ['producto_id', 'local_id', 'cantidad'],
    optional: [
      'talle_id',
      'lugar_id',
      'estado_id',
      'en_perchero',
      'codigo_sku'
    ],
    transform: (row) => ({
      producto_id: row.producto_id,
      local_id: row.local_id,
      cantidad: parseInt(row.cantidad) || 0,
      talle_id: row.talle_id || null,
      lugar_id: row.lugar_id || null,
      estado_id: row.estado_id || null,
      en_perchero: row.en_perchero === 0 ? 0 : 1,
      codigo_sku: row.codigo_sku || null
    })
  }
};
