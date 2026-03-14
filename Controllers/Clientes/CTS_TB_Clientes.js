// ===============================
// FILE: Controllers/Clientes/CTS_TB_Clientes.js
// ===============================
/*
 * Programador: Benjamin Orellana
 * Fecha: 12 / 11 / 2025
 * Versión: 1.1
 *
 * Descripción:
 * Controlador para Clientes (con vendedor_preferido_id):
 * - GET    /clientes                      (listar con filtros/paginación)
 * - GET    /clientes/:id                  (detalle con include geografía + vendedor)
 * - POST   /clientes                      (crear + validar vendedor_preferido_id)
 * - PUT    /clientes/:id                  (editar + validar vendedor_preferido_id)
 * - PATCH  /clientes/:id/estado           (activar/desactivar)
 * - DELETE /clientes/:id?hard=1           (baja lógica por defecto; hard=1 borra)
 *
 * Filtros en listado:
 * - q: busca en nombre, teléfono, email, documento
 * - estado: 'activo'|'inactivo'
 * - ciudad_id, localidad_id, barrio_id
 * - vendedor_id: filtra por vendedor_preferido_id
 * - created_desde=YYYY-MM-DD, created_hasta=YYYY-MM-DD
 * - orderBy: 'nombre'|'created_at'|'updated_at'|'id' (default: created_at)
 * - orderDir: 'ASC'|'DESC' (default: DESC)
 * - page, limit (máx 100)
 */

import { Op } from 'sequelize';
import db from '../../DataBase/db.js';

import ClientesModel from '../../Models/Clientes/MD_TB_Clientes.js';
import { BarriosModel } from '../../Models/Geografia/MD_TB_Barrios.js';
import { LocalidadesModel } from '../../Models/Geografia/MD_TB_Localidades.js';
import { CiudadesModel } from '../../Models/Geografia/MD_TB_Ciudades.js';
import { VendedoresModel } from '../../Models/Vendedores/MD_TB_Vendedores.js';

// Benjamin Orellana - 16-01-2026
// Asignación de reparto desde alta de cliente (reparto_clientes) con numero_rango automático.
import { RepartosModel } from '../../Models/Repartos/MD_TB_Repartos.js';
import { RepartoClientesModel } from '../../Models/Repartos/MD_TB_RepartoClientes.js';

// ---------- Includes: geografía + vendedor preferido + repartos ----------
const incFull = [
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
  },
  {
    model: VendedoresModel,
    as: 'vendedor_preferido',
    attributes: ['id', 'nombre', 'estado', 'email', 'telefono']
  },
  //  NUEVO: asignaciones de reparto
  {
    model: RepartoClientesModel,
    as: 'asignaciones_repartos',
    attributes: ['id', 'reparto_id', 'numero_rango', 'estado'],
    include: [
      {
        model: RepartosModel,
        as: 'reparto',
        attributes: ['id', 'nombre', 'rango_min', 'rango_max', 'ciudad_id']
      }
    ]
  }
];

// ---------- utilidades ----------
const parsePagination = (req) => {
  const page = Math.max(1, parseInt(req.query.page ?? '1', 10));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(req.query.limit ?? '20', 10))
  );
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

const safeOrder = (orderBy, orderDir) => {
  const allowed = new Set(['id', 'nombre', 'created_at', 'updated_at']);
  const col = allowed.has(String(orderBy)) ? orderBy : 'created_at';
  const dir = String(orderDir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  return [col, dir];
};

const normInt = (v, d = NaN) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const normOptInt = (v) =>
  v === undefined || v === null || String(v).trim() === '' ? null : normInt(v);

async function validarVendedorActivo(rawVendedorId, t) {
  // Normalizar
  if (
    rawVendedorId === '' ||
    rawVendedorId === undefined ||
    rawVendedorId === null
  ) {
    return null; // permitido null
  }

  const idNum = Number(rawVendedorId);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    return null; // cualquier cosa rara la ignoramos y lo dejamos null
  }

  const vend = await VendedoresModel.findByPk(idNum, { transaction: t });
  if (!vend) {
    const err = new Error('VENDEDOR_NO_ENCONTRADO');
    err.status = 404;
    throw err;
  }
  if (vend.estado !== 'activo') {
    const err = new Error('VENDEDOR_INACTIVO');
    err.status = 400;
    throw err;
  }
  return vend.id;
}

const toNull = (v) => (v === '' || v === undefined ? null : v);

const toNumOrNull = (v) => {
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const trimStr = (v) => (v == null ? '' : String(v)).trim();

// Benjamin Orellana - 16-01-2026 - Reparto debe existir, estar activo y pertenecer a la misma ciudad
async function validarRepartoActivoDeCiudad({
  reparto_id,
  ciudad_id,
  transaction
}) {
  const rep = await RepartosModel.findByPk(reparto_id, { transaction });
  if (!rep) {
    const e = new Error('REPARTO_NO_EXISTE');
    throw e;
  }
  if (String(rep.estado) !== 'activo') {
    const e = new Error('REPARTO_INACTIVO');
    throw e;
  }
  if (Number(rep.ciudad_id) !== Number(ciudad_id)) {
    const e = new Error('REPARTO_CIUDAD_MISMATCH');
    throw e;
  }
  return rep;
}

// Benjamin Orellana - 16-01-2026 - Calcula primer numero_rango libre dentro del rango del reparto (con huecos)
// Permite excluir un registro de reparto_clientes (por ejemplo al reactivar/editar el mismo).
async function obtenerNumeroRangoDisponible({
  reparto_id,
  transaction,
  excluirRepCliId = null
}) {
  const reparto = await RepartosModel.findByPk(reparto_id, { transaction });
  if (!reparto) {
    const e = new Error('REPARTO_NO_EXISTE');
    throw e;
  }
  if (String(reparto.estado) !== 'activo') {
    const e = new Error('REPARTO_INACTIVO');
    throw e;
  }

  const min = Number(reparto.rango_min);
  const max = Number(reparto.rango_max);

  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
    const e = new Error('REPARTO_RANGO_INVALIDO');
    throw e;
  }

  const whereUsed = { reparto_id, estado: 'activo' };
  if (excluirRepCliId) {
    whereUsed.id = { [Op.ne]: excluirRepCliId };
  }

  const usadosRows = await RepartoClientesModel.findAll({
    where: whereUsed,
    attributes: ['numero_rango'],
    order: [['numero_rango', 'ASC']],
    transaction,
    raw: true
  });

  let candidato = min;
  for (const row of usadosRows) {
    const n = Number(row.numero_rango);
    if (!Number.isFinite(n)) continue;
    if (n < candidato) continue;

    if (n === candidato) {
      candidato++;
      continue;
    }
    // n > candidato => hueco encontrado
    break;
  }

  const capacidad = max - min + 1;
  const usados = usadosRows.length;

  if (candidato > max) {
    return {
      ok: false,
      reparto,
      rango_min: min,
      rango_max: max,
      capacidad,
      usados,
      disponible: Math.max(0, capacidad - usados),
      sugerido_numero_rango: null
    };
  }

  return {
    ok: true,
    reparto,
    rango_min: min,
    rango_max: max,
    capacidad,
    usados,
    disponible: Math.max(0, capacidad - usados),
    sugerido_numero_rango: candidato
  };
}

// Benjamin Orellana - 16-01-2026 - Asigna (o reactiva) un cliente a un reparto con numero_rango automático
// - Deja inactiva cualquier asignación activa previa del cliente (a otros repartos).
// - Si ya existe registro reparto_id+cliente_id, lo actualiza.
// - Maneja concurrencia por uq_repcli_reparto_numero con reintentos.

// Benjamin Orellana - 13-03-2026 - Se corrige la asignación para respetar la unicidad real de reparto_clientes:
// el numero_rango no puede reutilizarse si ya existe en otra fila, aunque esté inactiva.
// Si el cliente ya tiene histórico en ese reparto, se reactiva esa misma fila.
// Para clientes nuevos en el reparto, el número libre se calcula considerando todas las filas del reparto.
async function asignarClienteAReparto({
  cliente_id,
  reparto_id,
  ciudad_id,
  transaction
}) {
  await validarRepartoActivoDeCiudad({ reparto_id, ciudad_id, transaction });

  // Si ya está activo en ese reparto, no reasignar cupo
  const yaActivo = await RepartoClientesModel.findOne({
    where: { cliente_id, reparto_id, estado: 'activo' },
    transaction
  });
  if (yaActivo) {
    return { ok: true, numero_rango: yaActivo.numero_rango };
  }

  // Benjamin Orellana - 13-03-2026 - Desactivar únicamente asignaciones activas del cliente en otros repartos.
  await RepartoClientesModel.update(
    { estado: 'inactivo' },
    {
      where: {
        cliente_id,
        estado: 'activo',
        reparto_id: { [Op.ne]: reparto_id }
      },
      transaction
    }
  );

  // Ver si ya existe registro histórico para este reparto+cliente
  const existente = await RepartoClientesModel.findOne({
    where: { reparto_id, cliente_id },
    transaction
  });

  // Benjamin Orellana - 13-03-2026 - Si ya existe fila histórica del cliente en el mismo reparto,
  // se reactiva esa misma fila. No se debe crear una nueva por uq_repcli_reparto_cliente.
  // Tampoco hace falta recalcular numero_rango, porque esa fila ya es dueña de su propio número.
  if (existente?.id) {
    await existente.update(
      {
        estado: 'activo'
      },
      { transaction }
    );

    return { ok: true, numero_rango: existente.numero_rango };
  }

  // Asignación automática con reintentos por concurrencia
  for (let intento = 1; intento <= 3; intento++) {
    const meta = await obtenerNumeroRangoDisponible({
      reparto_id,
      transaction,
      excluirRepCliId: null
    });

    // Benjamin Orellana - 13-03-2026 - Si no hay metadatos válidos de rango o no hay cupos,
    // se devuelve el error funcional sin intentar insertar.
    if (
      !meta?.ok ||
      meta?.rango_min == null ||
      meta?.rango_max == null
    ) {
      return {
        ok: false,
        code: 'REPARTO_SIN_CUPOS',
        meta: {
          reparto_id,
          reparto_nombre: meta?.reparto?.nombre || null,
          rango_min: meta?.rango_min ?? null,
          rango_max: meta?.rango_max ?? null,
          usados: meta?.usados ?? null,
          capacidad: meta?.capacidad ?? null,
          disponible: meta?.disponible ?? 0
        }
      };
    }

    // Benjamin Orellana - 13-03-2026 - Se recalcula el número disponible real
    // usando TODAS las filas del reparto, activas e inactivas, porque la UNIQUE
    // uq_repcli_reparto_numero bloquea reutilizar números ya existentes.
    const filasDelReparto = await RepartoClientesModel.findAll({
      where: {
        reparto_id,
        numero_rango: {
          [Op.between]: [meta.rango_min, meta.rango_max]
        }
      },
      attributes: ['id', 'numero_rango'],
      order: [['numero_rango', 'ASC']],
      transaction
    });

    const numerosUsados = new Set(
      filasDelReparto
        .map((row) => Number(row.numero_rango))
        .filter((n) => Number.isFinite(n))
    );

    let numeroDisponible = null;
    for (let n = Number(meta.rango_min); n <= Number(meta.rango_max); n += 1) {
      if (!numerosUsados.has(n)) {
        numeroDisponible = n;
        break;
      }
    }

    if (numeroDisponible == null) {
      return {
        ok: false,
        code: 'REPARTO_SIN_CUPOS',
        meta: {
          reparto_id,
          reparto_nombre: meta?.reparto?.nombre || null,
          rango_min: meta?.rango_min ?? null,
          rango_max: meta?.rango_max ?? null,
          usados: filasDelReparto.length,
          capacidad:
            meta?.capacidad ??
            Number(meta.rango_max) - Number(meta.rango_min) + 1,
          disponible: 0
        }
      };
    }

    try {
      await RepartoClientesModel.create(
        {
          reparto_id,
          cliente_id,
          numero_rango: numeroDisponible,
          estado: 'activo'
        },
        { transaction }
      );

      return { ok: true, numero_rango: numeroDisponible };
    } catch (errIns) {
      const isUnique =
        errIns?.name === 'SequelizeUniqueConstraintError' ||
        String(errIns?.original?.code || '').includes('ER_DUP_ENTRY');

      // Benjamin Orellana - 13-03-2026 - Si el conflicto es por concurrencia,
      // se reintenta recalculando el primer número realmente libre.
      if (!isUnique || intento === 3) throw errIns;
    }
  }

  return { ok: false, code: 'REPARTO_ASIGNACION_FALLIDA' };
}

async function desasignarRepartoActivo({ cliente_id, transaction }) {
  await RepartoClientesModel.update(
    { estado: 'inactivo' },
    { where: { cliente_id, estado: 'activo' }, transaction }
  );
}

// ===============================
// LIST - GET /clientes
// ===============================
export const OBRS_Clientes_CTS = async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req);
    const {
      q,
      estado, // 'activo' | 'inactivo'
      ciudad_id,
      localidad_id,
      barrio_id,
      vendedor_id, // ← nuevo filtro
      created_desde, // YYYY-MM-DD
      created_hasta, // YYYY-MM-DD
      orderBy = 'created_at',
      orderDir = 'DESC',

      // ======================================================
      // Benjamin Orellana - 17-01-2026
      // Nuevo filtro: reparto_id (para listar clientes asignados a un reparto)
      // ======================================================
      reparto_id
    } = req.query;

    const where = {};
    if (estado) where.estado = estado;
    if (barrio_id) where.barrio_id = Number(barrio_id);
    if (vendedor_id) where.vendedor_preferido_id = Number(vendedor_id);

    // Rango de creación (ojo con TZ si usás UTC)
    if (created_desde || created_hasta) {
      const desde = created_desde
        ? new Date(`${created_desde}T00:00:00`)
        : null;
      const hasta = created_hasta
        ? new Date(`${created_hasta}T23:59:59`)
        : null;
      if (desde && hasta) where.created_at = { [Op.between]: [desde, hasta] };
      else if (desde) where.created_at = { [Op.gte]: desde };
      else if (hasta) where.created_at = { [Op.lte]: hasta };
    }

    // ======================================================
    // Benjamin Orellana - 17-01-2026
    // include dinámico: si viene reparto_id, filtramos por tabla puente
    // NOTA: La relación existe como:
    // ClientesModel.hasMany(RepartoClientesModel, { as:'asignaciones_repartos', foreignKey:'cliente_id' })
    // ======================================================
    const includeFinal = [...incFull];

    if (reparto_id !== undefined && reparto_id !== null && reparto_id !== '') {
      const repId = Number(reparto_id);
      if (!Number.isInteger(repId) || repId <= 0) {
        return res.status(400).json({
          code: 'BAD_REQUEST',
          mensajeError: 'reparto_id debe ser numérico.'
        });
      }

      includeFinal.push({
        association: 'asignaciones_repartos',
        attributes: [], // no necesitamos columnas de la tabla puente en el listado
        required: true, // fuerza que solo vengan clientes asignados al reparto
        where: {
          reparto_id: repId,
          estado: 'activo'
        }
      });
    }

    // Filtros por include (ciudad/localidad) y q
    const and = [];
    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      and.push({
        [Op.or]: [
          { nombre: { [Op.like]: like } },
          { telefono: { [Op.like]: like } },
          { email: { [Op.like]: like } },
          { documento: { [Op.like]: like } }
        ]
      });
    }
    if (ciudad_id)
      and.push({ '$barrio.localidad.ciudad.id$': Number(ciudad_id) });
    if (localidad_id)
      and.push({ '$barrio.localidad.id$': Number(localidad_id) });

    const finalWhere = and.length ? { [Op.and]: [where, ...and] } : where;

    const [col, dir] = safeOrder(orderBy, orderDir);

    const { rows, count } = await ClientesModel.findAndCountAll({
      where: finalWhere,
      include: includeFinal,
      limit,
      offset,
      order: [[col, dir]],
      subQuery: false,
      distinct: true // evita sobreconteo por JOINs
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
    console.error('OBRS_Clientes_CTS error:', err);
    return res
      .status(500)
      .json({ code: 'SERVER_ERROR', mensajeError: 'Error listando clientes.' });
  }
};


// ===============================
// GET ONE - GET /clientes/:id
// ===============================
export const OBR_Cliente_CTS = async (req, res) => {
  try {
    const id = normInt(req.params.id);
    if (!Number.isFinite(id)) {
      return res
        .status(400)
        .json({ code: 'BAD_REQUEST', mensajeError: 'ID inválido.' });
    }

    const cli = await ClientesModel.findByPk(id, { include: incFull });
    if (!cli)
      return res
        .status(404)
        .json({ code: 'NOT_FOUND', mensajeError: 'Cliente no encontrado.' });

    return res.json(cli);
  } catch (err) {
    console.error('OBR_Cliente_CTS error:', err);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'Error obteniendo cliente.'
    });
  }
};

// Benjamin Orellana - 13-03-2026 - Helpers para identificar correctamente conflictos de unicidad y claves foráneas en alta de clientes, evitando mensajes engañosos y conservando la lógica existente.
const extractSequelizeConstraintMeta = (err = {}) => {
  const constraint =
    err?.parent?.constraint ||
    err?.original?.constraint ||
    err?.index ||
    null;

  const sqlMessage =
    err?.parent?.sqlMessage ||
    err?.original?.sqlMessage ||
    err?.message ||
    '';

  const table =
    err?.parent?.table ||
    err?.original?.table ||
    null;

  const errors = Array.isArray(err?.errors)
    ? err.errors.map((e) => ({
        path: e?.path || null,
        value: e?.value,
        message: e?.message || null
      }))
    : [];

  const fieldNames = errors.map((e) => e.path).filter(Boolean);

  return {
    constraint,
    sqlMessage,
    table,
    errors,
    fieldNames
  };
};

// Benjamin Orellana - 13-03-2026 - Se mejora la interpretación de errores UNIQUE para distinguir entre conflictos de documento, asignación de cliente a reparto y número ocupado dentro del reparto.
const buildClienteUniqueConflictResponse = (err = {}) => {
  const meta = extractSequelizeConstraintMeta(err);

  const constraintLower = String(meta.constraint || '').toLowerCase();
  const sqlLower = String(meta.sqlMessage || '').toLowerCase();
  const fieldsLower = (meta.fieldNames || []).map((f) =>
    String(f || '').toLowerCase()
  );

  const hay = (...tokens) =>
    tokens.some(
      (token) =>
        constraintLower.includes(token) ||
        sqlLower.includes(token) ||
        fieldsLower.some((f) => f.includes(token))
    );

  if (
    hay('uq_clientes_documento') ||
    hay("for key 'uq_clientes_documento'") ||
    fieldsLower.includes('documento')
  ) {
    return {
      status: 409,
      payload: {
        code: 'DUPLICATE_DOCUMENTO',
        mensajeError: 'Ya existe un cliente con ese documento.',
        tips: ['Verificá DNI/CUIT del cliente.']
      }
    };
  }

  if (
    hay('uq_repcli_reparto_numero') ||
    hay('reparto_clientes.uq_repcli_reparto_numero')
  ) {
    return {
      status: 409,
      payload: {
        code: 'REPARTO_NUMERO_DUPLICATE',
        mensajeError:
          'El reparto seleccionado intentó asignar un número de rango que ya está ocupado.',
        tips: [
          'Reintentá la operación.',
          'Revisá la lógica de asignación automática del reparto.',
          'Si el número inactivo debe poder reutilizarse, hay que ajustar el diseño de la tabla.'
        ],
        meta: {
          constraint: meta.constraint || 'uq_repcli_reparto_numero'
        }
      }
    };
  }

  if (
    hay('uq_repcli_reparto_cliente') ||
    hay('reparto_clientes.uq_repcli_reparto_cliente')
  ) {
    return {
      status: 409,
      payload: {
        code: 'REPARTO_CLIENTE_DUPLICATE',
        mensajeError:
          'El cliente ya tiene una asignación registrada en ese reparto.',
        tips: [
          'Revisá si ya existe una fila inactiva para ese cliente en ese reparto.',
          'En ese caso conviene reactivarla en lugar de insertar una nueva.'
        ],
        meta: {
          constraint: meta.constraint || 'uq_repcli_reparto_cliente'
        }
      }
    };
  }

  if (
    hay('email') &&
    (hay('unique') || hay('duplicate') || hay('duplic'))
  ) {
    return {
      status: 409,
      payload: {
        code: 'DUPLICATE_EMAIL',
        mensajeError: 'Ya existe un cliente con ese email.',
        tips: ['Verificá el correo ingresado o usá otro distinto.']
      }
    };
  }

  return {
    status: 409,
    payload: {
      code: 'UNIQUE_CONFLICT',
      mensajeError:
        'Se detectó un conflicto de unicidad en una tabla relacionada.',
      tips: [
        'Revisá los datos ingresados.',
        'Verificá el constraint informado por backend.'
      ],
      meta: {
        constraint: meta.constraint || null,
        fields: meta.fieldNames || []
      }
    }
  };
};
// Benjamin Orellana - 13-03-2026 - Traduce errores FK a mensajes más claros para alta de clientes.
const buildClienteForeignKeyConflictResponse = (err = {}) => {
  const meta = extractSequelizeConstraintMeta(err);

  const fingerprint = [
    meta.constraint,
    meta.table,
    meta.sqlMessage,
    ...meta.fieldNames
  ]
    .filter(Boolean)
    .join(' | ')
    .toLowerCase();

  if (
    fingerprint.includes('fk_clientes_ciudad') ||
    fingerprint.includes('idx_clientes_ciudad') ||
    fingerprint.includes('ciudad_id') ||
    fingerprint.includes('ciudad')
  ) {
    return {
      status: 400,
      payload: {
        code: 'FK_CONFLICT',
        mensajeError: 'La ciudad seleccionada no existe o no es válida.',
        tips: ['Seleccioná una ciudad válida.']
      }
    };
  }

  if (
    fingerprint.includes('fk_cliente_barrio') ||
    fingerprint.includes('idx_clientes_barrio') ||
    fingerprint.includes('barrio_id') ||
    fingerprint.includes('barrio')
  ) {
    return {
      status: 400,
      payload: {
        code: 'FK_CONFLICT',
        mensajeError: 'El barrio seleccionado no existe o no es válido.',
        tips: ['Seleccioná un barrio válido o dejalo vacío.']
      }
    };
  }

  if (
    fingerprint.includes('fk_cliente_vendedor_pref') ||
    fingerprint.includes('vendedor_preferido_id') ||
    fingerprint.includes('vendedor')
  ) {
    return {
      status: 400,
      payload: {
        code: 'FK_CONFLICT',
        mensajeError: 'El vendedor preferido seleccionado no existe o no es válido.',
        tips: ['Elegí un vendedor válido o quitá la asignación.']
      }
    };
  }

  return {
    status: 400,
    payload: {
      code: 'FK_CONFLICT',
      mensajeError:
        'Uno de los datos relacionados no existe o no es válido.',
      tips: ['Revisá ciudad, barrio y vendedor preferido.']
    }
  };
};

// ===============================
// CREATE - POST /clientes
// ===============================
export const CR_Cliente_CTS = async (req, res) => {
  const t = await db.transaction();
  try {
    const {
      nombre,
      telefono,
      email,
      documento,
      barrio_id,
      vendedor_preferido_id, // opcional
      estado, // 'activo' | 'inactivo'

      // Ciudad obligatoria por pedido de Sale - Benjamin Orellana - 16-01-2026
      ciudad_id,

      // Campos reales de dirección
      direccion_calle,
      direccion_numero,
      direccion_piso_dpto,
      referencia,

      // Asignación inicial desde el modal de clientes Benjamin Orellana - 16-01-2026
      reparto_id
    } = req.body || {};

    console.log('Payload recibido:', req.body);

    // Único obligatorio anterior: nombre
    if (!nombre || !String(nombre).trim()) {
      if (!t.finished) await t.rollback();
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'El nombre es obligatorio.'
      });
    }

    // Benjamin Orellana - 16-01-2026 - Nuevos obligatorios en ALTA
    const ciudadParsed = toNumOrNull(ciudad_id);
    if (ciudadParsed == null) {
      if (!t.finished) await t.rollback();
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'La ciudad es obligatoria.'
      });
    }

    // Benjamin Orellana - 24-02-2026 - El reparto pasa a ser obligatorio en alta de clientes por nuevo requerimiento funcional.
    const repartoParsed = toNumOrNull(reparto_id);
    if (repartoParsed == null) {
      if (!t.finished) await t.rollback();
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'El reparto es obligatorio.'
      });
    }

    // Benjamin Orellana - 24-02-2026 - Calle y número dejan de ser obligatorios; se normalizan y se persisten como NULL si llegan vacíos.
    const calleTrim = trimStr(direccion_calle);

    const numeroTrim = trimStr(direccion_numero);

    // Benjamin Orellana - 13-03-2026 - Normalización anticipada para reutilizar valores y mejorar validaciones previas.
    const nombreTrim = String(nombre).trim();
    const telefonoTrim = toNull(trimStr(telefono));
    const emailTrim = toNull(trimStr(email));
    const documentoTrim = toNull(trimStr(documento));
    const pisoDptoTrim = toNull(trimStr(direccion_piso_dpto));
    const referenciaTrim = toNull(trimStr(referencia));
    const estadoNormalizado = ['activo', 'inactivo'].includes(
      String(estado || '')
        .trim()
        .toLowerCase()
    )
      ? String(estado).trim().toLowerCase()
      : 'activo';

    // barrio_id opcional
    const barrioIdParsed = toNumOrNull(barrio_id);

    // Benjamin Orellana - 13-03-2026 - Validación previa amigable de documento duplicado; la restricción UNIQUE de MySQL sigue siendo la garantía final ante concurrencia.
    if (documentoTrim) {
      const yaExisteDocumento = await ClientesModel.findOne({
        where: { documento: documentoTrim },
        transaction: t
      });

      if (yaExisteDocumento) {
        if (!t.finished) await t.rollback();
        return res.status(409).json({
          code: 'DUPLICATE_DOCUMENTO',
          mensajeError: 'Ya existe un cliente con ese documento.',
          tips: ['Verificá DNI/CUIT del cliente.']
        });
      }
    }

    // Vendedor preferido opcional, si viene se valida activo
    const vendedorParsed = toNumOrNull(vendedor_preferido_id);
    let vendIdValidado = null;
    if (vendedorParsed != null) {
      vendIdValidado = await validarVendedorActivo(vendedorParsed, t);
    }

    const nuevo = await ClientesModel.create(
      {
        nombre: nombreTrim,
        telefono: telefonoTrim,
        email: emailTrim,
        documento: documentoTrim,

        // Benjamin Orellana - 16-01-2026 - Persistimos ciudad_id como dato principal
        ciudad_id: ciudadParsed,

        barrio_id: barrioIdParsed,
        vendedor_preferido_id: vendIdValidado,

        // obligatorios en alta
        // Benjamin Orellana - 24-02-2026 - Se actualiza regla de negocio: dirección detallada opcional en alta.
        direccion_calle: toNull(calleTrim),
        direccion_numero: toNull(numeroTrim),

        direccion_piso_dpto: pisoDptoTrim,
        referencia: referenciaTrim,

        estado: estadoNormalizado
      },
      { transaction: t }
    );

    // Benjamin Orellana - 16-01-2026 - Asignación inicial de reparto (opcional)
    // Benjamin Orellana - 24-02-2026 - La asignación inicial de reparto ahora es obligatoria por regla de negocio; si falla, se hace rollback de toda la alta.
    if (repartoParsed != null) {
      const r = await asignarClienteAReparto({
        cliente_id: nuevo.id,
        reparto_id: repartoParsed,
        ciudad_id: ciudadParsed,
        transaction: t
      });

      if (!r.ok) {
        if (!t.finished) await t.rollback();
        return res.status(409).json({
          code: r.code,
          mensajeError:
            'El reparto seleccionado no tiene números de rango disponibles dentro de su rango configurado.',
          meta: r.meta,
          tips: [
            'Seleccioná otro reparto.',
            'O ajustá el rango del reparto para ampliar capacidad.'
          ]
        });
      }
    }

    await t.commit();

    // Devolver enriquecido con include
    const withAll = await ClientesModel.findByPk(nuevo.id, {
      include: incFull
    });
    return res.status(201).json(withAll || nuevo);
  } catch (err) {
    try {
      if (!t.finished) await t.rollback();
    } catch {}

    // Reparto: errores específicos
    if (err?.message === 'REPARTO_NO_EXISTE') {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Reparto no encontrado.'
      });
    }
    if (err?.message === 'REPARTO_INACTIVO') {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'El reparto está inactivo.'
      });
    }
    if (err?.message === 'REPARTO_CIUDAD_MISMATCH') {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError:
          'El reparto seleccionado no pertenece a la ciudad elegida.'
      });
    }
    if (err?.message === 'REPARTO_RANGO_INVALIDO') {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'El reparto tiene un rango inválido configurado.'
      });
    }

    // Sequelize validations
    if (
      err?.name === 'SequelizeValidationError' ||
      err?.name === 'ValidationError'
    ) {
      const tips = (err.errors || []).map((e) => e.message);
      return res.status(400).json({
        code: 'MODEL_VALIDATION',
        mensajeError: 'Hay campos inválidos. Revisá los valores ingresados.',
        tips
      });
    }

    if (err?.message === 'VENDEDOR_NO_ENCONTRADO') {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Vendedor no encontrado.'
      });
    }
    if (err?.message === 'VENDEDOR_INACTIVO') {
      return res.status(400).json({
        code: 'VENDOR_INACTIVE',
        mensajeError: 'El vendedor está inactivo.'
      });
    }

    // Benjamin Orellana - 13-03-2026 - Manejo más preciso de FKs para evitar 500 por referencias inválidas.
    if (err?.name === 'SequelizeForeignKeyConstraintError') {
      const fkResp = buildClienteForeignKeyConflictResponse(err);
      return res.status(fkResp.status).json(fkResp.payload);
    }

    // Benjamin Orellana - 13-03-2026 - Se corrige el mensaje genérico inválido "documento/email"; ahora se responde según el constraint real que falló.
    if (err?.name === 'SequelizeUniqueConstraintError') {
      const meta = extractSequelizeConstraintMeta(err);

      console.error('CR_Cliente_CTS UNIQUE DEBUG:', {
        constraint: meta.constraint,
        table: meta.table,
        sqlMessage: meta.sqlMessage,
        fields: meta.fieldNames,
        errors: meta.errors
      });

      const constraintLower = String(meta.constraint || '').toLowerCase();
      const sqlLower = String(meta.sqlMessage || '').toLowerCase();
      const fieldsLower = (meta.fieldNames || []).map((f) =>
        String(f || '').toLowerCase()
      );

      const hay = (...tokens) =>
        tokens.some(
          (token) =>
            constraintLower.includes(token) ||
            sqlLower.includes(token) ||
            fieldsLower.some((f) => f.includes(token))
        );

      if (
        hay('uq_clientes_documento') ||
        hay("for key 'uq_clientes_documento'") ||
        fieldsLower.includes('documento')
      ) {
        return res.status(409).json({
          code: 'DUPLICATE_DOCUMENTO',
          mensajeError: 'Ya existe un cliente con ese documento.',
          tips: ['Verificá DNI/CUIT del cliente.']
        });
      }

      if (
        hay('uq_repcli_reparto_numero') ||
        hay('reparto_clientes.uq_repcli_reparto_numero')
      ) {
        return res.status(409).json({
          code: 'REPARTO_NUMERO_DUPLICATE',
          mensajeError:
            'El reparto seleccionado intentó asignar un número de rango que ya está ocupado.',
          tips: [
            'Reintentá la operación.',
            'Revisá la lógica de asignación automática del reparto.'
          ],
          meta: {
            constraint: meta.constraint || 'uq_repcli_reparto_numero'
          }
        });
      }

      if (
        hay('uq_repcli_reparto_cliente') ||
        hay('reparto_clientes.uq_repcli_reparto_cliente')
      ) {
        return res.status(409).json({
          code: 'REPARTO_CLIENTE_DUPLICATE',
          mensajeError:
            'El cliente ya tiene una asignación registrada en ese reparto.',
          tips: [
            'Revisá si ya existe una fila histórica para ese cliente en ese reparto.',
            'En ese caso conviene reactivarla en lugar de insertar una nueva.'
          ],
          meta: {
            constraint: meta.constraint || 'uq_repcli_reparto_cliente'
          }
        });
      }

      return res.status(409).json({
        code: 'UNIQUE_CONFLICT',
        mensajeError:
          'Se detectó un conflicto de unicidad en una tabla relacionada.',
        tips: [
          'Revisá los datos ingresados.',
          'Verificá el constraint informado por backend.'
        ],
        meta: {
          constraint: meta.constraint || null,
          fields: meta.fieldNames || []
        }
      });
    }

    console.error('CR_Cliente_CTS error:', err);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo crear el cliente.'
    });
  }
};
// ===============================
// UPDATE - PUT /clientes/:id
// ===============================
export const UR_Cliente_CTS = async (req, res) => {
  const t = await db.transaction();
  try {
    const id = normInt(req.params.id);
    if (!Number.isFinite(id)) {
      if (!t.finished) await t.rollback();
      return res
        .status(400)
        .json({ code: 'BAD_REQUEST', mensajeError: 'ID inválido.' });
    }

    const cli = await ClientesModel.findByPk(id, { transaction: t });
    if (!cli) {
      if (!t.finished) await t.rollback();
      return res
        .status(404)
        .json({ code: 'NOT_FOUND', mensajeError: 'Cliente no encontrado.' });
    }

    const trimStr = (v) =>
      v === null || v === undefined ? '' : String(v).trim();
    const toNull = (v) => (v === '' || v === undefined ? null : v);
    const toNumOrNull = (v) => {
      if (v === '' || v === undefined || v === null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const {
      nombre,
      telefono,
      email,
      documento,
      barrio_id,
      vendedor_preferido_id, // opcional, permite null para desasignar
      estado,

      // Ciudad (puede cambiarse)
      ciudad_id,

      // Dirección
      direccion_calle,
      direccion_numero,
      direccion_piso_dpto,
      referencia,

      // Asignación/edición de reparto desde el modal
      reparto_id
    } = req.body || {};

    const patch = {};

    // Campos básicos
    if (nombre !== undefined) {
      const n = trimStr(nombre);
      if (!n) {
        if (!t.finished) await t.rollback();
        return res.status(400).json({
          code: 'BAD_REQUEST',
          mensajeError: 'El nombre no puede quedar vacío.'
        });
      }
      patch.nombre = n;
    }

    if (telefono !== undefined) patch.telefono = toNull(trimStr(telefono));
    if (email !== undefined) patch.email = toNull(trimStr(email));
    if (documento !== undefined) patch.documento = toNull(trimStr(documento));

    // Ciudad: si viene, validar numérica
    let ciudadFinal =
      cli.ciudad_id === null || cli.ciudad_id === undefined
        ? null
        : Number(cli.ciudad_id);
    if (ciudad_id !== undefined) {
      const c = toNumOrNull(ciudad_id);
      if (c == null) {
        if (!t.finished) await t.rollback();
        return res.status(400).json({
          code: 'BAD_REQUEST',
          mensajeError: 'La ciudad debe ser un ID válido.'
        });
      }
      patch.ciudad_id = c;
      ciudadFinal = c;
    }

    // Benjamin Orellana - 24-02-2026 - Dirección en update: calle y número pasan a ser opcionales y pueden persistirse como NULL si se envían vacíos.
    if (direccion_calle !== undefined) {
      patch.direccion_calle = toNull(trimStr(direccion_calle));
    }
    if (direccion_numero !== undefined) {
      patch.direccion_numero = toNull(trimStr(direccion_numero));
    }

    if (direccion_piso_dpto !== undefined) {
      patch.direccion_piso_dpto = toNull(trimStr(direccion_piso_dpto));
    }
    if (referencia !== undefined) {
      patch.referencia = toNull(trimStr(referencia));
    }

    // Estado
    if (
      estado !== undefined &&
      ['activo', 'inactivo'].includes(String(estado))
    ) {
      patch.estado = estado;
    }

    // barrio_id opcional: vacío/null desasigna, número válido setea
    if (barrio_id !== undefined) {
      if (barrio_id === '' || barrio_id === null) {
        patch.barrio_id = null;
      } else {
        const bId = normInt(barrio_id);
        if (!Number.isFinite(bId)) {
          if (!t.finished) await t.rollback();
          return res.status(400).json({
            code: 'BAD_REQUEST',
            mensajeError: 'barrio_id debe ser numérico.'
          });
        }
        patch.barrio_id = bId;
      }
    }

    // Vendedor preferido: opcional, null desasigna, si viene valor se valida activo
    if (vendedor_preferido_id !== undefined) {
      const vendParsed = toNumOrNull(vendedor_preferido_id);
      if (vendParsed === null) {
        patch.vendedor_preferido_id = null;
      } else {
        const vendIdValidado = await validarVendedorActivo(vendParsed, t);
        patch.vendedor_preferido_id = vendIdValidado;
      }
    }

    // Persistir cambios del cliente
    await cli.update(patch, { transaction: t });

    // Benjamin Orellana - 24-02-2026 - Se consulta reparto activo actual para exigir que el cliente conserve/asigne un reparto activo en edición.
    const actualActivo = await RepartoClientesModel.findOne({
      where: { cliente_id: id, estado: 'activo' },
      transaction: t
    });

    // Benjamin Orellana - 24-02-2026 - Reparto pasa a ser obligatorio también en edición; si el cliente no tiene reparto activo y no se envía uno, se rechaza la actualización.
    if (reparto_id === undefined && !actualActivo) {
      if (!t.finished) await t.rollback();
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError:
          'El reparto es obligatorio. Seleccioná un reparto para este cliente.'
      });
    }

    if (reparto_id !== undefined) {
      const repParsed = toNumOrNull(reparto_id);

      // Benjamin Orellana - 24-02-2026 - Se bloquea la desasignación de reparto desde edición porque la regla de negocio exige reparto obligatorio.
      if (repParsed == null) {
        if (!t.finished) await t.rollback();
        return res.status(400).json({
          code: 'BAD_REQUEST',
          mensajeError: 'El reparto es obligatorio.'
        });
      }

      // Benjamin Orellana - 24-02-2026 - Validación explícita para asegurar ciudad disponible al asignar/cambiar reparto.
      if (ciudadFinal == null || !Number.isFinite(Number(ciudadFinal))) {
        if (!t.finished) await t.rollback();
        return res.status(400).json({
          code: 'BAD_REQUEST',
          mensajeError:
            'La ciudad es obligatoria para asignar o cambiar el reparto.'
        });
      }

      // Si es el mismo reparto ya activo, NO reasignar numero_rango
      if (actualActivo && Number(actualActivo.reparto_id) === Number(repParsed)) {
        // no-op
      } else {
        const r = await asignarClienteAReparto({
          cliente_id: id,
          reparto_id: repParsed,
          ciudad_id: ciudadFinal,
          transaction: t
        });

        if (!r.ok) {
          if (!t.finished) await t.rollback();
          return res.status(409).json({
            code: r.code,
            mensajeError:
              'El reparto seleccionado no tiene números de rango disponibles dentro de su rango configurado.',
            meta: r.meta,
            tips: [
              'Seleccioná otro reparto.',
              'O ajustá el rango del reparto.'
            ]
          });
        }
      }
    }
    await t.commit();

    const withAll = await ClientesModel.findByPk(id, { include: incFull });
    return res.json(withAll || cli);
  } catch (err) {
    try {
      if (!t.finished) await t.rollback();
    } catch {}

    // Reparto: errores específicos
    if (err?.message === 'REPARTO_NO_EXISTE') {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Reparto no encontrado.'
      });
    }
    if (err?.message === 'REPARTO_INACTIVO') {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'El reparto está inactivo.'
      });
    }
    if (err?.message === 'REPARTO_CIUDAD_MISMATCH') {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError:
          'El reparto seleccionado no pertenece a la ciudad elegida.'
      });
    }
    if (err?.message === 'REPARTO_RANGO_INVALIDO') {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'El reparto tiene un rango inválido configurado.'
      });
    }

    if (err?.message === 'VENDEDOR_NO_ENCONTRADO') {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Vendedor no encontrado.'
      });
    }
    if (err?.message === 'VENDEDOR_INACTIVO') {
      return res.status(400).json({
        code: 'VENDOR_INACTIVE',
        mensajeError: 'El vendedor está inactivo.'
      });
    }

    if (
      err?.name === 'SequelizeValidationError' ||
      err?.name === 'ValidationError'
    ) {
      const tips = (err.errors || []).map((e) => e.message);
      return res.status(400).json({
        code: 'MODEL_VALIDATION',
        mensajeError: 'Hay campos inválidos. Revisá los valores ingresados.',
        tips
      });
    }

    if (err?.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        code: 'DUPLICATE',
        mensajeError: 'Conflicto de unicidad (documento).'
      });
    }

    console.error('UR_Cliente_CTS error:', err);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo actualizar el cliente.'
    });
  }
};

// ===============================
// PATCH Estado - PATCH /clientes/:id/estado
// ===============================
export const UR_Cliente_Estado_CTS = async (req, res) => {
  try {
    const id = normInt(req.params.id);
    const { estado } = req.body || {};
    if (
      !Number.isFinite(id) ||
      !['activo', 'inactivo'].includes(String(estado))
    ) {
      return res
        .status(400)
        .json({ code: 'BAD_REQUEST', mensajeError: 'Parámetros inválidos.' });
    }
    const cli = await ClientesModel.findByPk(id);
    if (!cli)
      return res
        .status(404)
        .json({ code: 'NOT_FOUND', mensajeError: 'Cliente no encontrado.' });

    await cli.update({ estado });
    const withAll = await ClientesModel.findByPk(id, { include: incFull });
    return res.json(withAll || cli);
  } catch (err) {
    console.error('UR_Cliente_Estado_CTS error:', err);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo cambiar el estado.'
    });
  }
};

// ===============================
// DELETE - DELETE /clientes/:id?hard=1
// ===============================
export const ER_Cliente_CTS = async (req, res) => {
  const t = await db.transaction();
  try {
    const id = normInt(req.params.id);
    if (!Number.isFinite(id)) {
      if (!t.finished) await t.rollback();
      return res
        .status(400)
        .json({ code: 'BAD_REQUEST', mensajeError: 'ID inválido.' });
    }

    const cli = await ClientesModel.findByPk(id, { transaction: t });
    if (!cli) {
      if (!t.finished) await t.rollback();
      return res
        .status(404)
        .json({ code: 'NOT_FOUND', mensajeError: 'Cliente no encontrado.' });
    }

    const hard = String(req.query.hard || '') === '1';

    if (hard) {
      //  Intento de borrado físico
      await cli.destroy({ transaction: t });
    } else {
      //  Baja lógica (estado = inactivo)
      await cli.update({ estado: 'inactivo' }, { transaction: t });
    }

    await t.commit();
    return res.json({ ok: true, hardDeleted: hard });
  } catch (err) {
    try {
      if (!t.finished) await t.rollback();
    } catch {}

    console.error('ER_Cliente_CTS error:', err);

    const sqlMsg =
      err?.original?.sqlMessage ||
      err?.parent?.sqlMessage ||
      err?.message ||
      '';

    //  Caso específico: FK en reparto_clientes
    if (
      err?.name === 'SequelizeForeignKeyConstraintError' &&
      (sqlMsg.includes('`reparto_clientes`') ||
        sqlMsg.includes('fk_repcli_cliente'))
    ) {
      return res.status(409).json({
        code: 'CLIENTE_TIENE_REPARTOS',
        mensajeError:
          'No se puede eliminar el cliente porque está asociado a uno o más repartos.',
        tips: [
          'Quitá primero al cliente de todos los repartos donde esté asignado.',
          'También podés usar baja lógica (estado = inactivo) en lugar de borrado físico.'
        ]
      });
    }

    //  Otros errores de FK (ventas, pedidos, etc.)
    if (err?.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(409).json({
        code: 'CLIENTE_TIENE_RELACIONES',
        mensajeError:
          'No se puede eliminar el cliente porque tiene registros relacionados (repartos, ventas u otros módulos).',
        tips: [
          'Revisá si el cliente participa en repartos, ventas o movimientos.',
          'Usá baja lógica (estado = inactivo) si no querés perder el historial.'
        ]
      });
    }

    //  Fallback genérico
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo eliminar el cliente.'
    });
  }
};
