// ===============================
// FILE: Controllers/Ventas/CTS_TB_Ventas.js
// ===============================
/*
 * Programador: Benjamin Orellana
 * Fecha: 12 / 11 / 2025
 * Versión: 1.1
 *
 * Descripción:
 * Controlador para Ventas (cabecera + detalle):
 * - GET    /ventas                      (listar con filtros/paginación)
 * - GET    /ventas/:id                  (detalle con items + include cliente/vendedor)
 * - POST   /ventas                      (crear venta; opcionalmente aceptar items[] y calcular total_neto)
 * - PUT    /ventas/:id                  (editar cabecera)
 * - PATCH  /ventas/:id/anular           (cambiar estado a 'anulada')
 * - DELETE /ventas/:id?hard=1           (borrado duro—preferir anulación)
 *
 * Filtros en listado:
 * - q: busca por cliente (nombre, documento, email)
 * - cliente_id, vendedor_id
 * - tipo: 'contado'|'fiado'|'a_cuenta'
 * - estado: 'confirmada'|'anulada'
 * - desde=YYYY-MM-DD, hasta=YYYY-MM-DD  (por fecha de la venta)
 * - orderBy: 'fecha'|'total_neto'|'created_at'|'id'  (default: fecha DESC)
 * - orderDir: 'ASC'|'DESC'
 */

import { Op } from 'sequelize';
import db from '../../DataBase/db.js';

import VentasModel from '../../Models/Ventas/MD_TB_Ventas.js';
import VentasDetalleModel from '../../Models/Ventas/MD_TB_VentasDetalle.js';

import ClientesModel from '../../Models/Clientes/MD_TB_Clientes.js';
import { VendedoresModel } from '../../Models/Vendedores/MD_TB_Vendedores.js';

import { BarriosModel } from '../../Models/Geografia/MD_TB_Barrios.js';
import { LocalidadesModel } from '../../Models/Geografia/MD_TB_Localidades.js';
import { CiudadesModel } from '../../Models/Geografia/MD_TB_Ciudades.js';

// -------- includes (cliente con geo) + vendedor + items opcionales --------
const incClienteGeo = {
  model: ClientesModel,
  as: 'cliente',
  attributes: [
    'id',
    'nombre',
    'documento',
    'email',
    'telefono',
    'barrio_id',
    'vendedor_preferido_id'
  ],
  include: [
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
  ]
};

const incVendedor = {
  model: VendedoresModel,
  as: 'vendedor',
  attributes: ['id', 'nombre', 'estado', 'email', 'telefono']
};

const incItems = {
  model: VentasDetalleModel,
  as: 'items',
  attributes: ['id', 'producto_id', 'cantidad', 'precio_unit', 'subtotal']
};

// -------- utils --------
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
  const allowed = new Set(['id', 'fecha', 'total_neto', 'created_at']);
  const col = allowed.has(String(orderBy)) ? orderBy : 'fecha';
  const dir = String(orderDir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  return [col, dir];
};

const normInt = (v, d = NaN) => (Number.isFinite(Number(v)) ? Number(v) : d);

const moneyRound = (n) => Math.round(Number(n) * 100) / 100;

const coerceTipo = (x) =>
  ['contado', 'fiado', 'a_cuenta'].includes(String(x)) ? String(x) : 'fiado';

// Validar ítem para creación (cuando POST /ventas viene con items[])
const validarItemForCreate = (it, idx = 0) => {
  const producto_id = normInt(it.producto_id);
  const cantidad = Number(it.cantidad);
  const precio_unit = Number(it.precio_unit);

  if (!Number.isFinite(producto_id) || producto_id <= 0) {
    const e = new Error(`Ítem #${idx + 1}: producto_id inválido.`);
    e.status = 400;
    throw e;
  }
  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    const e = new Error(`Ítem #${idx + 1}: cantidad debe ser > 0.`);
    e.status = 400;
    throw e;
  }
  if (!Number.isFinite(precio_unit) || precio_unit < 0) {
    const e = new Error(`Ítem #${idx + 1}: precio_unit debe ser ≥ 0.`);
    e.status = 400;
    throw e;
  }

  return { producto_id, cantidad, precio_unit };
};

// -------- validaciones de entidades --------
async function validarCliente(id, t) {
  const cli = await ClientesModel.findByPk(id, { transaction: t });
  if (!cli) {
    const e = new Error('CLIENTE_NO_ENCONTRADO');
    e.status = 404;
    throw e;
  }
  return cli.id;
}

async function validarVendedorActivo(id, t) {
  const v = await VendedoresModel.findByPk(id, { transaction: t });
  if (!v) {
    const e = new Error('VENDEDOR_NO_ENCONTRADO');
    e.status = 404;
    throw e;
  }
  if (v.estado !== 'activo') {
    const e = new Error('VENDEDOR_INACTIVO');
    e.status = 400;
    throw e;
  }
  return v.id;
}

// Recalcula total_neto sumando subtotales del detalle (ROUND por línea)
export async function recalcVentaTotal(ventaId, t) {
  const items = await VentasDetalleModel.findAll({
    where: { venta_id: ventaId },
    transaction: t,
    raw: true
  });

  const total = moneyRound(
    items.reduce(
      (acc, it) =>
        acc + moneyRound(Number(it.cantidad) * Number(it.precio_unit)),
      0
    )
  );

  const v = await VentasModel.findByPk(ventaId, { transaction: t });
  if (!v) {
    const e = new Error('VENTA_NO_ENCONTRADA');
    e.status = 404;
    throw e;
  }

  await v.update({ total_neto: total }, { transaction: t });
  return total;
}

// ===============================
// LIST - GET /ventas
// ===============================
export const OBRS_Ventas_CTS = async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req);
    const {
      q,
      cliente_id,
      vendedor_id,
      tipo,
      estado,
      desde,
      hasta,
      include,
      orderBy = 'fecha',
      orderDir = 'DESC'
    } = req.query;

    const where = {};

    // cliente_id / vendedor_id solo si son numéricos válidos
    const cid = normInt(cliente_id);
    if (Number.isFinite(cid)) where.cliente_id = cid;

    const vid = normInt(vendedor_id);
    if (Number.isFinite(vid)) where.vendedor_id = vid;

    // tipo solo si es uno permitido
    if (tipo && ['contado', 'fiado', 'a_cuenta'].includes(String(tipo))) {
      where.tipo = String(tipo);
    }

    if (estado && ['confirmada', 'anulada'].includes(String(estado))) {
      where.estado = String(estado);
    }

    // Rango de fechas (con sanity check)
    let d = null;
    let h = null;
    if (desde) {
      const tmp = new Date(`${desde}T00:00:00`);
      if (!isNaN(tmp.getTime())) d = tmp;
    }
    if (hasta) {
      const tmp = new Date(`${hasta}T23:59:59`);
      if (!isNaN(tmp.getTime())) h = tmp;
    }
    if (d || h) {
      where.fecha =
        d && h
          ? { [Op.between]: [d, h] }
          : d
          ? { [Op.gte]: d }
          : { [Op.lte]: h };
    }

    const and = [];
    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      and.push({
        [Op.or]: [
          { '$cliente.nombre$': { [Op.like]: like } },
          { '$cliente.documento$': { [Op.like]: like } },
          { '$cliente.email$': { [Op.like]: like } }
        ]
      });
    }

    const finalWhere = and.length ? { [Op.and]: [where, ...and] } : where;
    const [col, dir] = safeOrder(orderBy, orderDir);

    const baseInc = [incClienteGeo, incVendedor];
    if (String(include || '') === 'items') baseInc.push(incItems);

    const { rows, count } = await VentasModel.findAndCountAll({
      where: finalWhere,
      include: baseInc,
      limit,
      offset,
      order: [[col, dir]],
      subQuery: false,
      distinct: true
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
    console.error('OBRS_Ventas_CTS error:', err);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'Error listando ventas.'
    });
  }
};

// ===============================
// GET ONE - GET /ventas/:id  (incluye items)
// ===============================
export const OBR_Venta_CTS = async (req, res) => {
  try {
    const id = normInt(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'ID inválido.'
      });
    }

    const venta = await VentasModel.findByPk(id, {
      include: [incClienteGeo, incVendedor, incItems]
    });

    if (!venta) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Venta no encontrada.'
      });
    }

    return res.json(venta);
  } catch (err) {
    console.error('OBR_Venta_CTS error:', err);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'Error obteniendo venta.'
    });
  }
};

// ===============================
// CREATE - POST /ventas
// - Crea cabecera
// - Opcionalmente acepta items[] y calcula total_neto
// ===============================
export const CR_Venta_CTS = async (req, res) => {
  const { cliente_id, vendedor_id, fecha, tipo, observaciones, items } =
    req.body || {};

  const cliId = normInt(cliente_id);
  const vendId = normInt(vendedor_id);

  if (!Number.isFinite(cliId) || !Number.isFinite(vendId)) {
    return res.status(400).json({
      code: 'BAD_REQUEST',
      mensajeError: 'cliente_id y vendedor_id son obligatorios y numéricos.'
    });
  }

  const fechaDT = fecha ? new Date(fecha) : new Date();
  if (isNaN(fechaDT.getTime())) {
    return res.status(400).json({
      code: 'BAD_REQUEST',
      mensajeError: 'Fecha inválida.'
    });
  }

  const t = await db.transaction();
  try {
    await validarCliente(cliId, t);
    await validarVendedorActivo(vendId, t);

    const venta = await VentasModel.create(
      {
        cliente_id: cliId,
        vendedor_id: vendId,
        fecha: fechaDT,
        tipo: coerceTipo(tipo),
        total_neto: 0, // se recalcula si hay items
        observaciones: observaciones?.trim?.() || null,
        estado: 'confirmada'
      },
      { transaction: t }
    );

    // Si vienen ítems, los creamos en el acto
    if (Array.isArray(items) && items.length > 0) {
      const rows = items.map((it, i) => ({
        ...validarItemForCreate(it, i),
        venta_id: venta.id
      }));

      await VentasDetalleModel.bulkCreate(rows, { transaction: t });

      let total = rows.reduce(
        (acc, r) =>
          acc + moneyRound(Number(r.cantidad) * Number(r.precio_unit)),
        0
      );
      total = moneyRound(total);

      await venta.update({ total_neto: total }, { transaction: t });
    }

    await t.commit();

    const full = await VentasModel.findByPk(venta.id, {
      include: [incClienteGeo, incVendedor, incItems]
    });

    return res.status(201).json(full || venta);
  } catch (err) {
    try {
      if (!t.finished) await t.rollback();
    } catch {}

    if (err?.message === 'CLIENTE_NO_ENCONTRADO') {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Cliente no encontrado.'
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
    if (err?.status === 400) {
      return res.status(400).json({
        code: 'MODEL_VALIDATION',
        mensajeError: err.message
      });
    }

    console.error('CR_Venta_CTS error:', err);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo crear la venta.'
    });
  }
};

// ===============================
// UPDATE - PUT /ventas/:id  (solo cabecera)
// ===============================
export const UR_Venta_CTS = async (req, res) => {
  const id = normInt(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({
      code: 'BAD_REQUEST',
      mensajeError: 'ID inválido.'
    });
  }

  const { cliente_id, vendedor_id, fecha, tipo, observaciones, estado } =
    req.body || {};

  // Validaciones de forma (sin DB)
  let cliId = null;
  let vendId = null;
  let fechaDT = null;

  if (cliente_id !== undefined) {
    cliId = normInt(cliente_id);
    if (!Number.isFinite(cliId)) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'cliente_id debe ser numérico.'
      });
    }
  }

  if (vendedor_id !== undefined) {
    vendId = normInt(vendedor_id);
    if (!Number.isFinite(vendId)) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'vendedor_id debe ser numérico.'
      });
    }
  }

  if (fecha !== undefined) {
    const f = new Date(fecha);
    if (isNaN(f.getTime())) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'Fecha inválida.'
      });
    }
    fechaDT = f;
  }

  if (estado !== undefined) {
    if (!['confirmada', 'anulada'].includes(String(estado))) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: "Estado inválido (use 'confirmada'|'anulada')."
      });
    }
  }

  const t = await db.transaction();
  try {
    const venta = await VentasModel.findByPk(id, { transaction: t });
    if (!venta) {
      const e = new Error('VENTA_NO_ENCONTRADA');
      e.status = 404;
      throw e;
    }

    const patch = {};

    if (cliId !== null) {
      await validarCliente(cliId, t);
      patch.cliente_id = cliId;
    }

    if (vendId !== null) {
      await validarVendedorActivo(vendId, t);
      patch.vendedor_id = vendId;
    }

    if (fechaDT !== null) patch.fecha = fechaDT;
    if (tipo !== undefined) patch.tipo = coerceTipo(tipo);
    if (observaciones !== undefined) {
      patch.observaciones = observaciones?.trim?.() || null;
    }
    if (estado !== undefined) {
      patch.estado = String(estado);
    }

    await venta.update(patch, { transaction: t });
    await t.commit();

    const full = await VentasModel.findByPk(id, {
      include: [incClienteGeo, incVendedor, incItems]
    });

    return res.json(full || venta);
  } catch (err) {
    try {
      if (!t.finished) await t.rollback();
    } catch {}

    if (err?.message === 'CLIENTE_NO_ENCONTRADO') {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Cliente no encontrado.'
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
    if (err?.status === 404 && err?.message === 'VENTA_NO_ENCONTRADA') {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Venta no encontrada.'
      });
    }

    console.error('UR_Venta_CTS error:', err);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo actualizar la venta.'
    });
  }
};

// ===============================
// PATCH /ventas/:id/anular
// ===============================
export const UR_Venta_Anular_CTS = async (req, res) => {
  try {
    const id = normInt(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'ID inválido.'
      });
    }

    const venta = await VentasModel.findByPk(id);
    if (!venta) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Venta no encontrada.'
      });
    }

    if (venta.estado === 'anulada') {
      // Idempotente
      return res.json(venta);
    }

    await venta.update({ estado: 'anulada' });

    const full = await VentasModel.findByPk(id, {
      include: [incClienteGeo, incVendedor, incItems]
    });

    return res.json(full || venta);
  } catch (err) {
    console.error('UR_Venta_Anular_CTS error:', err);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo anular la venta.'
    });
  }
};

// ===============================
// DELETE - DELETE /ventas/:id?hard=1
// ===============================
export const ER_Venta_CTS = async (req, res) => {
  const id = normInt(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({
      code: 'BAD_REQUEST',
      mensajeError: 'ID inválido.'
    });
  }

  const hard = String(req.query.hard || '') === '1';

  const t = await db.transaction();
  try {
    const venta = await VentasModel.findByPk(id, { transaction: t });
    if (!venta) {
      const e = new Error('VENTA_NO_ENCONTRADA');
      e.status = 404;
      throw e;
    }

    if (!hard) {
      await venta.update({ estado: 'anulada' }, { transaction: t });
    } else {
      await venta.destroy({ transaction: t }); // detalle ON DELETE CASCADE
    }

    await t.commit();
    return hard ? res.status(204).send() : res.json(venta);
  } catch (err) {
    try {
      if (!t.finished) await t.rollback();
    } catch {}

    if (err?.status === 404 && err?.message === 'VENTA_NO_ENCONTRADA') {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Venta no encontrada.'
      });
    }

    console.error('ER_Venta_CTS error:', err);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo eliminar/anular la venta.'
    });
  }
};

// ===============================
// POST /ventas/:ventaId/recalcular  (forza recalculo de total)
// ===============================
export const UR_Venta_RecalcularTotal_CTS = async (req, res) => {
  const ventaId = normInt(req.params.ventaId);
  if (!Number.isFinite(ventaId)) {
    return res.status(400).json({
      code: 'BAD_REQUEST',
      mensajeError: 'ventaId inválido.'
    });
  }

  const t = await db.transaction();
  try {
    const total = await recalcVentaTotal(ventaId, t);
    await t.commit();
    return res.json({ ok: true, total_neto: total });
  } catch (err) {
    try {
      if (!t.finished) await t.rollback();
    } catch {}

    const st = err?.status || 500;
    const code =
      st === 404
        ? 'NOT_FOUND'
        : st === 400
        ? 'MODEL_VALIDATION'
        : 'SERVER_ERROR';
    const msg =
      err?.message ||
      (st === 404 ? 'Venta no encontrada.' : 'No se pudo recalcular.');

    return res.status(st).json({
      code,
      mensajeError: msg
    });
  }
};
