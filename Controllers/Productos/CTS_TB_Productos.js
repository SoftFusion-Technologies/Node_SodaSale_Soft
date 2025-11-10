/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 10 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 * Controladores CRUD para 'productos' con paginación flexible:
 * - Soporta offset clásico (page/pageSize o limit/offset).
 * - Soporta keyset pagination (mode=keyset&last_id=123) para listas largas sin costo de offset grande.
 * - Búsqueda por q (nombre o SKU), filtros por estado y presentación, y ordenamiento con whitelist.
 *
 * Tema: Controladores - Productos
 * Capa: Backend
 *
 * Notas:
 * - Si quieren mejorar la performance cuando hay millones de filas, usár mode=keyset y orden por id DESC.
 */

import { ProductosModel } from '../../Models/Productos/MD_TB_Productos.js';
import { Op } from 'sequelize';

// ---------- Helpers chiquitos y útiles ----------

// Quitar claves vacías ('', null, undefined) para no ensuciar updates
const stripEmpty = (obj = {}) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = v;
  }
  return out;
};

// Normalizar ints seguros
const toInt = (v, def = 0) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
};

// Whitelist de ordenamiento para evitar SQL injection por columnas inventadas
const ORDER_WHITELIST = new Set([
  'id',
  'nombre',
  'codigo_sku',
  'presentacion',
  'pack_cantidad',
  'estado',
  'created_at',
  'updated_at'
]);

const sanitizeOrder = (orderBy = 'created_at', orderDir = 'DESC') => {
  const col = ORDER_WHITELIST.has(orderBy) ? orderBy : 'created_at';
  const dir =
    String(orderDir || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  return [col, dir];
};

// ---------- LISTAR (GET /productos) ----------
export const OBRS_Productos_CTS = async (req, res) => {
  try {
    const {
      q,
      estado,
      presentacion,
      // paginación
      page,
      pageSize,
      limit,
      offset,
      mode, // 'keyset' o undefined
      last_id, // para keyset
      // orden
      orderBy,
      orderDir,
      // performance
      count = '1' // '0' para evitar COUNT(*)
    } = req.query;

    const [col, dir] = sanitizeOrder(orderBy, orderDir);

    // Armamos filtros
    const where = {};
    if (q && String(q).trim() !== '') {
      const like = `%${String(q).trim()}%`;
      where[Op.or] = [
        { nombre: { [Op.like]: like } },
        { codigo_sku: { [Op.like]: like } }
      ];
    }
    if (estado) where.estado = estado; // 'activo' | 'inactivo'
    if (presentacion) where.presentacion = presentacion; // 'unidad' | 'pack'

    // Paginación
    const useKeyset = String(mode).toLowerCase() === 'keyset';
    // default pageSize si no vino nada: 20 (sano)
    const lim = Math.max(1, toInt(limit ?? pageSize ?? 20, 20));

    let off = 0;
    let keysetCursor = null;

    if (useKeyset) {
      // Para keyset siempre ordenamos por ID (con dirección coherente), así es estable.
      // Consejo: usar id DESC para "scroll infinito" natural
      if (col !== 'id') {
        // Si te ponés exquisito, podés soportar col secundaria y luego id, pero id solo es simple y robusto.
      }
      if (last_id) {
        // Si venimos en DESC, traemos < last_id; si fuera ASC, > last_id
        where.id =
          dir === 'DESC'
            ? { [Op.lt]: toInt(last_id, 0) }
            : { [Op.gt]: toInt(last_id, 0) };
      }
    } else {
      // Offset clásico: aceptamos page/pageSize o limit/offset
      if (offset !== undefined) {
        off = Math.max(0, toInt(offset, 0));
      } else if (page !== undefined) {
        const p = Math.max(1, toInt(page, 1));
        const ps = Math.max(1, toInt(pageSize ?? lim, lim));
        off = (p - 1) * ps;
      }
    }

    // COUNT opcional (cuando necesitás total para paginación con números de página)
    let total = null;
    if (!useKeyset && String(count) !== '0') {
      total = await ProductosModel.count({ where });
    }

    const rows = await ProductosModel.findAll({
      where,
      order: [[col, dir], ...(col === 'id' ? [] : [['id', 'DESC']])], // orden secundario por id para estabilidad
      limit: lim,
      offset: useKeyset ? undefined : off
    });

    // Meta de paginación
    let hasNext = false;
    let nextOffset = null;
    let nextCursor = null;
    let pageMeta = null;

    if (useKeyset) {
      hasNext = rows.length === lim; // si devolvió lleno, probablemente hay siguiente
      nextCursor = hasNext ? rows[rows.length - 1]?.id : null;
    } else {
      const usedTotal = total ?? 0;
      hasNext = off + rows.length < usedTotal;
      nextOffset = hasNext ? off + lim : null;

      // info de páginas si se trabaja con page/pageSize
      if (page !== undefined || pageSize !== undefined) {
        const ps = Math.max(1, toInt(pageSize ?? lim, lim));
        const p = Math.floor(off / ps) + 1;
        const totalPages = usedTotal > 0 ? Math.ceil(usedTotal / ps) : 1;
        pageMeta = { page: p, pageSize: ps, totalPages };
      }
    }

    return res.json({
      data: rows,
      meta: {
        mode: useKeyset ? 'keyset' : 'offset',
        orderBy: col,
        orderDir: dir,
        total,
        limit: lim,
        offset: useKeyset ? undefined : off,
        hasNext,
        nextOffset,
        nextCursor,
        ...pageMeta
      }
    });
  } catch (error) {
    console.error('Error al listar productos:', error);
    return res.status(500).json({
      mensajeError: 'Ocurrió un error al obtener los productos',
      detalles: error?.message || error
    });
  }
};

// ---------- OBTENER UNO (GET /productos/:id) ----------
export const OBR_Producto_CTS = async (req, res) => {
  try {
    const prod = await ProductosModel.findByPk(req.params.id);
    if (!prod)
      return res.status(404).json({ mensajeError: 'Producto no encontrado' });
    return res.json(prod);
  } catch (error) {
    console.error('Error al obtener producto:', error);
    return res.status(500).json({ mensajeError: error.message });
  }
};

// ---------- CREAR (POST /productos) ----------
export const CR_Producto_CTS = async (req, res) => {
  try {
    // Permitimos solo campos válidos (evitamos que nos cuelen cualquier key rara)
    const permitidos = [
      'nombre',
      'codigo_sku',
      'presentacion',
      'pack_cantidad',
      'unidad_medida',
      'contenido',
      'barra_ean13',
      'iva_porcentaje',
      'estado',
      'notas'
    ];

    const data = {};
    for (const k of permitidos) if (k in req.body) data[k] = req.body[k];

    // saneamos vacíos
    const payload = stripEmpty(data);

    // valores por defecto sanos (por si vienen incompletos)
    if (!('presentacion' in payload)) payload.presentacion = 'unidad';
    if (!('pack_cantidad' in payload))
      payload.pack_cantidad = payload.presentacion === 'pack' ? 12 : 1;

    const creado = await ProductosModel.create(payload);
    return res.json({
      message: 'Producto creado correctamente',
      producto: creado
    });
  } catch (error) {
    console.error('Error al crear producto:', error);
    return res.status(400).json({
      mensajeError: 'No se pudo crear el producto',
      detalles: error?.errors || error?.message || error
    });
  }
};

// ---------- ACTUALIZAR (PUT /productos/:id) ----------
export const UR_Producto_CTS = async (req, res) => {
  try {
    const { id } = req.params;
    const existente = await ProductosModel.findByPk(id);
    if (!existente)
      return res.status(404).json({ mensajeError: 'Producto no encontrado' });

    const permitidos = [
      'nombre',
      'codigo_sku',
      'presentacion',
      'pack_cantidad',
      'unidad_medida',
      'contenido',
      'barra_ean13',
      'iva_porcentaje',
      'estado',
      'notas'
    ];

    const base = {};
    for (const k of permitidos) if (k in req.body) base[k] = req.body[k];
    const payload = stripEmpty(base);

    // Acá no forzamos coherencias: dejamos que el modelo valide (y si pifia, devuelve el error prolijo)
    const [updated] = await ProductosModel.update(payload, {
      where: { id },
      fields: Object.keys(payload)
    });

    if (updated !== 1) {
      return res
        .status(404)
        .json({ mensajeError: 'Producto no encontrado o sin cambios' });
    }

    const actualizado = await ProductosModel.findByPk(id);
    return res.json({
      message: 'Producto actualizado correctamente',
      producto: actualizado
    });
  } catch (error) {
    console.error('Error al actualizar producto:', error);
    return res.status(400).json({
      mensajeError: 'No se pudo actualizar el producto',
      detalles: error?.errors || error?.message || error
    });
  }
};

// ---------- ELIMINAR (DELETE /productos/:id) ----------
// Por defecto hacemos "baja lógica" (estado='inactivo') para no romper referencias.
// Si querés borrado físico: pasá ?hard=1 (bajo tu responsabilidad, papá 😅).
export const ER_Producto_CTS = async (req, res) => {
  try {
    const { id } = req.params;
    const hard = ['1', 'true', 'sí', 'si'].includes(
      String(req.query.hard || '').toLowerCase()
    );

    const existe = await ProductosModel.findByPk(id);
    if (!existe)
      return res.status(404).json({ mensajeError: 'Producto no encontrado' });

    if (hard) {
      await ProductosModel.destroy({ where: { id } });
      return res.json({ message: 'Producto eliminado (hard delete)' });
    } else {
      await ProductosModel.update({ estado: 'inactivo' }, { where: { id } });
      const inactivado = await ProductosModel.findByPk(id);
      return res.json({
        message: 'Producto dado de baja (estado=inactivo)',
        producto: inactivado
      });
    }
  } catch (error) {
    console.error('Error al eliminar producto:', error);
    return res.status(500).json({ mensajeError: error?.message || error });
  }
};

// ---------- (Opcional) Cambiar estado directo (PATCH /productos/:id/estado) ----------
export const UR_Producto_Estado_CTS = async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body; // 'activo' | 'inactivo'
    if (!['activo', 'inactivo'].includes(String(estado))) {
      return res.status(400).json({ mensajeError: 'Estado inválido' });
    }
    const [n] = await ProductosModel.update({ estado }, { where: { id } });
    if (n !== 1)
      return res.status(404).json({ mensajeError: 'Producto no encontrado' });
    const producto = await ProductosModel.findByPk(id);
    return res.json({ message: 'Estado actualizado', producto });
  } catch (error) {
    console.error('Error al cambiar estado:', error);
    return res.status(500).json({ mensajeError: error?.message || error });
  }
};

export default {
  OBRS_Productos_CTS,
  OBR_Producto_CTS,
  CR_Producto_CTS,
  UR_Producto_CTS,
  ER_Producto_CTS,
  UR_Producto_Estado_CTS
};
