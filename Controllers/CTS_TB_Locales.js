/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 21 / 06 / 2025
 * Versión: 1.0
 *
 * Descripción:
 * Este archivo (CTS_TB_Locales.js) contiene controladores para manejar operaciones CRUD sobre la tabla de locales.
 *
 * Tema: Controladores - Locales
 *
 * Capa: Backend
 *
 * Nomenclatura:
 *   OBR_  obtenerRegistro
 *   OBRS_ obtenerRegistros
 *   CR_   crearRegistro
 *   ER_   eliminarRegistro
 *   UR_   actualizarRegistro
 */

// Importar el modelo
import MD_TB_Locales from '../Models/MD_TB_Locales.js';
const LocalesModel = MD_TB_Locales.LocalesModel;
import { Op } from 'sequelize';

// Obtener todos los locales
export const OBRS_Locales_CTS = async (req, res) => {
  try {
    const { page, limit, q, orderBy, orderDir } = req.query || {};

    // ⚠️ Retrocompat: SIN params => array plano (como antes)
    const hasParams =
      Object.prototype.hasOwnProperty.call(req.query, 'page') ||
      Object.prototype.hasOwnProperty.call(req.query, 'limit') ||
      Object.prototype.hasOwnProperty.call(req.query, 'q') ||
      Object.prototype.hasOwnProperty.call(req.query, 'orderBy') ||
      Object.prototype.hasOwnProperty.call(req.query, 'orderDir');

    if (!hasParams) {
      const locales = await LocalesModel.findAll({ order: [['id', 'ASC']] });
      return res.json(locales);
    }

    // ✅ Paginado + filtros + orden
    const pageNum = Math.max(parseInt(page || '1', 10), 1);
    const limitNum = Math.min(Math.max(parseInt(limit || '20', 10), 1), 100);
    const offset = (pageNum - 1) * limitNum;

    const where = {};
    if (q && q.trim() !== '') {
      const like = { [Op.like]: `%${q.trim()}%` };
      where[Op.or] = [
        { nombre: like },
        { codigo: like },
        { ciudad: like },
        { provincia: like },
        { direccion: like },
        { telefono: like },
        { email: like },
        { responsable_nombre: like },
        { responsable_dni: like }
      ];
    }

    const validColumns = [
      'id',
      'nombre',
      'codigo',
      'ciudad',
      'provincia',
      'created_at',
      'updated_at'
    ];
    const col = validColumns.includes(orderBy || '') ? orderBy : 'id';
    const dir = ['ASC', 'DESC'].includes(String(orderDir || '').toUpperCase())
      ? String(orderDir).toUpperCase()
      : 'ASC';

    const { rows, count } = await LocalesModel.findAndCountAll({
      where,
      order: [[col, dir]],
      limit: limitNum,
      offset
    });

    const totalPages = Math.max(Math.ceil(count / limitNum), 1);

    return res.json({
      data: rows,
      meta: {
        total: count,
        page: pageNum,
        limit: limitNum,
        totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
        orderBy: col,
        orderDir: dir,
        q: q || ''
      }
    });
  } catch (error) {
    res.status(500).json({ mensajeError: error.message });
  }
};

// Obtener un solo local por ID
export const OBR_Local_CTS = async (req, res) => {
  try {
    const local = await LocalesModel.findByPk(req.params.id);
    if (!local) {
      return res.status(404).json({ mensajeError: 'Local no encontrado' });
    }
    res.json(local);
  } catch (error) {
    res.status(500).json({ mensajeError: error.message });
  }
};
// Crear un nuevo local
export const CR_Local_CTS = async (req, res) => {
  const { nombre, direccion, telefono, usuario_log_id } = req.body;

  if (!nombre) {
    return res
      .status(400)
      .json({ mensajeError: 'El nombre del local es obligatorio' });
  }

  try {
    const nuevo = await LocalesModel.create({ nombre, direccion, telefono });

    res.json({ message: 'Local creado correctamente', local: nuevo });
  } catch (error) {
    res.status(500).json({ mensajeError: error.message });
  }
};

// Eliminar un local
export const ER_Local_CTS = async (req, res) => {
  const { usuario_log_id } = req.body;

  try {
    const local = await LocalesModel.findByPk(req.params.id);

    if (!local) {
      return res.status(404).json({ mensajeError: 'Local no encontrado' });
    }

    await LocalesModel.destroy({ where: { id: req.params.id } });

    res.json({ message: 'Local eliminado correctamente' });
  } catch (error) {
    res.status(500).json({ mensajeError: error.message });
  }
};

// Actualizar un local
export const UR_Local_CTS = async (req, res) => {
  const { id } = req.params;
  const { usuario_log_id } = req.body;

  try {
    const localAnterior = await LocalesModel.findByPk(id);
    if (!localAnterior) {
      return res.status(404).json({ mensajeError: 'Local no encontrado' });
    }

    const camposAuditar = [
      'nombre',
      'codigo',
      'direccion',
      'ciudad',
      'provincia',
      'telefono',
      'email',
      'responsable_nombre',
      'responsable_dni',
      'horario_apertura',
      'horario_cierre',
      'printer_nombre',
      'estado'
    ];

    const cambios = [];

    for (const key of camposAuditar) {
      if (
        req.body[key] !== undefined &&
        req.body[key]?.toString() !== localAnterior[key]?.toString()
      ) {
        cambios.push(
          `cambió el campo "${key}" de "${localAnterior[key]}" a "${req.body[key]}"`
        );
      }
    }

    const [updated] = await LocalesModel.update(req.body, {
      where: { id }
    });

    if (updated === 1) {
      const actualizado = await LocalesModel.findByPk(id);

      res.json({ message: 'Local actualizado correctamente', actualizado });
    } else {
      res.status(404).json({ mensajeError: 'Local no encontrado' });
    }
  } catch (error) {
    console.error('Error al actualizar local:', error);
    res.status(500).json({ mensajeError: error.message });
  }
};
