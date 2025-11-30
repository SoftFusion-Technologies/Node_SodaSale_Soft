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

// nuevas relaciones con repartos
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
      orderDir = 'DESC'
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
      include: incFull,
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

      // Campos reales de dirección
      direccion_calle,
      direccion_numero,
      direccion_piso_dpto,
      referencia
    } = req.body || {};

    // Helpers locales
    const toNull = (v) => (v === '' || v === undefined ? null : v);
    const toNumOrNull = (v) => {
      if (v === '' || v === undefined || v === null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    // Único obligatorio: nombre
    if (!nombre || !String(nombre).trim()) {
      if (!t.finished) await t.rollback();
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'El nombre es obligatorio.'
      });
    }

    // barrio_id ahora es OPCIONAL
    const barrioIdParsed = toNumOrNull(barrio_id);

    //  Vendedor preferido: opcional, pero si viene lo validamos activo
    const vendedorParsed = toNumOrNull(vendedor_preferido_id);
    let vendIdValidado = null;
    if (vendedorParsed != null) {
      // reutilizás tu helper de validación; si no existe o está inactivo, tira error
      vendIdValidado = await validarVendedorActivo(vendedorParsed, t);
    }

    const nuevo = await ClientesModel.create(
      {
        nombre: String(nombre).trim(),
        telefono: toNull(telefono?.trim?.() ?? telefono),
        email: toNull(email?.trim?.() ?? email),
        documento: toNull(documento?.trim?.() ?? documento),

        //  ahora puede ser NULL sin romper el DDL
        barrio_id: barrioIdParsed,

        vendedor_preferido_id: vendIdValidado,

        direccion_calle: toNull(direccion_calle?.trim?.() ?? direccion_calle),
        direccion_numero: toNull(
          direccion_numero?.trim?.() ?? direccion_numero
        ),
        direccion_piso_dpto: toNull(
          direccion_piso_dpto?.trim?.() ?? direccion_piso_dpto
        ),
        referencia: toNull(referencia?.trim?.() ?? referencia),

        estado: ['activo', 'inactivo'].includes(String(estado))
          ? estado
          : 'activo'
      },
      { transaction: t }
    );

    await t.commit();

    // Devolver enriquecido con include (barrio/localidad/ciudad si los hubiera)
    const withAll = await ClientesModel.findByPk(nuevo.id, {
      include: incFull
    });
    return res.status(201).json(withAll || nuevo);
  } catch (err) {
    try {
      if (!t.finished) await t.rollback();
    } catch {}

    //  Captura validaciones de Sequelize y envía 400 con tips
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

    if (err?.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        code: 'DUPLICATE',
        mensajeError: 'Conflicto de unicidad (verificá documento/email).'
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

    const {
      nombre,
      telefono,
      email,
      documento,
      barrio_id,
      vendedor_preferido_id, // opcional, permite null para desasignar
      direccion_calle,
      direccion_numero,
      direccion_piso_dpto,
      referencia,
      estado
    } = req.body || {};

    const toNull = (v) => (v === '' || v === undefined ? null : v);
    const toNumOrNull = (v) => {
      if (v === '' || v === undefined || v === null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const patch = {};

    // Campos básicos
    if (nombre !== undefined) patch.nombre = String(nombre).trim();
    if (telefono !== undefined) {
      patch.telefono = toNull(telefono?.trim?.() ?? telefono);
    }
    if (email !== undefined) {
      patch.email = toNull(email?.trim?.() ?? email);
    }
    if (documento !== undefined) {
      patch.documento = toNull(documento?.trim?.() ?? documento);
    }

    // Dirección desglosada
    if (direccion_calle !== undefined) {
      patch.direccion_calle = toNull(
        direccion_calle?.trim?.() ?? direccion_calle
      );
    }
    if (direccion_numero !== undefined) {
      patch.direccion_numero = toNull(
        direccion_numero?.trim?.() ?? direccion_numero
      );
    }
    if (direccion_piso_dpto !== undefined) {
      patch.direccion_piso_dpto = toNull(
        direccion_piso_dpto?.trim?.() ?? direccion_piso_dpto
      );
    }
    if (referencia !== undefined) {
      patch.referencia = toNull(referencia?.trim?.() ?? referencia);
    }

    // Estado
    if (
      estado !== undefined &&
      ['activo', 'inactivo'].includes(String(estado))
    ) {
      patch.estado = estado;
    }

    // 📍 barrio_id ahora es OPCIONAL: vacío/null desasigna, número válido setea
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
        // si querés volver a validar existencia de barrio, acá va el findByPk
        // const barr = await BarriosModel.findByPk(bId, { transaction: t });
        // if (!barr) { ... 404 ... }
        patch.barrio_id = bId;
      }
    }

    // 👤 Vendedor preferido: opcional, null desasigna, si viene valor se valida activo
    if (vendedor_preferido_id !== undefined) {
      const vendParsed = toNumOrNull(vendedor_preferido_id);
      if (vendParsed === null) {
        // desasignar
        patch.vendedor_preferido_id = null;
      } else {
        const vendIdValidado = await validarVendedorActivo(vendParsed, t);
        patch.vendedor_preferido_id = vendIdValidado;
      }
    }

    await cli.update(patch, { transaction: t });
    await t.commit();

    const withAll = await ClientesModel.findByPk(id, { include: incFull });
    return res.json(withAll || cli);
  } catch (err) {
    try {
      if (!t.finished) await t.rollback();
    } catch {}

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
