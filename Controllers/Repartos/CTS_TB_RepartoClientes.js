/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 29 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 *  Controladores CRUD para 'reparto_clientes'.
 *  - Permite listar asignaciones por reparto y/o cliente.
 *  - Asigna numero_rango automáticamente dentro del rango del reparto si no se indica.
 *
 * Tema: Controladores - Repartos
 * Capa: Backend
 */

import { RepartoClientesModel } from '../../Models/Repartos/MD_TB_RepartoClientes.js';
import { RepartosModel } from '../../Models/Repartos/MD_TB_Repartos.js';
import { ClientesModel } from '../../Models/Clientes/MD_TB_Clientes.js';
import { Op } from 'sequelize';
import db from '../../DataBase/db.js';

const stripEmpty = (obj = {}) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = v;
  }
  return out;
};

const toInt = (v, def = 0) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
};

const ORDER_WHITELIST = new Set([
  'id',
  'reparto_id',
  'cliente_id',
  'numero_rango',
  'estado',
  'created_at',
  'updated_at'
]);

const sanitizeOrder = (orderBy = 'numero_rango', orderDir = 'ASC') => {
  const col = ORDER_WHITELIST.has(orderBy) ? orderBy : 'numero_rango';
  const dir =
    String(orderDir || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  return [col, dir];
};

// ---------- LISTAR (GET /repartos-clientes) ----------
export const OBRS_RepartoClientes_CTS = async (req, res) => {
  try {
    const {
      reparto_id,
      cliente_id,
      estado,
      q,
      page,
      pageSize,
      limit,
      offset,
      orderBy,
      orderDir,
      count = '1',
      withReparto = '1',
      withCliente = '1'
    } = req.query;

    const [col, dir] = sanitizeOrder(orderBy, orderDir);

    const where = {};

    const rid = toInt(reparto_id, 0);
    if (rid > 0) where.reparto_id = rid;

    const cid = toInt(cliente_id, 0);
    if (cid > 0) where.cliente_id = cid;

    if (estado) where.estado = estado;

    if (q && String(q).trim() !== '') {
      // Búsqueda básica por numero_rango o id cliente
      const qTrim = String(q).trim();
      const n = toInt(qTrim, NaN);
      if (Number.isFinite(n)) {
        where[Op.or] = [
          { numero_rango: n },
          { cliente_id: n },
          { reparto_id: n }
        ];
      }
    }

    const lim = Math.max(1, toInt(limit ?? pageSize ?? 50, 50));
    let off = 0;

    if (offset !== undefined) {
      off = Math.max(0, toInt(offset, 0));
    } else if (page !== undefined) {
      const p = Math.max(1, toInt(page, 1));
      const ps = Math.max(1, toInt(pageSize ?? lim, lim));
      off = (p - 1) * ps;
    }

    let total = null;
    if (String(count) !== '0') {
      total = await RepartoClientesModel.count({ where });
    }

    const include = [];
    if (String(withReparto) === '1') {
      include.push({ model: RepartosModel, as: 'reparto' });
    }
    if (String(withCliente) === '1') {
      include.push({ model: ClientesModel, as: 'cliente' });
    }

    const rows = await RepartoClientesModel.findAll({
      where,
      include,
      order: [[col, dir], ...(col === 'id' ? [] : [['id', 'ASC']])],
      limit: lim,
      offset: off
    });

    const usedTotal = total ?? rows.length;
    const hasNext = off + rows.length < usedTotal;
    const ps = Math.max(1, toInt(pageSize ?? lim, lim));
    const p = Math.floor(off / ps) + 1;
    const totalPages = usedTotal > 0 ? Math.ceil(usedTotal / ps) : 1;

    return res.json({
      data: rows,
      meta: {
        total: usedTotal,
        limit: lim,
        offset: off,
        hasNext,
        page: p,
        pageSize: ps,
        totalPages,
        orderBy: col,
        orderDir: dir
      }
    });
  } catch (error) {
    console.error('Error al listar reparto_clientes:', error);
    return res.status(500).json({
      mensajeError: 'Ocurrió un error al obtener las asignaciones de reparto',
      detalles: error?.message || error
    });
  }
};

// ---------- OBTENER UNO (GET /repartos-clientes/:id) ----------
export const OBR_RepartoCliente_CTS = async (req, res) => {
  try {
    const { withReparto = '1', withCliente = '1' } = req.query;

    const include = [];
    if (String(withReparto) === '1') {
      include.push({ model: RepartosModel, as: 'reparto' });
    }
    if (String(withCliente) === '1') {
      include.push({ model: ClientesModel, as: 'cliente' });
    }

    const fila = await RepartoClientesModel.findByPk(req.params.id, {
      include
    });

    if (!fila) {
      return res
        .status(404)
        .json({ mensajeError: 'Asignación de reparto no encontrada' });
    }

    return res.json(fila);
  } catch (error) {
    console.error('Error al obtener reparto_cliente:', error);
    return res.status(500).json({ mensajeError: error?.message || error });
  }
};

// ---------- CREAR (POST /repartos-clientes) ----------
export const CR_RepartoCliente_CTS = async (req, res) => {
  try {
    const { reparto_id, cliente_id, numero_rango, estado } = req.body;

    const rid = toInt(reparto_id, 0);
    const cid = toInt(cliente_id, 0);

    if (!rid || !cid) {
      return res.status(400).json({
        mensajeError: 'Se requiere reparto_id y cliente_id válidos'
      });
    }

    const reparto = await RepartosModel.findByPk(rid);
    if (!reparto) {
      return res
        .status(400)
        .json({ mensajeError: 'Reparto inexistente (reparto_id inválido)' });
    }

    let num = numero_rango !== undefined ? toInt(numero_rango, 0) : null;

    // Si no mandan numero_rango, asignamos automáticamente
    if (!num) {
      const maxActual = await RepartoClientesModel.max('numero_rango', {
        where: { reparto_id: rid }
      });

      if (maxActual === null || maxActual === undefined) {
        num = reparto.rango_min;
      } else {
        num = Number(maxActual) + 1;
      }
    }

    if (num < reparto.rango_min || num > reparto.rango_max) {
      return res.status(400).json({
        mensajeError: `El número de rango (${num}) está fuera del rango permitido para este reparto (${reparto.rango_min}–${reparto.rango_max}).`
      });
    }

    const payload = stripEmpty({
      reparto_id: rid,
      cliente_id: cid,
      numero_rango: num,
      estado: estado || 'activo'
    });

    const creado = await RepartoClientesModel.create(payload);

    return res.json({
      message: 'Cliente asignado al reparto correctamente',
      reparto_cliente: creado
    });
  } catch (error) {
    console.error('Error al crear reparto_cliente:', error);
    return res.status(400).json({
      mensajeError: 'No se pudo asignar el cliente al reparto',
      detalles: error?.errors || error?.message || error
    });
  }
};

// ---------- ACTUALIZAR (PUT /repartos-clientes/:id) ----------
export const UR_RepartoCliente_CTS = async (req, res) => {
  try {
    const { id } = req.params;
    const existente = await RepartoClientesModel.findByPk(id, {
      include: [{ model: RepartosModel, as: 'reparto' }]
    });

    if (!existente) {
      return res
        .status(404)
        .json({ mensajeError: 'Asignación de reparto no encontrada' });
    }

    const permitidos = ['numero_rango', 'estado'];
    const base = {};
    for (const k of permitidos) {
      if (k in req.body) base[k] = req.body[k];
    }

    const payload = stripEmpty(base);

    if ('numero_rango' in payload) {
      const num = toInt(payload.numero_rango, 0);
      if (
        num < existente.reparto.rango_min ||
        num > existente.reparto.rango_max
      ) {
        return res.status(400).json({
          mensajeError: `El número de rango (${num}) está fuera del rango permitido para este reparto (${existente.reparto.rango_min}–${existente.reparto.rango_max}).`
        });
      }
      payload.numero_rango = num;
    }

    const [updated] = await RepartoClientesModel.update(payload, {
      where: { id },
      fields: Object.keys(payload)
    });

    if (updated !== 1) {
      return res.status(404).json({
        mensajeError: 'Asignación no encontrada o sin cambios'
      });
    }

    const actualizado = await RepartoClientesModel.findByPk(id);
    return res.json({
      message: 'Asignación actualizada correctamente',
      reparto_cliente: actualizado
    });
  } catch (error) {
    console.error('Error al actualizar reparto_cliente:', error);
    return res.status(400).json({
      mensajeError: 'No se pudo actualizar la asignación',
      detalles: error?.errors || error?.message || error
    });
  }
};

// ---------- ELIMINAR (DELETE /repartos-clientes/:id) ----------
export const ER_RepartoCliente_CTS = async (req, res) => {
  try {
    const id = toInt(req.params.id, 0);
    const soft = ['1', 'true', 'si', 'sí', 'soft'].includes(
      String(req.query.soft || '').toLowerCase()
    );

    if (!id) {
      return res
        .status(400)
        .json({ code: 'BAD_REQUEST', mensajeError: 'ID inválido' });
    }

    const existe = await RepartoClientesModel.findByPk(id);
    if (!existe) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Asignación de reparto no encontrada'
      });
    }

    if (!soft) {
      const deleted = await RepartoClientesModel.destroy({
        where: { id },
        limit: 1
      });
      if (deleted === 0) {
        return res.status(404).json({
          code: 'NOT_FOUND',
          mensajeError: 'No se pudo eliminar (ya no existe)'
        });
      }
      return res.status(204).send();
    }

    const [upd] = await RepartoClientesModel.update(
      { estado: 'inactivo' },
      { where: { id }, limit: 1 }
    );

    const inactivado = await RepartoClientesModel.findByPk(id);
    return res.json({
      message: 'Asignación dada de baja (estado=inactivo)',
      reparto_cliente: inactivado
    });
  } catch (error) {
    console.error('Error al eliminar reparto_cliente:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: error?.message || String(error)
    });
  }
};

// ---------- Cambiar estado (PATCH /repartos-clientes/:id/estado) ----------
export const UR_RepartoCliente_Estado_CTS = async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    if (!['activo', 'inactivo'].includes(String(estado))) {
      return res.status(400).json({ mensajeError: 'Estado inválido' });
    }

    const [n] = await RepartoClientesModel.update(
      { estado },
      { where: { id } }
    );
    if (n !== 1) {
      return res.status(404).json({
        mensajeError: 'Asignación de reparto no encontrada'
      });
    }

    const fila = await RepartoClientesModel.findByPk(id);
    return res.json({ message: 'Estado actualizado', reparto_cliente: fila });
  } catch (error) {
    console.error('Error al cambiar estado reparto_cliente:', error);
    return res.status(500).json({ mensajeError: error?.message || error });
  }
};

/**
 * Asignación MASIVA de clientes a un reparto.
 *
 * POST /repartos/:id/asignar-clientes
 * body:
 *   - cliente_ids: number[] (obligatorio)
 *   - reset?: boolean (opcional) → si true, borra asignaciones previas del reparto antes de asignar
 *
 * Reglas:
 *   - Respeta rango_min / rango_max del reparto.
 *   - No duplica cliente en el mismo reparto.
 *   - Asigna numero_rango con el primer hueco libre dentro del rango.
 */
export const CR_Reparto_AsignarClientesMasivo_CTS = async (req, res) => {
  const repartoId = Number.parseInt(req.params.id, 10);
  const { cliente_ids, reset } = req.body || {};

  if (!Number.isFinite(repartoId)) {
    return res.status(400).json({
      code: 'BAD_REQUEST',
      mensajeError: 'ID de reparto inválido.'
    });
  }

  if (!Array.isArray(cliente_ids) || cliente_ids.length === 0) {
    return res.status(400).json({
      code: 'BAD_REQUEST',
      mensajeError: 'Debe enviar al menos un cliente en cliente_ids.'
    });
  }

  const t = await db.transaction();

  const safeRollback = async () => {
    // Sequelize setea t.finished = 'commit' | 'rollback' cuando termina
    if (!t.finished) await t.rollback();
  };

  try {
    // 1) Validar reparto
    const reparto = await RepartosModel.findByPk(repartoId, { transaction: t });
    if (!reparto) {
      await safeRollback();
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Reparto no encontrado.'
      });
    }

    const rangoMin = Number(reparto.rango_min);
    const rangoMax = Number(reparto.rango_max);
    const capacidadTotal = rangoMax - rangoMin + 1;

    if (
      !Number.isFinite(rangoMin) ||
      !Number.isFinite(rangoMax) ||
      capacidadTotal <= 0
    ) {
      await safeRollback();
      return res.status(400).json({
        code: 'RANGO_INVALIDO',
        mensajeError: 'El rango del reparto no es válido.'
      });
    }

    // 2) limpiar asignaciones previas
    if (reset === true || reset === 'true' || reset === 1 || reset === '1') {
      await RepartoClientesModel.destroy({
        where: { reparto_id: repartoId },
        transaction: t
      });
    }

    // 3) Traer asignaciones existentes 
    const existentes = await RepartoClientesModel.findAll({
      where: { reparto_id: repartoId },
      attributes: ['id', 'numero_rango', 'cliente_id', 'estado'],
      order: [['numero_rango', 'ASC']],
      transaction: t,
      lock: t.LOCK.UPDATE
    });

    // Consideramos "ocupados" solo los ACTIVOS
    const usados = new Set(
      existentes
        .filter((x) => String(x.estado || '').toLowerCase() === 'activo')
        .map((x) => Number(x.numero_rango))
        .filter((n) => Number.isFinite(n))
    );

    const byCliente = new Map();
    for (const x of existentes) {
      byCliente.set(Number(x.cliente_id), x);
    }

    const candidatos = cliente_ids
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x));

    // Clasificar: nuevos / reactivar / ya activos
    const nuevos = [];
    const aReactivar = [];
    const yaActivos = [];

    for (const idCli of candidatos) {
      const row = byCliente.get(idCli);

      if (!row) {
        nuevos.push(idCli);
        continue;
      }

      const est = String(row.estado || '').toLowerCase();
      if (est === 'activo') yaActivos.push(idCli);
      else aReactivar.push(row);
    }

    const libresIniciales = capacidadTotal - usados.size;
    const necesarios = nuevos.length + aReactivar.length;

    if (necesarios === 0) {
      await safeRollback();
      return res.status(400).json({
        code: 'ALREADY_ASSIGNED',
        mensajeError:
          'Todos los clientes seleccionados ya están asignados a este reparto.'
      });
    }

    if (necesarios > libresIniciales) {
      await safeRollback();
      return res.status(400).json({
        code: 'CAPACITY_EXCEEDED',
        mensajeError:
          'No hay espacio suficiente en el rango del reparto para todos los clientes seleccionados.',
        tips: [
          `Capacidad total del rango: ${capacidadTotal}`,
          `Actualmente usados (activos): ${usados.size}`,
          `Libres: ${libresIniciales}`,
          `Nuevos a crear: ${nuevos.length}`,
          `A reactivar: ${aReactivar.length}`,
          `Total a activar: ${necesarios}`
        ]
      });
    }

    const tomarHuecoLibre = () => {
      for (let n = rangoMin; n <= rangoMax; n++) {
        if (!usados.has(n)) {
          usados.add(n);
          return n;
        }
      }
      return null;
    };

    const asignados = [];
    const reactivados = [];

    // 4) Reactivar: si su numero_rango viejo está libre y dentro del rango, lo reusa;
    // si no, asigna uno nuevo libre.
    for (const row of aReactivar) {
      let nro = Number(row.numero_rango);

      const nroOk =
        Number.isFinite(nro) &&
        nro >= rangoMin &&
        nro <= rangoMax &&
        !usados.has(nro);

      if (!nroOk) {
        nro = tomarHuecoLibre();
      } else {
        usados.add(nro);
      }

      if (nro == null) {
        // seguridad extra (no debería pasar si ya validamos capacidad)
        throw new Error('No se encontró hueco libre para reactivación.');
      }

      await row.update(
        { estado: 'activo', numero_rango: nro },
        { transaction: t }
      );

      reactivados.push(row);
    }

    // 5) Crear nuevos
    for (const idCli of nuevos) {
      const numero_rango = tomarHuecoLibre();
      if (numero_rango == null) break;

      const nuevo = await RepartoClientesModel.create(
        {
          reparto_id: repartoId,
          cliente_id: idCli,
          numero_rango,
          estado: 'activo'
        },
        { transaction: t }
      );

      asignados.push(nuevo);
    }

    // 6) Respuesta (armar antes del commit)
    const payload = {
      ok: true,
      message: 'Clientes procesados correctamente para el reparto.',
      meta: {
        reparto_id: repartoId,
        solicitados: candidatos.length,
        creados: asignados.length,
        reactivados: reactivados.length,
        yaActivos: yaActivos.length,
        rango_min: rangoMin,
        rango_max: rangoMax
      },
      asignados,
      reactivados,
      yaActivos
    };

    await t.commit();
    return res.json(payload);
  } catch (err) {
    console.error('CR_Reparto_AsignarClientesMasivo_CTS error:', err);
    await safeRollback();

    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'Error asignando clientes al reparto.',
      detalles: err?.message || String(err)
    });
  }
};


export default {
  OBRS_RepartoClientes_CTS,
  OBR_RepartoCliente_CTS,
  CR_RepartoCliente_CTS,
  UR_RepartoCliente_CTS,
  ER_RepartoCliente_CTS,
  UR_RepartoCliente_Estado_CTS,
  CR_Reparto_AsignarClientesMasivo_CTS
};
