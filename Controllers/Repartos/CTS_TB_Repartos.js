/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 29 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 *  Controladores CRUD para 'repartos' con paginación flexible:
 *  - Filtros por ciudad, estado y búsqueda por nombre/observaciones.
 *  - Ordenamiento con whitelist.
 *  - Soporte para keyset u offset classic.
 *  - Creación con opción de calcular rango automáticamente a partir de una capacidad.
 *
 * Tema: Controladores - Repartos
 * Capa: Backend
 */

import { RepartosModel } from '../../Models/Repartos/MD_TB_Repartos.js';
import { CiudadesModel } from '../../Models/Geografia/MD_TB_Ciudades.js';
import { Op } from 'sequelize';

// ---------- Helpers ----------

// Devuelve true si hay algún reparto en esa ciudad cuyo rango se solape
async function existeRangoSolapado({ ciudad_id, rango_min, rango_max, excluirId = null }) {
  const where = {
    ciudad_id,
    rango_min: { [Op.lte]: rango_max },
    rango_max: { [Op.gte]: rango_min }
  };

  if (excluirId) {
    where.id = { [Op.ne]: excluirId };
  }

  const conflict = await RepartosModel.findOne({ where });
  return conflict;
}

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
  'nombre',
  'ciudad_id',
  'rango_min',
  'rango_max',
  'estado',
  'created_at',
  'updated_at'
]);

const sanitizeOrder = (orderBy = 'created_at', orderDir = 'DESC') => {
  const col = ORDER_WHITELIST.has(orderBy) ? orderBy : 'created_at';
  const dir =
    String(orderDir || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  return [col, dir];
};

// ---------- LISTAR (GET /repartos) ----------
export const OBRS_Repartos_CTS = async (req, res) => {
  try {
    const {
      q,
      ciudad_id,
      estado,
      // paginación
      page,
      pageSize,
      limit,
      offset,
      mode,
      last_id,
      // orden
      orderBy,
      orderDir,
      count = '1',
      // includes
      withCiudad = '1'
    } = req.query;

    const [col, dir] = sanitizeOrder(orderBy, orderDir);

    const where = {};

    if (q && String(q).trim() !== '') {
      const like = `%${String(q).trim()}%`;
      where[Op.or] = [
        { nombre: { [Op.like]: like } },
        { observaciones: { [Op.like]: like } }
      ];
    }

    const ciudadIdInt = toInt(ciudad_id, 0);
    if (ciudadIdInt > 0) {
      where.ciudad_id = ciudadIdInt;
    }

    if (estado) {
      where.estado = estado; // 'activo' | 'inactivo'
    }

    // Paginación
    const useKeyset = String(mode).toLowerCase() === 'keyset';
    const lim = Math.max(1, toInt(limit ?? pageSize ?? 20, 20));

    let off = 0;

    if (useKeyset) {
      if (last_id) {
        where.id =
          dir === 'DESC'
            ? { [Op.lt]: toInt(last_id, 0) }
            : { [Op.gt]: toInt(last_id, 0) };
      }
    } else {
      if (offset !== undefined) {
        off = Math.max(0, toInt(offset, 0));
      } else if (page !== undefined) {
        const p = Math.max(1, toInt(page, 1));
        const ps = Math.max(1, toInt(pageSize ?? lim, lim));
        off = (p - 1) * ps;
      }
    }

    let total = null;
    if (!useKeyset && String(count) !== '0') {
      total = await RepartosModel.count({ where });
    }

    const include = [];
    if (String(withCiudad) === '1') {
      include.push({ model: CiudadesModel, as: 'ciudad' });
    }

    const rows = await RepartosModel.findAll({
      where,
      include,
      order: [[col, dir], ...(col === 'id' ? [] : [['id', 'DESC']])],
      limit: lim,
      offset: useKeyset ? undefined : off
    });

    let hasNext = false;
    let nextOffset = null;
    let nextCursor = null;
    let pageMeta = null;

    if (useKeyset) {
      hasNext = rows.length === lim;
      nextCursor = hasNext ? rows[rows.length - 1]?.id : null;
    } else {
      const usedTotal = total ?? 0;
      hasNext = off + rows.length < usedTotal;
      nextOffset = hasNext ? off + lim : null;

      if (page !== undefined || pageSize !== undefined) {
        const ps = Math.max(1, toInt(pageSize ?? lim, lim));
        const p = Math.floor(off / ps) + 1;
        const totalPages = usedTotal > 0 ? Math.ceil(usedTotal / ps) : 1;
        pageMeta = { page: p, pageSize: ps, totalPages };
      }
    }

    return res.json({
      data: rows,
      meta: {
        mode: useKeyset ? 'keyset' : 'offset',
        orderBy: col,
        orderDir: dir,
        total,
        limit: lim,
        offset: useKeyset ? undefined : off,
        hasNext,
        nextOffset,
        nextCursor,
        ...pageMeta
      }
    });
  } catch (error) {
    console.error('Error al listar repartos:', error);
    return res.status(500).json({
      mensajeError: 'Ocurrió un error al obtener los repartos',
      detalles: error?.message || error
    });
  }
};

// ---------- OBTENER UNO (GET /repartos/:id) ----------
export const OBR_Reparto_CTS = async (req, res) => {
  try {
    const { withCiudad = '1' } = req.query;

    const include = [];
    if (String(withCiudad) === '1') {
      include.push({ model: CiudadesModel, as: 'ciudad' });
    }

    const reparto = await RepartosModel.findByPk(req.params.id, { include });

    if (!reparto) {
      return res.status(404).json({ mensajeError: 'Reparto no encontrado' });
    }

    return res.json(reparto);
  } catch (error) {
    console.error('Error al obtener reparto:', error);
    return res.status(500).json({ mensajeError: error?.message || error });
  }
};

// ---------- CREAR (POST /repartos) ----------
export const CR_Reparto_CTS = async (req, res) => {
  try {
    const permitidos = [
      'ciudad_id',
      'nombre',
      'rango_min',
      'rango_max',
      'estado',
      'observaciones'
    ];

    const data = {};
    for (const k of permitidos) if (k in req.body) data[k] = req.body[k];

    const payload = stripEmpty(data);

    const ciudad_id = Number(payload.ciudad_id);
    const rango_min = Number(payload.rango_min);
    const rango_max = Number(payload.rango_max);

    if (!Number.isFinite(ciudad_id)) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'La ciudad es obligatoria'
      });
    }
    if (!Number.isFinite(rango_min) || !Number.isFinite(rango_max)) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'Los rangos deben ser numéricos'
      });
    }
    if (rango_min < 0 || rango_max < 0) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'Los rangos no pueden ser negativos'
      });
    }
    if (rango_max < rango_min) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'rango_max debe ser mayor o igual a rango_min'
      });
    }

    // 🔍 Validar que en esa ciudad no haya rango solapado
    const conflict = await existeRangoSolapado({
      ciudad_id,
      rango_min,
      rango_max
    });

    if (conflict) {
      return res.status(409).json({
        code: 'DUPLICATE',
        mensajeError:
          `Ya existe un reparto en esta ciudad cuyo rango de clientes ` +
          `(${conflict.rango_min}–${conflict.rango_max}) se superpone con el rango ingresado (${rango_min}–${rango_max}).`,
        tips: [
          'Ajustá el rango para que no se solape con otros repartos de la misma ciudad.',
          'Ejemplo: si uno va de 1 a 300, el siguiente podría ir de 301 a 600.'
        ]
      });
    }

    // Defaults sanos
    if (!payload.estado) payload.estado = 'activo';

    const creado = await RepartosModel.create({
      ...payload,
      ciudad_id,
      rango_min,
      rango_max
    });

    return res.json({
      message: 'Reparto creado correctamente',
      reparto: creado
    });
  } catch (error) {
    console.error('Error al crear reparto:', error);
    return res.status(400).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo crear el reparto',
      detalles: error?.errors || error?.message || String(error)
    });
  }
};


// ---------- ACTUALIZAR (PUT /repartos/:id) ----------
export const UR_Reparto_CTS = async (req, res) => {
  try {
    const { id } = req.params;
    const existente = await RepartosModel.findByPk(id);
    if (!existente) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Reparto no encontrado'
      });
    }

    const permitidos = [
      'ciudad_id',
      'nombre',
      'rango_min',
      'rango_max',
      'estado',
      'observaciones'
    ];

    const base = {};
    for (const k of permitidos) if (k in req.body) base[k] = req.body[k];
    const payload = stripEmpty(base);

    // Si están tocando ciudad o rangos, validamos coherencia y solapamiento
    const ciudad_id = payload.ciudad_id
      ? Number(payload.ciudad_id)
      : Number(existente.ciudad_id);
    const rango_min =
      payload.rango_min != null
        ? Number(payload.rango_min)
        : Number(existente.rango_min);
    const rango_max =
      payload.rango_max != null
        ? Number(payload.rango_max)
        : Number(existente.rango_max);

    if (!Number.isFinite(ciudad_id)) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'La ciudad es obligatoria'
      });
    }
    if (!Number.isFinite(rango_min) || !Number.isFinite(rango_max)) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'Los rangos deben ser numéricos'
      });
    }
    if (rango_min < 0 || rango_max < 0) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'Los rangos no pueden ser negativos'
      });
    }
    if (rango_max < rango_min) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'rango_max debe ser mayor o igual a rango_min'
      });
    }

    const conflict = await existeRangoSolapado({
      ciudad_id,
      rango_min,
      rango_max,
      excluirId: Number(id)
    });

    if (conflict) {
      return res.status(409).json({
        code: 'DUPLICATE',
        mensajeError:
          `Ya existe otro reparto en esta ciudad cuyo rango de clientes ` +
          `(${conflict.rango_min}–${conflict.rango_max}) se superpone con el rango ingresado (${rango_min}–${rango_max}).`,
        tips: [
          'Ajustá el rango para que no se solape con otros repartos de la misma ciudad.',
          'Podés dividir la zona en subrangos contiguos sin superponerlos.'
        ]
      });
    }

    const [updated] = await RepartosModel.update(
      {
        ...payload,
        ciudad_id,
        rango_min,
        rango_max
      },
      {
        where: { id },
        fields: Object.keys({
          ...payload,
          ciudad_id,
          rango_min,
          rango_max
        })
      }
    );

    if (updated !== 1) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Reparto no encontrado o sin cambios'
      });
    }

    const actualizado = await RepartosModel.findByPk(id);
    return res.json({
      message: 'Reparto actualizado correctamente',
      reparto: actualizado
    });
  } catch (error) {
    console.error('Error al actualizar reparto:', error);
    return res.status(400).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo actualizar el reparto',
      detalles: error?.errors || error?.message || String(error)
    });
  }
};


// ---------- ELIMINAR (DELETE /repartos/:id) ----------
export const ER_Reparto_CTS = async (req, res) => {
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

    const existe = await RepartosModel.findByPk(id);
    if (!existe) {
      return res
        .status(404)
        .json({ code: 'NOT_FOUND', mensajeError: 'Reparto no encontrado' });
    }

    // HARD DELETE
    if (!soft) {
      try {
        const deleted = await RepartosModel.destroy({
          where: { id },
          limit: 1
        });

        if (deleted === 0) {
          return res.status(404).json({
            code: 'NOT_FOUND',
            mensajeError: 'No se pudo eliminar (ya no existe)'
          });
        }

        return res.status(200).json({
          code: 'DELETED',
          message: 'Reparto eliminado correctamente.'
        });
      } catch (err) {
        console.error('Error al hacer hard delete de reparto:', err);

        const sqlMsg =
          err?.original?.sqlMessage ||
          err?.parent?.sqlMessage ||
          err?.message ||
          '';

        // 🔸 Caso específico: FK en reparto_clientes
        if (
          err?.name === 'SequelizeForeignKeyConstraintError' ||
          sqlMsg.includes('`reparto_clientes`') ||
          sqlMsg.includes('fk_repcli_reparto')
        ) {
          return res.status(409).json({
            code: 'REPARTO_TIENE_CLIENTES',
            mensajeError:
              'No se puede eliminar el reparto porque tiene clientes asociados. ' +
              'Primero quitá los clientes del reparto y volvé a intentarlo.',
            tips: [
              'Hace click en "Ver Clientes" del reparto.',
              'Quitá todos los clientes asignados antes de eliminarlo.'
            ]
          });
        }

        // 🔸 Otros errores de FK (usuarios, días, etc.)
        if (err?.name === 'SequelizeForeignKeyConstraintError') {
          return res.status(409).json({
            code: 'REPARTO_TIENE_RELACIONES',
            mensajeError:
              'No se puede eliminar el reparto porque tiene registros asociados (clientes, usuarios o días).',
            tips: [
              'Verificá que no tenga usuarios asignados al reparto.',
              'Verificá que no tenga días/turnos configurados.',
              'Eliminá o limpiá esas relaciones antes de borrar el reparto.'
            ]
          });
        }

        // Fallback genérico
        return res.status(500).json({
          code: 'SERVER_ERROR',
          mensajeError: sqlMsg || 'Error al eliminar el reparto.'
        });
      }
    }

    // SOFT DELETE (estado = inactivo)
    const [upd] = await RepartosModel.update(
      { estado: 'inactivo' },
      { where: { id }, limit: 1 }
    );

    const inactivado = await RepartosModel.findByPk(id);
    return res.json({
      message: 'Reparto dado de baja (estado=inactivo)',
      reparto: inactivado
    });
  } catch (error) {
    console.error('Error al eliminar reparto:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: error?.message || String(error)
    });
  }
};


// ---------- Cambiar estado (PATCH /repartos/:id/estado) ----------
export const UR_Reparto_Estado_CTS = async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    if (!['activo', 'inactivo'].includes(String(estado))) {
      return res.status(400).json({ mensajeError: 'Estado inválido' });
    }

    const [n] = await RepartosModel.update({ estado }, { where: { id } });
    if (n !== 1) {
      return res.status(404).json({ mensajeError: 'Reparto no encontrado' });
    }

    const reparto = await RepartosModel.findByPk(id);
    return res.json({ message: 'Estado actualizado', reparto });
  } catch (error) {
    console.error('Error al cambiar estado de reparto:', error);
    return res.status(500).json({ mensajeError: error?.message || error });
  }
};

export default {
  OBRS_Repartos_CTS,
  OBR_Reparto_CTS,
  CR_Reparto_CTS,
  UR_Reparto_CTS,
  ER_Reparto_CTS,
  UR_Reparto_Estado_CTS
};
