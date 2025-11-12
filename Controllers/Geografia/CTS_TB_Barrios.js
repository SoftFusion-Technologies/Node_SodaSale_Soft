/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 10 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 * Controladores CRUD para 'barrios'.
 * - Listado con paginación y filtros (q, estado, localidad_id, ciudad_id).
 * - Alta/Edición validando UNIQUE(localidad_id, nombre) y existencia de localidad.
 * - Patch de estado (activa/inactiva).
 * - Borrado: si hay dependencias (clientes/ventas asignadas en el futuro), atrapamos la FK y sugerimos desactivar.
 */

import { Op } from 'sequelize';
import { BarriosModel } from '../../Models/Geografia/MD_TB_Barrios.js';
import { LocalidadesModel } from '../../Models/Geografia/MD_TB_Localidades.js';
import { CiudadesModel } from '../../Models/Geografia/MD_TB_Ciudades.js';

/* =======================
   Helpers
   ======================= */
const toInt = (v, d = 0) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
const stripEmpty = (obj = {}) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = v;
  }
  return out;
};
const allowedOrder = new Set([
  'nombre',
  'estado',
  'localidad_id',
  'created_at',
  'updated_at'
]);
const safeOrderBy = (v) => (allowedOrder.has(v) ? v : 'nombre');
const safeOrderDir = (v) =>
  String(v || '').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

/* =========================================================
   GET /geo/barrios → listado con paginación y filtros
   Query: q, estado, localidad_id, ciudad_id, page, limit, orderBy, orderDir
   ========================================================= */
export const OBRS_Barrios_CTS = async (req, res) => {
  try {
    const {
      q = '',
      estado,
      localidad_id,
      ciudad_id,
      page = 1,
      limit = 18,
      orderBy = 'nombre',
      orderDir = 'ASC'
    } = req.query;

    const where = {};
    if (q && q.trim()) where.nombre = { [Op.like]: `%${q.trim()}%` };
    if (estado && ['activa', 'inactiva'].includes(estado))
      where.estado = estado;
    if (localidad_id) where.localidad_id = toInt(localidad_id, 0) || undefined;

    // Filtro por ciudad_id usando include
    const includeLocalidad = {
      model: LocalidadesModel,
      as: 'localidad',
      attributes: ['id', 'nombre', 'ciudad_id'],
      include: [
        {
          model: CiudadesModel,
          as: 'ciudad',
          attributes: ['id', 'nombre', 'provincia']
        }
      ]
    };
    if (ciudad_id) {
      includeLocalidad.where = { ciudad_id: toInt(ciudad_id, 0) || -1 };
      includeLocalidad.required = true; // fuerza join para filtrar
    }

    const _page = Math.max(1, toInt(page, 1));
    const _limit = Math.min(100, Math.max(1, toInt(limit, 18)));
    const offset = (_page - 1) * _limit;

    const { rows, count } = await BarriosModel.findAndCountAll({
      where,
      offset,
      limit: _limit,
      order: [[safeOrderBy(orderBy), safeOrderDir(orderDir)]],
      include: [includeLocalidad]
    });

    const totalPages = Math.max(1, Math.ceil(count / _limit));
    const meta = {
      total: count,
      page: _page,
      limit: _limit,
      totalPages,
      hasPrev: _page > 1,
      hasNext: _page < totalPages
    };

    return res.json({ data: rows, meta });
  } catch (error) {
    console.error('OBRS_Barrios_CTS error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudieron cargar los barrios'
    });
  }
};

/* ==========================================
   GET /geo/barrios/:id → obtener uno
   ========================================== */
export const OBR_Barrio_CTS = async (req, res) => {
  try {
    const barrio = await BarriosModel.findByPk(req.params.id, {
      include: [
        {
          model: LocalidadesModel,
          as: 'localidad',
          attributes: ['id', 'nombre', 'ciudad_id'],
          include: [
            {
              model: CiudadesModel,
              as: 'ciudad',
              attributes: ['id', 'nombre', 'provincia']
            }
          ]
        }
      ]
    });
    if (!barrio) {
      return res
        .status(404)
        .json({ code: 'NOT_FOUND', mensajeError: 'Barrio no encontrado' });
    }
    return res.json(barrio);
  } catch (error) {
    console.error('OBR_Barrio_CTS error:', error);
    return res
      .status(500)
      .json({
        code: 'SERVER_ERROR',
        mensajeError: 'Error al obtener el barrio'
      });
  }
};

/* ==========================================
   POST /geo/barrios → crear
   Body: { localidad_id, nombre, estado? }
   ========================================== */
export const CR_Barrio_CTS = async (req, res) => {
  try {
    const payload = stripEmpty({
      localidad_id: req.body?.localidad_id,
      nombre: req.body?.nombre,
      estado: req.body?.estado ?? 'activa'
    });

    const lid = toInt(payload.localidad_id, 0);
    if (!lid) {
      return res
        .status(400)
        .json({
          code: 'BAD_REQUEST',
          mensajeError: 'La localidad es obligatoria'
        });
    }
    if (!payload.nombre) {
      return res
        .status(400)
        .json({
          code: 'BAD_REQUEST',
          mensajeError: 'El nombre es obligatorio'
        });
    }

    // Validar que exista la localidad
    const loc = await LocalidadesModel.findByPk(lid);
    if (!loc) {
      return res
        .status(404)
        .json({
          code: 'NOT_FOUND',
          mensajeError: 'La localidad indicada no existe'
        });
    }

    const nuevo = await BarriosModel.create({
      localidad_id: lid,
      nombre: payload.nombre,
      estado: payload.estado
    });

    return res
      .status(201)
      .json({ message: 'Barrio creado correctamente', barrio: nuevo });
  } catch (error) {
    console.error('CR_Barrio_CTS error:', error);

    if (error?.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        code: 'DUPLICATE',
        mensajeError: 'Ya existe un barrio con ese nombre en esa localidad',
        tips: [
          'Verificá que no esté cargado',
          'Cambiá el nombre o la localidad'
        ]
      });
    }
    if (error?.name === 'SequelizeValidationError') {
      return res.status(400).json({
        code: 'MODEL_VALIDATION',
        mensajeError: error?.errors?.[0]?.message || 'Datos inválidos'
      });
    }

    return res
      .status(500)
      .json({
        code: 'SERVER_ERROR',
        mensajeError: 'No se pudo crear el barrio'
      });
  }
};

// ===============================
// BULK: POST /geo/barrios/bulk
// Body:
// {
//   "localidad_id": 34,
//   "items": ["San Martín", {"nombre":"Belgrano","estado":"inactiva"}],
//   "dryRun": false
// }
// (Opcional) variante RESTful:
// POST /geo/localidades/:localidad_id/barrios/bulk  (mismo handler)
// ===============================
export const CR_Bulk_Barrios_CTS = async (req, res) => {
  const t = await BarriosModel.sequelize.transaction();
  try {
    const pathLocalidad = toInt(req.params?.localidad_id, 0);
    const { localidad_id, items, dryRun = false } = req.body || {};
    const lid = pathLocalidad || toInt(localidad_id, 0);

    // ---- Validaciones de payload
    if (!lid) {
      await t.rollback();
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'localidad_id es obligatorio y debe ser numérico'
      });
    }
    if (!Array.isArray(items) || items.length === 0) {
      await t.rollback();
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'items debe ser un array con al menos 1 elemento'
      });
    }
    if (items.length > 1000) {
      await t.rollback();
      return res.status(413).json({
        code: 'PAYLOAD_TOO_LARGE',
        mensajeError: 'Máximo 1000 barrios por bulk'
      });
    }

    // ---- Verificar existencia de la localidad
    const loc = await LocalidadesModel.findByPk(lid, { transaction: t });
    if (!loc) {
      await t.rollback();
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'La localidad indicada no existe'
      });
    }

    // ---- Helpers
    const normalizeNombre = (s) =>
      String(s || '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();

    const entrada = items
      .map((it) =>
        typeof it === 'string'
          ? { nombre: it, estado: 'activa' }
          : { nombre: it?.nombre, estado: it?.estado || 'activa' }
      )
      .filter((x) => x?.nombre && String(x.nombre).trim() !== '');

    if (entrada.length === 0) {
      await t.rollback();
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError:
          'No hay barrios válidos en items (verificá los nombres)'
      });
    }

    // ---- Buscar existentes (para evitar duplicados por UNIQUE local+nombre)
    const existentes = await BarriosModel.findAll({
      where: { localidad_id: lid },
      attributes: ['id', 'nombre'],
      transaction: t
    });
    const setExistentes = new Set(
      existentes.map((r) => normalizeNombre(r.nombre))
    );

    // ---- Filtrar duplicados internos y existentes
    const vistos = new Set();
    const aCrear = [];
    const omitidas = []; // { nombre, motivo }

    for (const it of entrada) {
      const nomNorm = normalizeNombre(it.nombre);

      if (vistos.has(nomNorm)) {
        omitidas.push({ nombre: it.nombre, motivo: 'Duplicado en el payload' });
        continue;
      }
      vistos.add(nomNorm);

      if (setExistentes.has(nomNorm)) {
        omitidas.push({
          nombre: it.nombre,
          motivo: 'Ya existe en la localidad (UNIQUE localidad_id + nombre)'
        });
        continue;
      }

      aCrear.push({
        localidad_id: lid,
        nombre: it.nombre.trim().replace(/\s+/g, ' '),
        estado: it.estado === 'inactiva' ? 'inactiva' : 'activa'
      });
    }

    // ---- Dry run → solo preview
    if (dryRun) {
      await t.rollback();
      return res.json({
        message: 'Preview de bulk (dryRun=true)',
        meta: {
          localidad_id: lid,
          solicitadas: items.length,
          validas: entrada.length,
          aCrear: aCrear.length,
          omitidas: omitidas.length
        },
        crear: aCrear,
        omitidas
      });
    }

    // ---- Insertar en bloque (MySQL/MariaDB: ignoreDuplicates)
    const creadas = await BarriosModel.bulkCreate(aCrear, {
      transaction: t,
      ignoreDuplicates: true
    });

    await t.commit();
    return res.status(201).json({
      message: 'Bulk de barrios procesado',
      meta: {
        localidad_id: lid,
        solicitadas: items.length,
        validas: entrada.length,
        creadas: creadas.length,
        omitidas: omitidas.length
      },
      creadas,
      omitidas
    });
  } catch (error) {
    await t.rollback();
    console.error('CR_Bulk_Barrios_CTS error:', error);

    if (error?.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        code: 'DUPLICATE',
        mensajeError:
          'Conflicto de UNIQUE en uno o más barrios (localidad_id, nombre)',
        tips: [
          'Ejecutá primero con dryRun=true para ver cuáles existen',
          'Revisá espacios/acentos y nombres repetidos'
        ]
      });
    }
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo procesar el bulk de barrios'
    });
  }
};

/* ==========================================
   PUT /geo/barrios/:id → actualizar
   Body permitido: { localidad_id?, nombre?, estado? }
   ========================================== */
export const UR_Barrio_CTS = async (req, res) => {
  try {
    const id = req.params.id;
    const barrio = await BarriosModel.findByPk(id);
    if (!barrio) {
      return res
        .status(404)
        .json({ code: 'NOT_FOUND', mensajeError: 'Barrio no encontrado' });
    }

    const permitidos = ['localidad_id', 'nombre', 'estado'];
    const base = {};
    for (const k of permitidos) if (k in req.body) base[k] = req.body[k];
    const payload = stripEmpty(base);

    if ('localidad_id' in payload) {
      const lid = toInt(payload.localidad_id, 0);
      if (!lid) {
        return res
          .status(400)
          .json({ code: 'BAD_REQUEST', mensajeError: 'localidad_id inválido' });
      }
      // Validar existencia de localidad destino
      const loc = await LocalidadesModel.findByPk(lid);
      if (!loc) {
        return res
          .status(404)
          .json({
            code: 'NOT_FOUND',
            mensajeError: 'La localidad indicada no existe'
          });
      }
      payload.localidad_id = lid;
    }

    const [updated] = await BarriosModel.update(payload, {
      where: { id },
      fields: Object.keys(payload)
    });

    if (updated !== 1) {
      return res
        .status(500)
        .json({
          code: 'SERVER_ERROR',
          mensajeError: 'No se pudo actualizar el barrio'
        });
    }

    const actualizado = await BarriosModel.findByPk(id, {
      include: [
        {
          model: LocalidadesModel,
          as: 'localidad',
          attributes: ['id', 'nombre', 'ciudad_id'],
          include: [
            {
              model: CiudadesModel,
              as: 'ciudad',
              attributes: ['id', 'nombre', 'provincia']
            }
          ]
        }
      ]
    });
    return res.json({
      message: 'Barrio actualizado correctamente',
      barrio: actualizado
    });
  } catch (error) {
    console.error('UR_Barrio_CTS error:', error);

    if (error?.name === 'SequelizeUniqueConstraintError') {
      return res
        .status(409)
        .json({
          code: 'DUPLICATE',
          mensajeError: 'Ya existe un barrio con ese nombre en esa localidad'
        });
    }
    if (error?.name === 'SequelizeValidationError') {
      return res
        .status(400)
        .json({
          code: 'MODEL_VALIDATION',
          mensajeError: error?.errors?.[0]?.message || 'Datos inválidos'
        });
    }

    return res
      .status(500)
      .json({
        code: 'SERVER_ERROR',
        mensajeError: 'Error al actualizar el barrio'
      });
  }
};

/* ==========================================
   PATCH /geo/barrios/:id/estado → cambiar estado
   Body: { estado: 'activa' | 'inactiva' }
   ========================================== */
export const PR_Barrio_Estado_CTS = async (req, res) => {
  try {
    const id = req.params.id;
    const { estado } = req.body || {};
    if (!['activa', 'inactiva'].includes(estado)) {
      return res
        .status(400)
        .json({
          code: 'BAD_REQUEST',
          mensajeError: "Estado inválido. Use 'activa' o 'inactiva'."
        });
    }
    const [updated] = await BarriosModel.update(
      { estado },
      { where: { id }, fields: ['estado'] }
    );
    if (updated !== 1) {
      return res
        .status(404)
        .json({ code: 'NOT_FOUND', mensajeError: 'Barrio no encontrado' });
    }
    const barrio = await BarriosModel.findByPk(id);
    return res.json({ message: 'Estado actualizado', barrio });
  } catch (error) {
    console.error('PR_Barrio_Estado_CTS error:', error);
    return res
      .status(500)
      .json({
        code: 'SERVER_ERROR',
        mensajeError: 'No se pudo actualizar el estado'
      });
  }
};

/* ==========================================
   DELETE /geo/barrios/:id → eliminar
   - Si hay FKs (clientes/ventas en el futuro), el DB tirará FK error → lo traducimos.
   - Tip: si no se puede borrar por dependencias, desactivar (PATCH /estado).
   ========================================== */
export const ER_Barrio_CTS = async (req, res) => {
  try {
    const id = req.params.id;

    const barrio = await BarriosModel.findByPk(id);
    if (!barrio) {
      return res
        .status(404)
        .json({ code: 'NOT_FOUND', mensajeError: 'Barrio no encontrado' });
    }

    await BarriosModel.destroy({ where: { id } });
    return res.json({ message: 'Barrio eliminado correctamente' });
  } catch (error) {
    // Si en el futuro hay FKs (clientes, asignaciones, ventas), caemos acá
    if (error?.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(409).json({
        code: 'HAS_DEPENDENCIES',
        mensajeError: 'No se puede eliminar: el barrio posee datos asociados.',
        tips: [
          'Reasigná o eliminá las dependencias',
          'Como alternativa, desactivá el barrio'
        ]
      });
    }
    console.error('ER_Barrio_CTS error:', error);
    return res
      .status(500)
      .json({
        code: 'SERVER_ERROR',
        mensajeError: 'No se pudo eliminar el barrio'
      });
  }
};
