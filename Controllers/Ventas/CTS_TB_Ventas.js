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

import { Op, fn, col } from 'sequelize';
import db from '../../DataBase/db.js';

import VentasModel from '../../Models/Ventas/MD_TB_Ventas.js';
import VentasDetalleModel from '../../Models/Ventas/MD_TB_VentasDetalle.js';

import ClientesModel from '../../Models/Clientes/MD_TB_Clientes.js';
import { VendedoresModel } from '../../Models/Vendedores/MD_TB_Vendedores.js';

import { BarriosModel } from '../../Models/Geografia/MD_TB_Barrios.js';
import { LocalidadesModel } from '../../Models/Geografia/MD_TB_Localidades.js';
import { CiudadesModel } from '../../Models/Geografia/MD_TB_Ciudades.js';
import CxcMovimientosModel from '../../Models/CuentasCorriente/MD_TB_CxcMovimientos.js';
import { CobranzaAplicacionesModel } from '../../Models/Cobranzas/MD_TB_CobranzaAplicaciones.js';

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

async function registrarCxcPorVenta(venta, t, descripcionExtra = '') {
  if (!venta) return;

  // Solo generamos CxC si la venta es fiada o a cuenta
  if (!['fiado', 'a_cuenta'].includes(String(venta.tipo))) return;

  const monto = Number(venta.total_neto) || 0;
  if (monto <= 0) return;

  const descBase = `Venta #${venta.id}`;
  const desc =
    descripcionExtra && descripcionExtra.trim()
      ? `${descBase} · ${descripcionExtra.trim()}`
      : descBase;

  await CxcMovimientosModel.create(
    {
      cliente_id: venta.cliente_id,
      fecha: venta.fecha,
      signo: 1, // DEBE (aumenta deuda)
      monto,
      origen_tipo: 'venta',
      origen_id: venta.id,
      descripcion: desc
    },
    { transaction: t }
  );
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
      orderDir = 'DESC',
      // 👇 nuevos filtros de geografía
      ciudad_id,
      localidad_id,
      barrio_id
    } = req.query;

    const where = {};
    if (cliente_id) where.cliente_id = Number(cliente_id);
    if (vendedor_id) where.vendedor_id = Number(vendedor_id);
    if (tipo) where.tipo = coerceTipo(tipo);
    if (estado && ['confirmada', 'anulada'].includes(String(estado)))
      where.estado = String(estado);

    if (desde || hasta) {
      const d = desde ? new Date(`${desde}T00:00:00`) : null;
      const h = hasta ? new Date(`${hasta}T23:59:59`) : null;
      where.fecha =
        d && h
          ? { [Op.between]: [d, h] }
          : d
          ? { [Op.gte]: d }
          : h
          ? { [Op.lte]: h }
          : undefined;
    }

    const and = [];

    // 🔍 búsqueda por texto en cliente
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

    if (barrio_id) {
      and.push({
        '$cliente.barrio.id$': Number(barrio_id)
      });
    }
    if (localidad_id) {
      and.push({
        '$cliente.barrio.localidad.id$': Number(localidad_id)
      });
    }
    if (ciudad_id) {
      and.push({
        '$cliente.barrio.localidad.ciudad.id$': Number(ciudad_id)
      });
    }

    const finalWhere = and.length > 0 ? { [Op.and]: [where, ...and] } : where;

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
    return res
      .status(500)
      .json({ code: 'SERVER_ERROR', mensajeError: 'Error listando ventas.' });
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

// ===============================
// CREATE MASIVO POR REPARTO
// POST /ventas/reparto-masiva
//
// Body esperado:
// {
//   reparto_id: 1,
//   fecha: "2025-11-29T00:00:00",
//   tipo: "fiado", // contado | fiado | a_cuenta
//   vendedor_id: 3,
//   observaciones: "texto opcional",
//   items: [
//     {
//       cliente_id: 4,
//       lineas: [
//         { producto_id: 10, cantidad: 3, precio_unit: 2500.0 },
//         { producto_id: 11, cantidad: 1, precio_unit: 2300.0 }
//       ]
//     },
//     ...
//   ]
// }
// ===============================
export const CR_VentasReparto_Masiva_CTS = async (req, res) => {
  const { reparto_id, fecha, tipo, vendedor_id, observaciones, items } =
    req.body || {};

  const vendId = normInt(vendedor_id);
  const repId = normInt(reparto_id, null);

  // Validaciones básicas
  if (!Number.isFinite(vendId)) {
    return res.status(400).json({
      code: 'BAD_REQUEST',
      mensajeError: 'vendedor_id es obligatorio y debe ser numérico.'
    });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      code: 'BAD_REQUEST',
      mensajeError:
        'Debe enviar al menos un ítem con cliente y sus líneas de productos.'
    });
  }

  const fechaDT = fecha ? new Date(fecha) : new Date();
  if (isNaN(fechaDT.getTime())) {
    return res.status(400).json({
      code: 'BAD_REQUEST',
      mensajeError: 'Fecha inválida.'
    });
  }

  const tipoVenta = coerceTipo(tipo); // contado | fiado | a_cuenta
  const obsGlobal = observaciones?.trim?.() || null;

  const t = await db.transaction();
  try {
    // Validamos vendedor una sola vez
    await validarVendedorActivo(vendId, t);

    // Validamos estructura de items + clientes
    const clientesIds = new Set();

    const itemsNormalizados = items.map((item, idxCliente) => {
      const cliId = normInt(item.cliente_id);
      if (!Number.isFinite(cliId) || cliId <= 0) {
        const e = new Error(`Cliente #${idxCliente + 1}: cliente_id inválido.`);
        e.status = 400;
        throw e;
      }
      if (!Array.isArray(item.lineas) || item.lineas.length === 0) {
        const e = new Error(
          `Cliente #${
            idxCliente + 1
          }: debe contener al menos una línea de producto.`
        );
        e.status = 400;
        throw e;
      }

      // Normalizamos y validamos líneas reutilizando validarItemForCreate
      const lineasNorm = item.lineas.map((ln, idxLinea) =>
        validarItemForCreate(ln, idxLinea)
      );

      clientesIds.add(cliId);

      return {
        cliente_id: cliId,
        lineas: lineasNorm
      };
    });

    // Validar que todos los clientes existan
    for (const cliId of clientesIds) {
      await validarCliente(cliId, t);
    }

    const ventasCreadas = [];
    let totalGeneral = 0;

    // Por cada cliente creamos una venta + sus detalles
    for (const group of itemsNormalizados) {
      const { cliente_id: cliId, lineas } = group;

      // Creamos cabecera de venta (una por cliente)
      const venta = await VentasModel.create(
        {
          cliente_id: cliId,
          vendedor_id: vendId,
          fecha: fechaDT,
          tipo: tipoVenta,
          total_neto: 0,
          observaciones: obsGlobal,
          estado: 'confirmada'
        },
        { transaction: t }
      );

      // Cuerpo de detalle
      const rowsDetalle = lineas.map((ln) => ({
        venta_id: venta.id,
        producto_id: ln.producto_id,
        cantidad: ln.cantidad,
        precio_unit: ln.precio_unit
      }));

      await VentasDetalleModel.bulkCreate(rowsDetalle, { transaction: t });

      // Calculamos total_neto desde las líneas
      let totalCli = rowsDetalle.reduce(
        (acc, r) =>
          acc + moneyRound(Number(r.cantidad) * Number(r.precio_unit)),
        0
      );
      totalCli = moneyRound(totalCli);

      await venta.update({ total_neto: totalCli }, { transaction: t });

      // Registramos CxC si corresponde (fiado / a_cuenta)
      const descExtra =
        repId != null
          ? `Reparto ${repId} · Cliente ${cliId}`
          : `Reparto masivo cliente ${cliId}`;
      await registrarCxcPorVenta(
        { ...venta.get({ plain: true }), total_neto: totalCli },
        t,
        descExtra
      );

      ventasCreadas.push({
        id: venta.id,
        cliente_id: cliId,
        total_neto: totalCli
      });
      totalGeneral += totalCli;
    }

    totalGeneral = moneyRound(totalGeneral);

    await t.commit();

    return res.status(201).json({
      ok: true,
      mensaje: `Se generaron ${ventasCreadas.length} venta(s) para el reparto.`,
      meta: {
        ventasCreadas: ventasCreadas.length,
        totalGeneral,
        reparto_id: repId || null
      },
      ventas: ventasCreadas
    });
  } catch (err) {
    try {
      if (!t.finished) await t.rollback();
    } catch {}

    if (err?.message === 'CLIENTE_NO_ENCONTRADO') {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Alguno de los clientes no existe.'
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

    console.error('CR_VentasReparto_Masiva_CTS error:', err);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudieron generar las ventas por reparto.'
    });
  }
};

// =============================================
// GET /ventas/deudores-fiado
// Devuelve deudores considerando cobranzas:
// - Suma ventas fiado confirmadas
// - Resta monto_aplicado en cobranza_aplicaciones
// - Solo incluye ventas con saldo > 0
// =============================================
export const OBRS_VentasDeudoresFiado_CTS = async (req, res) => {
  try {
    // 1) Traer todas las ventas fiado confirmadas
    const ventasFiado = await VentasModel.findAll({
      where: {
        tipo: 'fiado',
        estado: 'confirmada'
      },
      include: [
        {
          model: ClientesModel,
          as: 'cliente',
          attributes: ['id', 'nombre', 'documento', 'email', 'telefono']
        },
        {
          model: VendedoresModel,
          as: 'vendedor',
          attributes: ['id', 'nombre']
        }
      ],
      order: [
        ['cliente_id', 'ASC'],
        ['fecha', 'DESC']
      ]
    });

    if (!ventasFiado.length) {
      return res.json([]);
    }

    // 2) Buscar aplicaciones de cobranza para esas ventas usando SQL crudo
    const ventasIds = ventasFiado.map((v) => v.id);

    const [appsRows] = await db.query(
      `
      SELECT
        venta_id,
        SUM(monto_aplicado) AS total_aplicado
      FROM cobranza_aplicaciones
      WHERE venta_id IN (:ventasIds)
      GROUP BY venta_id
      `,
      {
        replacements: { ventasIds }
      }
    );

    const appsByVenta = new Map();
    for (const row of appsRows) {
      const ventaId = Number(row.venta_id);
      const totalAplicado = Number(row.total_aplicado) || 0;
      appsByVenta.set(ventaId, totalAplicado);
    }

    // 3) Armar resumen por cliente considerando el saldo pendiente
    const hoy = new Date();
    const map = new Map();

    for (const v of ventasFiado) {
      const cli = v.cliente;
      if (!cli) continue;

      const totalVenta = Number(v.total_neto) || 0;
      const aplicado = appsByVenta.get(v.id) || 0;
      const saldo = Math.max(0, totalVenta - aplicado);

      // Si la venta está totalmente cobrada, la ignoramos
      if (saldo <= 0.01) {
        continue;
      }

      const key = cli.id;
      const existente = map.get(key) || {
        cliente_id: cli.id,
        nombre: cli.nombre,
        documento: cli.documento,
        email: cli.email,
        telefono: cli.telefono,
        total_pendiente: 0,
        dias_max_atraso: 0,
        ventas: []
      };

      // sumamos solo el saldo pendiente
      existente.total_pendiente += saldo;

      // días de atraso (desde la fecha de la venta)
      const fechaVenta = new Date(v.fecha);
      const diffMs = hoy - fechaVenta;
      const diffDias = Math.max(
        0,
        Math.floor(diffMs / (1000 * 60 * 60 * 24))
      );
      if (diffDias > existente.dias_max_atraso) {
        existente.dias_max_atraso = diffDias;
      }

      // guardamos la venta con su saldo pendiente
      existente.ventas.push({
        id: v.id,
        fecha: v.fecha,
        vendedor_id: v.vendedor_id,
        vendedor_nombre: v.vendedor?.nombre || null,
        tipo: v.tipo,
        estado: v.estado,
        total_neto: totalVenta, // total original
        saldo: saldo, // saldo pendiente real
        observaciones: v.observaciones
      });

      map.set(key, existente);
    }

    // 4) Armar array de deudores (solo clientes con saldo > 0)
    const deudores = Array.from(map.values())
      .filter((d) => d.total_pendiente > 0.01)
      .sort((a, b) => b.total_pendiente - a.total_pendiente);

    return res.json(deudores);
  } catch (err) {
    console.error('OBRS_VentasDeudoresFiado_CTS error:', err);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo obtener el resumen de deudores.'
    });
  }
};
