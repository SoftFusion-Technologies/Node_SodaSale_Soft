// ===============================
// FILE: Controllers/Ventas/CTS_TB_VentasDetalle.js
// ===============================
import db from '../../DataBase/db.js';
import VentasModel from '../../Models/Ventas/MD_TB_Ventas.js';
import VentasDetalleModel from '../../Models/Ventas/MD_TB_VentasDetalle.js';
import { recalcVentaTotal } from './CTS_TB_Ventas.js'; // usamos el helper exportado

// -------- utils --------
const normInt = (v, d = NaN) =>
  Number.isFinite(Number(v)) ? Number(v) : d;

// Valida forma de un ítem (sin tocar DB)
function validarItemShape(it, idx = 0) {
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
}

// Valida que la venta exista y NO esté anulada
async function assertVentaEditable(ventaId, t) {
  const v = await VentasModel.findByPk(ventaId, { transaction: t });
  if (!v) {
    const e = new Error('VENTA_NO_ENCONTRADA');
    e.status = 404;
    throw e;
  }
  if (v.estado === 'anulada') {
    const e = new Error('VENTA_ANULADA');
    e.status = 400;
    e.msg = 'La venta está anulada.';
    throw e;
  }
  return v;
}

// Helper para mapear errores a response consistente
function buildDetalleError(res, err, defaultMsg) {
  const st = err?.status || 500;
  let code;
  let msg = defaultMsg;

  if (st === 404) {
    code = 'NOT_FOUND';
    if (err?.message === 'VENTA_NO_ENCONTRADA') {
      msg = 'Venta no encontrada.';
    } else if (err?.message === 'ITEM_NO_ENCONTRADO') {
      msg = 'Ítem no encontrado.';
    } else {
      msg = err?.msg || err?.message || 'Recurso no encontrado.';
    }
  } else if (st === 400) {
    code = 'MODEL_VALIDATION';
    msg = err?.msg || err?.message || defaultMsg;
  } else {
    code = 'SERVER_ERROR';
    msg = err?.msg || err?.message || defaultMsg;
  }

  return res.status(st).json({ code, mensajeError: msg });
}

// ===============================
// GET /ventas/:ventaId/items
// ===============================
export const OBRS_VentasItems_CTS = async (req, res) => {
  try {
    const ventaId = normInt(req.params.ventaId);
    if (!Number.isFinite(ventaId)) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'ventaId inválido.'
      });
    }

    const items = await VentasDetalleModel.findAll({
      where: { venta_id: ventaId },
      order: [['id', 'ASC']]
    });

    return res.json({ data: items });
  } catch (err) {
    console.error('OBRS_VentasItems_CTS error:', err);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'Error listando ítems.'
    });
  }
};

// ===============================
// POST /ventas/:ventaId/items   (acepta 1 ítem o array de ítems)
// ===============================
export const CR_VentasItems_CTS = async (req, res) => {
  const ventaId = normInt(req.params.ventaId);
  if (!Number.isFinite(ventaId)) {
    return res.status(400).json({
      code: 'BAD_REQUEST',
      mensajeError: 'ventaId inválido.'
    });
  }

  // Normalizar payload a array
  const rawPayload = Array.isArray(req.body)
    ? req.body
    : Array.isArray(req.body?.items)
    ? req.body.items
    : [req.body];

  if (!Array.isArray(rawPayload) || rawPayload.length === 0) {
    return res.status(400).json({
      code: 'BAD_REQUEST',
      mensajeError: 'Se requiere al menos un ítem.'
    });
  }

  // Validar forma de ítems (sin abrir transacción todavía)
  let rows;
  try {
    rows = rawPayload.map((it, i) => ({
      ...validarItemShape(it, i),
      venta_id: ventaId
    }));
  } catch (err) {
    return buildDetalleError(res, err, 'Ítems inválidos.');
  }

  const t = await db.transaction();
  try {
    // Validar que la venta exista y sea editable
    await assertVentaEditable(ventaId, t);

    // Insertar items
    await VentasDetalleModel.bulkCreate(rows, { transaction: t });

    // Recalcular total
    await recalcVentaTotal(ventaId, t);

    await t.commit();

    const items = await VentasDetalleModel.findAll({
      where: { venta_id: ventaId },
      order: [['id', 'ASC']]
    });

    return res.status(201).json({ data: items });
  } catch (err) {
    try {
      if (!t.finished) await t.rollback();
    } catch {}

    console.error('CR_VentasItems_CTS error:', err);
    return buildDetalleError(res, err, 'No se pudo agregar ítems.');
  }
};

// ===============================
// PUT /ventas/:ventaId/items/:itemId  (actualiza un ítem)
// ===============================
export const UR_VentasItem_CTS = async (req, res) => {
  const ventaId = normInt(req.params.ventaId);
  const itemId = normInt(req.params.itemId);

  if (!Number.isFinite(ventaId) || !Number.isFinite(itemId)) {
    return res.status(400).json({
      code: 'BAD_REQUEST',
      mensajeError: 'IDs inválidos.'
    });
  }

  const t = await db.transaction();
  try {
    await assertVentaEditable(ventaId, t);

    const item = await VentasDetalleModel.findOne({
      where: { id: itemId, venta_id: ventaId },
      transaction: t
    });

    if (!item) {
      const e = new Error('ITEM_NO_ENCONTRADO');
      e.status = 404;
      throw e;
    }

    // Construir el nuevo estado del ítem (merge actual + body) y validarlo
    const current = item.toJSON();
    const candidate = {
      producto_id:
        req.body.producto_id !== undefined
          ? req.body.producto_id
          : current.producto_id,
      cantidad:
        req.body.cantidad !== undefined
          ? req.body.cantidad
          : current.cantidad,
      precio_unit:
        req.body.precio_unit !== undefined
          ? req.body.precio_unit
          : current.precio_unit
    };

    const normalized = validarItemShape(candidate, 0);

    await item.update(
      {
        producto_id: normalized.producto_id,
        cantidad: normalized.cantidad,
        precio_unit: normalized.precio_unit
      },
      { transaction: t }
    );

    await recalcVentaTotal(ventaId, t);
    await t.commit();

    const items = await VentasDetalleModel.findAll({
      where: { venta_id: ventaId },
      order: [['id', 'ASC']]
    });

    return res.json({ data: items });
  } catch (err) {
    try {
      if (!t.finished) await t.rollback();
    } catch {}

    console.error('UR_VentasItem_CTS error:', err);
    return buildDetalleError(res, err, 'No se pudo actualizar el ítem.');
  }
};

// ===============================
// DELETE /ventas/:ventaId/items/:itemId
// ===============================
export const ER_VentasItem_CTS = async (req, res) => {
  const ventaId = normInt(req.params.ventaId);
  const itemId = normInt(req.params.itemId);

  if (!Number.isFinite(ventaId) || !Number.isFinite(itemId)) {
    return res.status(400).json({
      code: 'BAD_REQUEST',
      mensajeError: 'IDs inválidos.'
    });
  }

  const t = await db.transaction();
  try {
    await assertVentaEditable(ventaId, t);

    const item = await VentasDetalleModel.findOne({
      where: { id: itemId, venta_id: ventaId },
      transaction: t
    });

    if (!item) {
      const e = new Error('ITEM_NO_ENCONTRADO');
      e.status = 404;
      throw e;
    }

    await item.destroy({ transaction: t });
    await recalcVentaTotal(ventaId, t);
    await t.commit();

    return res.status(204).send();
  } catch (err) {
    try {
      if (!t.finished) await t.rollback();
    } catch {}

    console.error('ER_VentasItem_CTS error:', err);
    return buildDetalleError(res, err, 'No se pudo eliminar el ítem.');
  }
};

// ===============================
// POST /ventas/:ventaId/items/replace  (reemplaza todo el detalle)
// ===============================
export const RP_VentasItems_CTS = async (req, res) => {
  const ventaId = normInt(req.params.ventaId);
  if (!Number.isFinite(ventaId)) {
    return res.status(400).json({
      code: 'BAD_REQUEST',
      mensajeError: 'ventaId inválido.'
    });
  }

  const rawPayload = Array.isArray(req.body) ? req.body : req.body?.items;
  if (!Array.isArray(rawPayload) || rawPayload.length === 0) {
    return res.status(400).json({
      code: 'BAD_REQUEST',
      mensajeError: 'Se requiere al menos un ítem.'
    });
  }

  // Validar forma de ítems antes de abrir transacción
  let rows;
  try {
    rows = rawPayload.map((it, i) => ({
      ...validarItemShape(it, i),
      venta_id: ventaId
    }));
  } catch (err) {
    return buildDetalleError(res, err, 'Ítems inválidos.');
  }

  const t = await db.transaction();
  try {
    await assertVentaEditable(ventaId, t);

    await VentasDetalleModel.destroy({
      where: { venta_id: ventaId },
      transaction: t
    });

    await VentasDetalleModel.bulkCreate(rows, { transaction: t });

    await recalcVentaTotal(ventaId, t);
    await t.commit();

    const items = await VentasDetalleModel.findAll({
      where: { venta_id: ventaId },
      order: [['id', 'ASC']]
    });

    return res.json({ data: items });
  } catch (err) {
    try {
      if (!t.finished) await t.rollback();
    } catch {}

    console.error('RP_VentasItems_CTS error:', err);
    return buildDetalleError(
      res,
      err,
      'No se pudo reemplazar el detalle.'
    );
  }
};
