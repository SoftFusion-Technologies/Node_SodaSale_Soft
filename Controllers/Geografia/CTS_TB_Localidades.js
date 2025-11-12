/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 10 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 * Controladores CRUD para 'localidades'.
 * - Listado con paginación y filtros (q, estado, ciudad_id).
 * - Alta/Edición validando UNIQUE(ciudad_id, nombre) y existencia de ciudad.
 * - Patch de estado (activa/inactiva).
 * - Borrado: si hay barrios asociados, bloquea y sugiere desactivar.
 */

import { Op } from 'sequelize';
import { LocalidadesModel } from '../../Models/Geografia/MD_TB_Localidades.js';
import { CiudadesModel } from '../../Models/Geografia/MD_TB_Ciudades.js';
import { BarriosModel } from '../../Models/Geografia/MD_TB_Barrios.js';

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
  'ciudad_id',
  'created_at',
  'updated_at'
]);
const safeOrderBy = (v) => (allowedOrder.has(v) ? v : 'nombre');
const safeOrderDir = (v) =>
  String(v || '').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

/* =========================================================
   GET /geo/localidades  → listado con paginación y filtros
   Query: q, estado, ciudad_id, page, limit, orderBy, orderDir
   ========================================================= */
export const OBRS_Localidades_CTS = async (req, res) => {
  try {
    const {
      q = '',
      estado,
      ciudad_id,
      page = 1,
      limit = 18,
      orderBy = 'nombre',
      orderDir = 'ASC'
    } = req.query;

    const where = {};
    if (q && q.trim()) {
      where.nombre = { [Op.like]: `%${q.trim()}%` };
    }
    if (estado && ['activa', 'inactiva'].includes(estado)) {
      where.estado = estado;
    }
    if (ciudad_id) {
      const cid = toInt(ciudad_id, 0);
      if (cid > 0) where.ciudad_id = cid;
    }

    const _page = Math.max(1, toInt(page, 1));
    const _limit = Math.min(100, Math.max(1, toInt(limit, 18)));
    const offset = (_page - 1) * _limit;

    const { rows, count } = await LocalidadesModel.findAndCountAll({
      where,
      offset,
      limit: _limit,
      order: [[safeOrderBy(orderBy), safeOrderDir(orderDir)]],
      include: [
        {
          model: CiudadesModel,
          as: 'ciudad',
          attributes: ['id', 'nombre', 'provincia']
        }
      ]
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
    console.error('OBRS_Localidades_CTS error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudieron cargar las localidades'
    });
  }
};

/* ==========================================
   GET /geo/localidades/:id  → obtener una
   ========================================== */
export const OBR_Localidad_CTS = async (req, res) => {
  try {
    const localidad = await LocalidadesModel.findByPk(req.params.id, {
      include: [
        {
          model: CiudadesModel,
          as: 'ciudad',
          attributes: ['id', 'nombre', 'provincia']
        }
      ]
    });
    if (!localidad) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Localidad no encontrada'
      });
    }
    return res.json(localidad);
  } catch (error) {
    console.error('OBR_Localidad_CTS error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'Error al obtener la localidad'
    });
  }
};

/* ==========================================
   POST /geo/localidades  → crear
   Body: { ciudad_id, nombre, estado? }
   ========================================== */
export const CR_Localidad_CTS = async (req, res) => {
  try {
    const payload = stripEmpty({
      ciudad_id: req.body?.ciudad_id,
      nombre: req.body?.nombre,
      estado: req.body?.estado ?? 'activa'
    });

    const ciudad_id_num = toInt(payload.ciudad_id, 0);
    if (!ciudad_id_num) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'La ciudad es obligatoria'
      });
    }
    if (!payload.nombre) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'El nombre es obligatorio'
      });
    }

    // Validar que exista la ciudad
    const ciudad = await CiudadesModel.findByPk(ciudad_id_num);
    if (!ciudad) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'La ciudad indicada no existe'
      });
    }

    const nueva = await LocalidadesModel.create({
      ciudad_id: ciudad_id_num,
      nombre: payload.nombre,
      estado: payload.estado
    });

    return res.status(201).json({
      message: 'Localidad creada correctamente',
      localidad: nueva
    });
  } catch (error) {
    console.error('CR_Localidad_CTS error:', error);

    if (error?.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        code: 'DUPLICATE',
        mensajeError: 'Ya existe una localidad con ese nombre en esa ciudad',
        tips: ['Verificá que no esté cargada', 'Cambiá el nombre o la ciudad']
      });
    }

    if (error?.name === 'SequelizeValidationError') {
      return res.status(400).json({
        code: 'MODEL_VALIDATION',
        mensajeError: error?.errors?.[0]?.message || 'Datos inválidos'
      });
    }

    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo crear la localidad'
    });
  }
};

// ===============================
// BULK: POST /geo/localidades/bulk
// Body:
// {
//   "ciudad_id": 12,
//   "items": ["Centro", "Norte", {"nombre":"Sur","estado":"inactiva"}],
//   "dryRun": false   // opcional: true = simula sin insertar
// }
// ===============================
export const CR_Bulk_Localidades_CTS = async (req, res) => {
  const t = await LocalidadesModel.sequelize.transaction();
  try {
    const { ciudad_id, items, dryRun = false } = req.body || {};

    // ---- Validaciones de payload
    const cid = toInt(ciudad_id, 0);
    if (!cid) {
      await t.rollback();
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'ciudad_id es obligatorio y debe ser numérico'
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
        mensajeError: 'Máximo 1000 localidades por bulk'
      });
    }

    // ---- Verificar existencia de la ciudad
    const ciudad = await CiudadesModel.findByPk(cid, { transaction: t });
    if (!ciudad) {
      await t.rollback();
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'La ciudad indicada no existe'
      });
    }

    // ---- Helpers locales
    const normalizeNombre = (s) =>
      String(s || '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();

    // Normalizar items de entrada a objetos { nombre, estado }
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
          'No hay localidades válidas en items (verificá los nombres)'
      });
    }

    // ---- Buscar existentes en la ciudad (para evitar duplicados)
    const existentes = await LocalidadesModel.findAll({
      where: { ciudad_id: cid },
      attributes: ['id', 'nombre'],
      transaction: t
    });

    const setExistentes = new Set(
      existentes.map((r) => normalizeNombre(r.nombre))
    );

    // ---- Filtrar duplicados internos y ya existentes
    const vistos = new Set();
    const aCrear = [];
    const omitidas = []; // { nombre, motivo }

    for (const it of entrada) {
      const nomNorm = normalizeNombre(it.nombre);

      if (vistos.has(nomNorm)) {
        omitidas.push({
          nombre: it.nombre,
          motivo: 'Duplicado en el payload'
        });
        continue;
      }
      vistos.add(nomNorm);

      if (setExistentes.has(nomNorm)) {
        omitidas.push({
          nombre: it.nombre,
          motivo: 'Ya existe en la ciudad (UNIQUE ciudad_id + nombre)'
        });
        continue;
      }

      aCrear.push({
        ciudad_id: cid,
        nombre: it.nombre.trim().replace(/\s+/g, ' '),
        estado: it.estado === 'inactiva' ? 'inactiva' : 'activa'
      });
    }

    // ---- Si es dryRun solo devolvemos el preview
    if (dryRun) {
      await t.rollback();
      return res.json({
        message: 'Preview de bulk (dryRun=true)',
        meta: {
          ciudad_id: cid,
          solicitadas: items.length,
          validas: entrada.length,
          aCrear: aCrear.length,
          omitidas: omitidas.length
        },
        crear: aCrear,
        omitidas
      });
    }

    // ---- Insertar en bloque (con protección ante carrera)
    // ignoreDuplicates funciona en MySQL/MariaDB; si usás otro motor, podés
    // removerlo y manejar la excepción de UNIQUE manualmente.
    const creadas = await LocalidadesModel.bulkCreate(aCrear, {
      transaction: t,
      ignoreDuplicates: true
    });

    await t.commit();

    return res.status(201).json({
      message: 'Bulk de localidades procesado',
      meta: {
        ciudad_id: cid,
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
    console.error('CR_Bulk_Localidades_CTS error:', error);

    if (error?.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        code: 'DUPLICATE',
        mensajeError:
          'Conflicto de UNIQUE en una o más localidades (ciudad_id, nombre)',
        tips: [
          'Ejecutá primero con dryRun=true para ver cuáles existen',
          'Revisá espacios/acentos y nombres repetidos'
        ]
      });
    }

    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo procesar el bulk de localidades'
    });
  }
};

/* ==========================================
   PUT /geo/localidades/:id  → actualizar
   Body permitido: { ciudad_id?, nombre?, estado? }
   ========================================== */
export const UR_Localidad_CTS = async (req, res) => {
  try {
    const id = req.params.id;
    const localidad = await LocalidadesModel.findByPk(id);
    if (!localidad) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Localidad no encontrada'
      });
    }

    const permitidos = ['ciudad_id', 'nombre', 'estado'];
    const base = {};
    for (const k of permitidos) if (k in req.body) base[k] = req.body[k];
    const payload = stripEmpty(base);

    if ('ciudad_id' in payload) {
      const cid = toInt(payload.ciudad_id, 0);
      if (!cid) {
        return res.status(400).json({
          code: 'BAD_REQUEST',
          mensajeError: 'ciudad_id inválido'
        });
      }
      // Validar existencia de ciudad objetivo
      const ciudad = await CiudadesModel.findByPk(cid);
      if (!ciudad) {
        return res.status(404).json({
          code: 'NOT_FOUND',
          mensajeError: 'La ciudad indicada no existe'
        });
      }
      payload.ciudad_id = cid;
    }

    const [updated] = await LocalidadesModel.update(payload, {
      where: { id },
      fields: Object.keys(payload)
    });

    if (updated !== 1) {
      return res.status(500).json({
        code: 'SERVER_ERROR',
        mensajeError: 'No se pudo actualizar la localidad'
      });
    }

    const actualizada = await LocalidadesModel.findByPk(id, {
      include: [
        {
          model: CiudadesModel,
          as: 'ciudad',
          attributes: ['id', 'nombre', 'provincia']
        }
      ]
    });
    return res.json({
      message: 'Localidad actualizada correctamente',
      localidad: actualizada
    });
  } catch (error) {
    console.error('UR_Localidad_CTS error:', error);

    if (error?.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        code: 'DUPLICATE',
        mensajeError: 'Ya existe una localidad con ese nombre en esa ciudad'
      });
    }
    if (error?.name === 'SequelizeValidationError') {
      return res.status(400).json({
        code: 'MODEL_VALIDATION',
        mensajeError: error?.errors?.[0]?.message || 'Datos inválidos'
      });
    }

    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'Error al actualizar la localidad'
    });
  }
};

/* ==========================================
   PATCH /geo/localidades/:id/estado  → cambiar estado
   Body: { estado: 'activa' | 'inactiva' }
   ========================================== */
export const PR_Localidad_Estado_CTS = async (req, res) => {
  try {
    const id = req.params.id;
    const { estado } = req.body || {};
    if (!['activa', 'inactiva'].includes(estado)) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: "Estado inválido. Use 'activa' o 'inactiva'."
      });
    }
    const [updated] = await LocalidadesModel.update(
      { estado },
      { where: { id }, fields: ['estado'] }
    );
    if (updated !== 1) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Localidad no encontrada'
      });
    }
    const localidad = await LocalidadesModel.findByPk(id);
    return res.json({
      message: 'Estado actualizado',
      localidad
    });
  } catch (error) {
    console.error('PR_Localidad_Estado_CTS error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo actualizar el estado'
    });
  }
};

/* ==========================================
   DELETE /geo/localidades/:id  → eliminar
   - Si tiene barrios asociados, bloquea (HAS_DEPENDENCIES)
   - Tip: si querés “forzar”, hacé PATCH estado=inactiva desde el front.
   ========================================== */
export const ER_Localidad_CTS = async (req, res) => {
  try {
    const id = req.params.id;

    const localidad = await LocalidadesModel.findByPk(id);
    if (!localidad) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Localidad no encontrada'
      });
    }

    // Chequeo de dependencias: ¿tiene barrios?
    const deps = await BarriosModel.count({ where: { localidad_id: id } });
    if (deps > 0) {
      return res.status(409).json({
        code: 'HAS_DEPENDENCIES',
        mensajeError:
          'No se puede eliminar: la localidad tiene barrios asociados.',
        details: { barriosAsociados: deps },
        tips: [
          'Primero reasigná o eliminá los barrios',
          'Como alternativa, desactivá la localidad (PATCH /estado)'
        ]
      });
    }

    await LocalidadesModel.destroy({ where: { id } });
    return res.json({ message: 'Localidad eliminada correctamente' });
  } catch (error) {
    console.error('ER_Localidad_CTS error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo eliminar la localidad'
    });
  }
};
