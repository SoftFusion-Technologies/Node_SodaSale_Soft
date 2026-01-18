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

import { Op, fn, col, literal, where as sWhere } from 'sequelize';
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
import { RepartosModel } from '../../Models/Repartos/MD_TB_Repartos.js';
import { registrarCobranzaACuentaPorVenta } from '../Cobranzas/CTS_TB_CobranzasClientes.js';
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

  await CxcMovimientosModel.findOrCreate({
    where: {
      origen_tipo: 'venta',
      origen_id: venta.id
    },
    defaults: {
      cliente_id: venta.cliente_id,
      fecha: venta.fecha,
      signo: 1, // DEBE (aumenta deuda)
      monto,
      origen_tipo: 'venta',
      origen_id: venta.id,
      descripcion: desc
    },
    transaction: t
  });
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

const normOptInt = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

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
      reparto_id, // Benjamin Orellana - 17-01-2026 se agrega filtro reparto_id
      tipo,
      estado,
      desde,
      hasta,
      include,
      orderBy = 'fecha',
      orderDir = 'DESC',
      // nuevos filtros de geografía
      ciudad_id,
      localidad_id,
      barrio_id
    } = req.query;

    const deuda = String(req.query.deuda ?? '') === '1';
    const saldoMin = Number(req.query.saldo_min ?? 0.01);
    const saldoThreshold = Number.isFinite(saldoMin) ? saldoMin : 0.01;

    const where = {};

    if (cliente_id) where.cliente_id = Number(cliente_id);
    if (vendedor_id) where.vendedor_id = Number(vendedor_id);

    // ======================================================
    // Benjamin Orellana - 17-01-2026
    // Filtro por reparto_id
    // ======================================================
    if (reparto_id !== undefined && reparto_id !== null && reparto_id !== '') {
      const repId = Number(reparto_id);
      if (!Number.isInteger(repId) || repId <= 0) {
        return res.status(400).json({
          code: 'BAD_REQUEST',
          mensajeError: 'reparto_id debe ser numérico.'
        });
      }
      where.reparto_id = repId;
    }

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
      and.push({ '$cliente.barrio.id$': Number(barrio_id) });
    }
    if (localidad_id) {
      and.push({ '$cliente.barrio.localidad.id$': Number(localidad_id) });
    }
    if (ciudad_id) {
      and.push({ '$cliente.barrio.localidad.ciudad.id$': Number(ciudad_id) });
    }

    if (deuda) {
      // Si el caller no fijó tipo/estado, forzamos defaults razonables para deuda
      if (!tipo) where.tipo = { [Op.in]: ['fiado', 'a_cuenta'] };
      if (!estado) where.estado = 'confirmada';

      // Saldo = total_neto - monto_a_cuenta > 0
      and.push(
        sWhere(
          literal('ROUND(IFNULL(total_neto,0) - IFNULL(monto_a_cuenta,0), 2)'),
          { [Op.gt]: saldoThreshold }
        )
      );
    }

    const finalWhere = and.length > 0 ? { [Op.and]: [where, ...and] } : where;
    const [col, dir] = safeOrder(orderBy, orderDir);

    const baseInc = [
      incClienteGeo,
      incVendedor /*, incReparto si querés mostrarlo */
    ];
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
  // incluir monto_a_cuenta
  const {
    cliente_id,
    vendedor_id,
    fecha,
    tipo,
    observaciones,
    items,
    monto_a_cuenta,
    // ======================================================
    // Benjamin Orellana - 17-01-2026
    // Nuevo: reparto_id (snapshot para filtrar por reparto)
    // ======================================================
    reparto_id
  } = req.body || {};

  const cliId = normInt(cliente_id);
  const vendId = normInt(vendedor_id);

  // ======================================================
  // Benjamin Orellana - 17-01-2026
  // Normalizamos reparto_id (si viene)
  // ======================================================
  const repartoIdIn =
    reparto_id === null || reparto_id === undefined || reparto_id === ''
      ? null
      : Number(reparto_id);

  if (reparto_id !== undefined && reparto_id !== null && reparto_id !== '') {
    if (!Number.isInteger(repartoIdIn) || repartoIdIn <= 0) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'reparto_id debe ser numérico.'
      });
    }
  }

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

  // ======================================================
  // Benjamin Orellana - 17-01-2026
  // Normalizamos a cuenta entrante (si viene)
  // ======================================================
  const aCuentaIn = moneyRound(Number(monto_a_cuenta || 0));
  if (!Number.isFinite(aCuentaIn) || aCuentaIn < 0) {
    return res.status(400).json({
      code: 'BAD_REQUEST',
      mensajeError: 'monto_a_cuenta debe ser numérico y >= 0.'
    });
  }

  const t = await db.transaction();
  try {
    await validarCliente(cliId, t);
    await validarVendedorActivo(vendId, t);

    // ======================================================
    // Benjamin Orellana - 17-01-2026
    // Validar reparto si vino (existencia + estado)
    // NOTA: requiere tener importado RepartosModel en el archivo.
    // ======================================================
    if (repartoIdIn) {
      const rep = await RepartosModel.findByPk(repartoIdIn, { transaction: t });
      if (!rep) {
        const e = new Error('REPARTO_NO_ENCONTRADO');
        e.status = 404;
        throw e;
      }
      if (rep.estado !== 'activo') {
        const e = new Error('REPARTO_INACTIVO');
        e.status = 400;
        throw e;
      }
    }

    // Si hay aCuenta, forzamos tipo a_cuenta (coherencia negocio)
    const tipoFinal = aCuentaIn > 0 ? 'a_cuenta' : coerceTipo(tipo);

    const venta = await VentasModel.create(
      {
        cliente_id: cliId,
        vendedor_id: vendId,
        // ======================================================
        // Benjamin Orellana - 17-01-2026
        // Persistimos reparto_id en venta (snapshot)
        // ======================================================
        reparto_id: repartoIdIn,
        fecha: fechaDT,
        tipo: tipoFinal,
        total_neto: 0,
        // IMPORTANTE: arrancamos en 0; el aCuenta real lo aplicará registrarCobranzaACuentaPorVenta
        monto_a_cuenta: 0,
        observaciones: observaciones?.trim?.() || null,
        estado: 'confirmada'
      },
      { transaction: t }
    );

    // Si vienen ítems, los creamos en el acto
    let total = 0;

    if (Array.isArray(items) && items.length > 0) {
      const rows = items.map((it, i) => ({
        ...validarItemForCreate(it, i),
        venta_id: venta.id
      }));

      await VentasDetalleModel.bulkCreate(rows, { transaction: t });

      total = rows.reduce(
        (acc, r) =>
          acc + moneyRound(Number(r.cantidad) * Number(r.precio_unit)),
        0
      );
      total = moneyRound(total);

      await venta.update({ total_neto: total }, { transaction: t });

      // ======================================================
      // Benjamin Orellana - 18-01-2026
      // Registrar CxC DEBE por la venta (fiado / a_cuenta)
      // IMPORTANTÍSIMO: antes de generar cobranza a cuenta, para que el saldo quede neto.
      // ======================================================
      await registrarCxcPorVenta(
        venta,
        t,
        repartoIdIn ? `Reparto ${repartoIdIn}` : ''
      );
    }

    // ======================================================
    // Benjamin Orellana - 17-01-2026
    // Validación y aplicación del pago inicial:
    // - requiere total > 0 para validar contra saldo
    // - crea Cobranza + CxC HABER + aplica a venta (ventas.monto_a_cuenta)
    // ======================================================
    if (aCuentaIn > 0.01) {
      if (!(total > 0.01)) {
        const e = new Error(
          'Para registrar "a cuenta" en la creación, se requieren items en el mismo POST /ventas.'
        );
        e.status = 400;
        throw e;
      }
      if (aCuentaIn - total > 0.01) {
        const e = new Error('El monto a cuenta no puede superar el total.');
        e.status = 400;
        throw e;
      }

      await registrarCobranzaACuentaPorVenta(
        {
          cliente_id: cliId,
          vendedor_id: vendId,
          fecha: fechaDT,
          montoACuenta: aCuentaIn,
          venta_id: venta.id,
          observacionesExtra: `Pago inicial a cuenta · Venta #${venta.id}`
        },
        t
      );
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

    // ======================================================
    // Benjamin Orellana - 17-01-2026
    // Errores específicos de reparto
    // ======================================================
    if (err?.message === 'REPARTO_NO_ENCONTRADO') {
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

    if (err?.status === 400) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
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
export const CR_VentasReparto_Masiva_CTS = async (req, res) => {
  const { reparto_id, fecha, tipo, vendedor_id, observaciones, items } =
    req.body || {};

  console.log(
    '[REPARTO-MASIVA] INICIO handler',
    'reparto_id=',
    reparto_id,
    'vendedor_id=',
    vendedor_id,
    'items=',
    Array.isArray(items) ? items.length : 0
  );

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

    // -----------------------------
    // 1) Normalizar items + validar
    // -----------------------------
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

      // Aceptamos ambos nombres desde el front: a_cuenta o monto_a_cuenta
      const montoACuentaRaw = item.a_cuenta ?? item.monto_a_cuenta ?? 0;
      const montoACuentaNum = Number(montoACuentaRaw);

      if (!Number.isFinite(montoACuentaNum) || montoACuentaNum < 0) {
        const e = new Error(
          `Cliente #${
            idxCliente + 1
          }: a_cuenta/monto_a_cuenta debe ser numérico y >= 0.`
        );
        e.status = 400;
        throw e;
      }

      const lineasNorm = item.lineas.map((ln, idxLinea) =>
        validarItemForCreate(ln, idxLinea)
      );

      clientesIds.add(cliId);

      return {
        cliente_id: cliId,
        monto_a_cuenta: montoACuentaNum, // nombre interno
        lineas: lineasNorm
      };
    });

    // Validar que todos los clientes existan (una sola vez)
    for (const cliId of clientesIds) {
      await validarCliente(cliId, t);
    }

    // -----------------------------
    // 2) Crear ventas + detalle + CxC + cobranza a cuenta
    // -----------------------------
    const ventasCreadas = [];
    let totalGeneral = 0;

    for (const group of itemsNormalizados) {
      const { cliente_id: cliId, lineas, monto_a_cuenta } = group;

      // Cabecera inicial
      const venta = await VentasModel.create(
        {
          cliente_id: cliId,
          vendedor_id: vendId,
          reparto_id: repId,
          fecha: fechaDT,
          tipo: tipoVenta, // en este flujo, normalmente "fiado"
          total_neto: 0,
          monto_a_cuenta: 0,
          observaciones: obsGlobal,
          estado: 'confirmada'
        },
        { transaction: t }
      );

      // Detalle
      const rowsDetalle = lineas.map((ln) => ({
        venta_id: venta.id,
        producto_id: ln.producto_id,
        cantidad: ln.cantidad,
        precio_unit: ln.precio_unit
      }));

      await VentasDetalleModel.bulkCreate(rowsDetalle, { transaction: t });

      // Total mercadería
      let totalCli = rowsDetalle.reduce(
        (acc, r) =>
          acc + moneyRound(Number(r.cantidad) * Number(r.precio_unit)),
        0
      );
      totalCli = moneyRound(totalCli);

      // Monto a cuenta no puede superar el total
      let montoACuentaCli = Number(monto_a_cuenta || 0);
      if (montoACuentaCli > totalCli) {
        montoACuentaCli = totalCli;
      }
      montoACuentaCli = moneyRound(montoACuentaCli);

      const deudaInicial = moneyRound(totalCli - montoACuentaCli);

      // Actualizar cabecera
      await venta.update(
        {
          total_neto: totalCli, // total mercadería
          monto_a_cuenta: montoACuentaCli // pago en el momento
        },
        { transaction: t }
      );

      const ventaPlain = venta.get({ plain: true });

      const descExtra =
        repId != null
          ? `Reparto ${repId} · Cliente ${cliId}`
          : `Reparto masivo cliente ${cliId}`;

      // Movimiento CxC por la venta (DEBE = total mercadería)
      await registrarCxcPorVenta(
        { ...ventaPlain, total_neto: totalCli },
        t,
        descExtra
      );

      // Si hay a cuenta, registramos la cobranza
      if (montoACuentaCli > 0) {
        await registrarCobranzaACuentaPorVenta(
          {
            cliente_id: cliId,
            vendedor_id: vendId,
            fecha: fechaDT,
            montoACuenta: montoACuentaCli,
            venta_id: venta.id,
            observacionesExtra: `${descExtra} · A cuenta en misma jornada`
          },
          t
        );
      }

      ventasCreadas.push({
        id: venta.id,
        cliente_id: cliId,
        total_neto: totalCli,
        monto_a_cuenta: montoACuentaCli,
        deuda_inicial: deudaInicial
      });

      totalGeneral += totalCli;
    }

    totalGeneral = moneyRound(totalGeneral);

    await t.commit();

    console.log(
      '[REPARTO-MASIVA] FIN handler',
      'ventasCreadasIds=',
      ventasCreadas.map((v) => v.id)
    );

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
// - Incluye ventas fiado y a_cuenta confirmadas
// - Calcula saldo = total_neto - pagado
//   pagado = MAX(ventas.monto_a_cuenta, SUM(cobranza_aplicaciones.monto_aplicado))
//   (compatibilidad: evita doble conteo si ya actualizás monto_a_cuenta)
// - Solo incluye ventas con saldo > 0
// =============================================
export const OBRS_VentasDeudoresFiado_CTS = async (req, res) => {
  try {
    // Benjamin Orellana - 17-01-2026
    // Incluir también ventas tipo "a_cuenta" porque también generan deuda
    const ventasDeuda = await VentasModel.findAll({
      where: {
        tipo: { [Op.in]: ['fiado', 'a_cuenta'] },
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
        ['fecha', 'DESC'],
        ['id', 'DESC']
      ]
    });

    if (!ventasDeuda.length) {
      return res.json([]);
    }

    // 2) Buscar aplicaciones de cobranza para esas ventas (solo venta_id != null)
    const ventasIds = ventasDeuda.map((v) => v.id);

    const [appsRows] = await db.query(
      `
      SELECT
        venta_id,
        SUM(monto_aplicado) AS total_aplicado
      FROM cobranza_aplicaciones
      WHERE venta_id IS NOT NULL
        AND venta_id IN (:ventasIds)
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

    // 3) Armar resumen por cliente considerando saldo pendiente real
    const hoy = new Date();
    const map = new Map();

    for (const v of ventasDeuda) {
      const cli = v.cliente;
      if (!cli) continue;

      const totalVenta = Number(v.total_neto) || 0;

      // Benjamin Orellana - 17-01-2026
      // Fuente canónica: ventas.monto_a_cuenta
      // Compatibilidad: si hay histórico de apps, tomamos el máximo para no duplicar.
      const aCuentaVenta = Number(v.monto_a_cuenta) || 0;
      const aplicadoApps = appsByVenta.get(v.id) || 0;
      const pagado = Math.max(aCuentaVenta, aplicadoApps);

      const saldo = Math.max(0, totalVenta - pagado);

      // Si está totalmente cobrada, la ignoramos
      if (saldo <= 0.01) continue;

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

      existente.total_pendiente += saldo;

      // días de atraso (desde la fecha de la venta)
      const fechaVenta = new Date(v.fecha);
      const diffMs = hoy - fechaVenta;
      const diffDias = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
      if (diffDias > existente.dias_max_atraso) {
        existente.dias_max_atraso = diffDias;
      }

      existente.ventas.push({
        id: v.id,
        fecha: v.fecha,
        vendedor_id: v.vendedor_id,
        vendedor_nombre: v.vendedor?.nombre || null,
        tipo: v.tipo,
        estado: v.estado,
        total_neto: totalVenta,
        monto_a_cuenta: aCuentaVenta,
        aplicado_cobranzas: aplicadoApps,
        pagado: pagado,
        saldo: saldo,
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
