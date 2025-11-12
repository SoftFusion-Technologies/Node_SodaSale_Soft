// ===============================
// FILE: Controllers/Vendedores/CTS_TB_VendedorBarrios.js
// ===============================
/*
 * Programador: Benjamin Orellana
 * Fecha: 11 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 * Controlador para histórico de asignaciones Vendedor ↔ Barrio.
 * - GET /vendedor_barrios (global, filtros)
 * - GET /vendedores/:id/barrios (por vendedor, filtros)
 * - POST /vendedores/:id/barrios (alta, con auto-cierre opcional)
 * - PATCH /vendedores/:id/barrios/:asigId/cerrar (cierra asignación)
 * - PATCH /vendedores/:id/barrios/:asigId/estado (activa/inactiva)
 * - DELETE /vendedores/:id/barrios/:asigId (borra; bloquea si vigente salvo hard=1)
 *
 * Flags/convenciones:
 * - autoClose=1 (query/body): al crear, cierra la vigente del barrio (si existe) antes de crear la nueva
 * - vigente = asignado_hasta IS NULL
 * - Únicos de BD protegen: un solo vigente por barrio y por par vendedor-barrio
 */

import { Op, Sequelize } from 'sequelize';
import db from '../../DataBase/db.js';

import VendedoresModel from '../../Models/Vendedores/MD_TB_Vendedores.js';
import VendedorBarrioModel from '../../Models/Vendedores/MD_TB_VendedorBarrios.js';

import { BarriosModel } from '../../Models/Geografia/MD_TB_Barrios.js';
import { LocalidadesModel } from '../../Models/Geografia/MD_TB_Localidades.js';
import { CiudadesModel } from '../../Models/Geografia/MD_TB_Ciudades.js';

// ---------- includes de geografía (para joins lindos)
const incGeo = () => [
  {
    model: BarriosModel,
    as: 'barrio',
    attributes: ['id', 'nombre', 'estado', 'localidad_id'],
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
  }
];

// ---------- helpers ----------
const normInt = (v, d = NaN) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const parseDateTime = (v, fallback = null) => {
  if (!v) return fallback;
  const d = new Date(v);
  return isNaN(d.getTime()) ? fallback : d;
};

const metaFrom = (total, page, limit) => {
  const totalPages =
    total != null ? Math.max(1, Math.ceil(total / limit)) : null;
  return {
    total,
    page,
    limit,
    totalPages,
    hasPrev: page > 1,
    hasNext: totalPages ? page < totalPages : false
  };
};

const buildIncludes = () => [
  {
    model: VendedoresModel,
    as: 'vendedor',
    attributes: ['id', 'nombre', 'estado']
  },
  {
    model: BarriosModel,
    as: 'barrio',
    attributes: ['id', 'nombre', 'localidad_id'],
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
  }
];

const parsePagination = (req) => {
  const page = Math.max(1, parseInt(req.query.page ?? '1', 10));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(req.query.limit ?? '20', 10))
  );
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

// GET /vendedor_barrios
export const OBRS_VB_CTS = async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req);
    const {
      q,
      vendedor_id,
      ciudad_id,
      localidad_id,
      barrio_id,
      estado, // 'activo' | 'inactivo'
      vigentes, // 1 = solo asignado_hasta NULL, 0 = solo cerradas
      orderBy = 'asignado_desde',
      orderDir = 'DESC'
    } = req.query;

    const where = {};
    if (estado) where.estado = estado;
    if (vigentes === '1' || vigentes === 1)
      where.asignado_hasta = { [Op.is]: null };
    if (vigentes === '0' || vigentes === 0)
      where.asignado_hasta = { [Op.not]: null };
    if (barrio_id) where.barrio_id = Number(barrio_id);
    if (vendedor_id) where.vendedor_id = Number(vendedor_id);

    const include = buildIncludes();

    // Filtros por atributos de los includes
    const and = [];
    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      and.push({
        [Op.or]: [
          { '$vendedor.nombre$': { [Op.like]: like } },
          { '$barrio.nombre$': { [Op.like]: like } }
        ]
      });
    }
    if (ciudad_id)
      and.push({ '$barrio.localidad.ciudad.id$': Number(ciudad_id) });
    if (localidad_id)
      and.push({ '$barrio.localidad.id$': Number(localidad_id) });

    const finalWhere = and.length ? { [Op.and]: [where, ...and] } : where;

    const order = [
      [orderBy, orderDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC']
    ];

    const { rows, count } = await VendedorBarrioModel.findAndCountAll({
      where: finalWhere,
      include,
      attributes: { exclude: [] }, // si querés ocultar vigente_flag: exclude: ['vigente_flag']
      limit,
      offset,
      order,
      subQuery: false // necesario para filtrar/ordenar por campos incluidos ($...$)
    });

    return res.json({
      data: rows,
      meta: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
        hasPrev: page > 1,
        hasNext: offset + rows.length < count
      }
    });
  } catch (err) {
    console.error('OBRS_VB_CTS error', err);
    return res.status(500).json({ error: 'Error listando asignaciones' });
  }
};

// GET /vendedores/:id/barrios
export const OBRS_VB_PorVendedor_CTS = async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req);
    const { id } = req.params;
    const {
      vigentes,
      estado,
      orderBy = 'asignado_desde',
      orderDir = 'DESC'
    } = req.query;

    const where = { vendedor_id: Number(id) };
    if (estado) where.estado = estado;
    if (vigentes === '1' || vigentes === 1)
      where.asignado_hasta = { [Op.is]: null };
    if (vigentes === '0' || vigentes === 0)
      where.asignado_hasta = { [Op.not]: null };

    const { rows, count } = await VendedorBarrioModel.findAndCountAll({
      where,
      include: buildIncludes(),
      limit,
      offset,
      order: [[orderBy, orderDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC']],
      subQuery: false
    });

    return res.json({
      data: rows,
      meta: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
        hasPrev: page > 1,
        hasNext: offset + rows.length < count
      }
    });
  } catch (err) {
    console.error('OBRS_VB_PorVendedor_CTS error', err);
    return res
      .status(500)
      .json({ error: 'Error listando asignaciones por vendedor' });
  }
};

// =====================================================
// CREATE (POST /vendedores/:id/barrios)
// body: { barrio_id, asignado_desde?, asignado_hasta?, estado? }
// - Valida vendedor/barrio
// - Permite múltiples vendedores vigentes en el mismo barrio
// - Impide duplicar vigencia para el mismo par (vendedor,barrio)
// =====================================================
function parseDateFlexible(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v)) return v;
  if (typeof v === 'string') {
    const s = v.trim();

    // DD-MM-YYYY [HH:mm[:ss]]
    const m1 = s.match(
      /^(\d{2})[-\/](\d{2})[-\/](\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/
    );
    if (m1) {
      const [, dd, mm, yyyy, HH = '00', MM = '00', SS = '00'] = m1;
      const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd, +HH, +MM, +SS));
      return isNaN(d) ? null : d;
    }

    // ISO u otros formatos nativos válidos
    const d2 = new Date(s);
    return isNaN(d2) ? null : d2;
  }
  return null;
}

export const CR_VB_Asigna_CTS = async (req, res) => {
  const t = await db.transaction();
  try {
    const vendedor_id = Number(req.params.id);
    if (!Number.isFinite(vendedor_id)) {
      if (!t.finished) await t.rollback();
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'ID de vendedor inválido.'
      });
    }

    const { barrio_id, asignado_desde, asignado_hasta, estado } =
      req.body || {};
    const bId = Number(barrio_id);
    if (!Number.isFinite(bId)) {
      if (!t.finished) await t.rollback();
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'barrio_id es obligatorio y debe ser numérico.'
      });
    }

    const [vend, barr] = await Promise.all([
      VendedoresModel.findByPk(vendedor_id, { transaction: t }),
      BarriosModel.findByPk(bId, { transaction: t })
    ]);
    if (!vend) {
      if (!t.finished) await t.rollback();
      return res
        .status(404)
        .json({ code: 'NOT_FOUND', mensajeError: 'Vendedor no encontrado.' });
    }
    if (!barr) {
      if (!t.finished) await t.rollback();
      return res
        .status(404)
        .json({ code: 'NOT_FOUND', mensajeError: 'Barrio no encontrado.' });
    }

    // No duplicar vigencia para el MISMO par (vendedor, barrio)
    const yaVigenteMismoPar = await VendedorBarrioModel.count({
      where: { vendedor_id, barrio_id: bId, asignado_hasta: { [Op.is]: null } },
      transaction: t,
      lock: t.LOCK.UPDATE
    });
    if (yaVigenteMismoPar > 0) {
      if (!t.finished) await t.rollback();
      return res.status(409).json({
        code: 'DUPLICATE',
        mensajeError:
          'Ese vendedor ya tiene una asignación vigente para este barrio.',
        tips: [
          'Cerrá la vigente actual del par o usá una fecha de inicio posterior.'
        ]
      });
    }

    const ahora = new Date();
    const desde = parseDateFlexible(asignado_desde) || ahora;

    // Si envían hasta FUTURO => guardamos NULL para que quede vigente (regla del DDL)
    let hasta = parseDateFlexible(asignado_hasta);
    if (hasta && hasta > ahora) {
      hasta = null;
    }

    const nuevo = await VendedorBarrioModel.create(
      {
        vendedor_id,
        barrio_id: bId,
        asignado_desde: desde,
        asignado_hasta: hasta, // null si era futuro → queda vigente
        estado: ['activo', 'inactivo'].includes(String(estado))
          ? estado
          : 'activo'
      },
      { transaction: t }
    );

    await t.commit();

    // Post-commit: enrich sin romper respuesta
    try {
      const withGeo = await VendedorBarrioModel.findByPk(nuevo.id, {
        include: incGeo()
      });
      // opcional: exponer 'vigente' semántico (NULL o > ahora)
      const json = withGeo?.toJSON ? withGeo.toJSON() : withGeo;
      json.vigente =
        !json.asignado_hasta || new Date(json.asignado_hasta) > new Date();
      return res.status(201).json(json || nuevo);
    } catch (e) {
      const json = nuevo?.toJSON ? nuevo.toJSON() : nuevo;
      json.vigente =
        !json.asignado_hasta || new Date(json.asignado_hasta) > new Date();
      return res.status(201).json(json);
    }
  } catch (error) {
    try {
      if (!t.finished) await t.rollback();
    } catch {}
    if (error?.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        code: 'DUPLICATE',
        mensajeError:
          'Ya existe una asignación vigente para este par vendedor-barrio.',
        tips: ['Cerrá la vigente actual del par antes de crear otra.']
      });
    }
    console.error('CR_VB_Asigna_CTS error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo crear la asignación.'
    });
  }
};

const normIdList = (arr) =>
  Array.from(
    new Set(
      (Array.isArray(arr) ? arr : [])
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  );

export const CR_VB_BulkAsignar_CTS = async (req, res) => {
  const t = await db.transaction();
  try {
    const {
      vendedor_ids,
      barrio_ids,
      barrio_id,
      asignado_desde,
      asignado_hasta,
      estado
    } = req.body || {};

    const vendIds = normIdList(vendedor_ids);
    const barrIds = normIdList(barrio_ids || (barrio_id ? [barrio_id] : []));

    if (vendIds.length === 0 || barrIds.length === 0) {
      if (!t.finished) await t.rollback();
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError:
          'Debés enviar al menos un vendedor en vendedor_ids y al menos un barrio en barrio_ids/barrio_id.'
      });
    }

    // Validar existencia
    const [vends, barrs] = await Promise.all([
      VendedoresModel.findAll({
        where: { id: { [Op.in]: vendIds } },
        transaction: t
      }),
      BarriosModel.findAll({
        where: { id: { [Op.in]: barrIds } },
        transaction: t
      })
    ]);

    const validVend = new Set(vends.map((v) => v.id));
    const validBarr = new Set(barrs.map((b) => b.id));

    const invalidVendorIds = vendIds.filter((id) => !validVend.has(id));
    const invalidBarrioIds = barrIds.filter((id) => !validBarr.has(id));
    if (invalidBarrioIds.length > 0) {
      if (!t.finished) await t.rollback();
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Hay barrios inexistentes en la solicitud.',
        details: { invalidBarrioIds }
      });
    }
    // Si hay vendedores inválidos, seguimos pero los reportamos
    // (útil cuando marcaste 10 y uno fue eliminado mientras tanto)

    // Reglas de fecha (mismo criterio que el CREATE simple)
    const ahora = new Date();
    const desde = parseDateFlexible(asignado_desde) || ahora;
    const hastaParsed = parseDateFlexible(asignado_hasta);
    const hasta = hastaParsed && hastaParsed <= ahora ? hastaParsed : null;
    const estadoFinal = ['activo', 'inactivo'].includes(String(estado))
      ? estado
      : 'activo';

    // Pre-carga: qué pares ya tienen vigente para evitar colisión
    const existing = await VendedorBarrioModel.findAll({
      where: {
        vendedor_id: { [Op.in]: vendIds },
        barrio_id: { [Op.in]: barrIds },
        asignado_hasta: { [Op.is]: null }
      },
      transaction: t
    });
    const existingSet = new Set(
      existing.map((r) => `${r.vendedor_id}:${r.barrio_id}`)
    );

    const pairs = [];
    for (const vid of vendIds) {
      if (!validVend.has(vid)) continue;
      for (const bid of barrIds) {
        if (!validBarr.has(bid)) continue;
        pairs.push({ vid, bid });
      }
    }

    const insertedIds = [];
    const skipped = []; // {vendedor_id,barrio_id,reason}

    // Inserciones una por una para tolerar conflictos sin abortar todo
    for (const { vid, bid } of pairs) {
      const key = `${vid}:${bid}`;
      if (existingSet.has(key)) {
        skipped.push({
          vendedor_id: vid,
          barrio_id: bid,
          reason: 'ALREADY_VIGENTE'
        });
        continue;
      }
      try {
        const row = await VendedorBarrioModel.create(
          {
            vendedor_id: vid,
            barrio_id: bid,
            asignado_desde: desde,
            asignado_hasta: hasta,
            estado: estadoFinal
          },
          { transaction: t }
        );
        insertedIds.push(row.id);
      } catch (e) {
        // Si por carrera de concurrencia saltó unique, lo marcamos como skip
        if (e?.name === 'SequelizeUniqueConstraintError') {
          skipped.push({
            vendedor_id: vid,
            barrio_id: bid,
            reason: 'ALREADY_VIGENTE_DB'
          });
          continue;
        }
        // Otro error duro: abortar todo
        throw e;
      }
    }

    await t.commit();

    // Enriquecer fuera de la tx
    const inserted = insertedIds.length
      ? await VendedorBarrioModel.findAll({
          where: { id: { [Op.in]: insertedIds } },
          include: incGeo()
        })
      : [];

    return res.status(201).json({
      summary: {
        requested: pairs.length,
        inserted: inserted.length,
        skipped: skipped.length,
        invalidVendorIds
      },
      inserted,
      skipped
    });
  } catch (error) {
    try {
      if (!t.finished) await t.rollback();
    } catch {}
    console.error('CR_VB_BulkAsignar_CTS error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudieron crear asignaciones masivas.'
    });
  }
};

// =====================================================
// CERRAR ASIGNACIÓN (PATCH /vendedores/:id/barrios/:asigId/cerrar)
// body: { hasta }  (si no viene, usa now)
// Reglas: hasta >= asignado_desde
// =====================================================
export const UR_VB_Cerrar_CTS = async (req, res) => {
  try {
    const vendedor_id = normInt(req.params.id, NaN);
    const asigId = normInt(req.params.asigId, NaN);
    if (!Number.isFinite(vendedor_id) || !Number.isFinite(asigId)) {
      return res
        .status(400)
        .json({ code: 'BAD_REQUEST', mensajeError: 'Parámetros inválidos.' });
    }

    const asig = await VendedorBarrioModel.findOne({
      where: { id: asigId, vendedor_id }
    });
    if (!asig) {
      return res
        .status(404)
        .json({ code: 'NOT_FOUND', mensajeError: 'Asignación no encontrada.' });
    }

    const hasta = parseDateTime(req.body?.hasta) || new Date();
    if (asig.asignado_desde && hasta < asig.asignado_desde) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'La fecha de cierre no puede ser anterior al inicio.'
      });
    }

    await asig.update({ asignado_hasta: hasta });
    return res.json({ message: 'Asignación cerrada', asignacion: asig });
  } catch (error) {
    console.error('UR_VB_Cerrar_CTS error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo cerrar la asignación.'
    });
  }
};

// =====================================================
// PATCH ESTADO (PATCH /vendedores/:id/barrios/:asigId/estado)
// body: { estado: 'activo'|'inactivo' }
// =====================================================
export const UR_VB_Estado_CTS = async (req, res) => {
  try {
    const vendedor_id = normInt(req.params.id, NaN);
    const asigId = normInt(req.params.asigId, NaN);
    if (!Number.isFinite(vendedor_id) || !Number.isFinite(asigId)) {
      return res
        .status(400)
        .json({ code: 'BAD_REQUEST', mensajeError: 'Parámetros inválidos.' });
    }

    const { estado } = req.body || {};
    if (!['activo', 'inactivo'].includes(String(estado))) {
      return res
        .status(400)
        .json({ code: 'BAD_REQUEST', mensajeError: 'Estado inválido.' });
    }

    const asig = await VendedorBarrioModel.findOne({
      where: { id: asigId, vendedor_id }
    });
    if (!asig) {
      return res
        .status(404)
        .json({ code: 'NOT_FOUND', mensajeError: 'Asignación no encontrada.' });
    }

    await asig.update({ estado });
    return res.json({ message: 'Estado actualizado', asignacion: asig });
  } catch (error) {
    console.error('UR_VB_Estado_CTS error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo actualizar el estado.'
    });
  }
};

// =====================================================
// DELETE (DELETE /vendedores/:id/barrios/:asigId?hard=1)
// - Si está vigente: bloquea salvo hard=1 (o recomendá cerrar primero)
// =====================================================
export const ER_VB_CTS = async (req, res) => {
  try {
    const vendedor_id = normInt(req.params.id, NaN);
    const asigId = normInt(req.params.asigId, NaN);
    if (!Number.isFinite(vendedor_id) || !Number.isFinite(asigId)) {
      return res
        .status(400)
        .json({ code: 'BAD_REQUEST', mensajeError: 'Parámetros inválidos.' });
    }

    const hard = ['1', 'true', 'si', 'sí'].includes(
      String(req.query.hard || '').toLowerCase()
    );

    const asig = await VendedorBarrioModel.findOne({
      where: { id: asigId, vendedor_id }
    });
    if (!asig) {
      return res
        .status(404)
        .json({ code: 'NOT_FOUND', mensajeError: 'Asignación no encontrada.' });
    }

    const esVigente = asig.asignado_hasta === null;
    if (esVigente && !hard) {
      return res.status(409).json({
        code: 'HAS_DEPENDENCIES',
        mensajeError:
          'No se puede eliminar una asignación vigente. Cerrala primero.',
        tips: ['Presiona el botón de color Amarillo que dice CERRAR']
      });
    }

    const deleted = await VendedorBarrioModel.destroy({
      where: { id: asigId, vendedor_id },
      limit: 1
    });
    if (deleted === 0) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'No se pudo eliminar (ya no existe).'
      });
    }
    return res.status(204).send();
  } catch (error) {
    console.error('ER_VB_CTS error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo eliminar la asignación.'
    });
  }
};

export default {
  OBRS_VB_CTS,
  OBRS_VB_PorVendedor_CTS,
  CR_VB_Asigna_CTS,
  CR_VB_BulkAsignar_CTS,
  UR_VB_Cerrar_CTS,
  UR_VB_Estado_CTS,
  ER_VB_CTS
};
