import express from 'express';
import cors from 'cors';
// El Intercambio de Recursos de Origen Cruzado (CORS (en-US))
// es un mecanismo que utiliza cabeceras HTTP adicionales para permitir que un user agent (en-US)
// obtenga permiso para acceder a recursos seleccionados desde un servidor, en un origen distinto (dominio) al que pertenece.

// importamos la conexion de la base de datos
import db from './DataBase/db.js';
import GetRoutes from './Routes/routes.js';
import dotenv from 'dotenv';

import { login, authenticateToken } from './Security/auth.js'; // Importa las funciones del archivo auth.js
import { PORT } from './DataBase/config.js';
import mysql from 'mysql2/promise'; // Usar mysql2 para las promesas
import cron from 'node-cron';
import path from 'node:path';

const BASE_UPLOAD_DIR = path.join(process.cwd(), 'uploads');


import { timeRouter } from './Routes/time.routes.js';
import { timeGuard } from './Middlewares/timeGuard.js';
import { initAuthoritativeTime } from './Utils/authoritativeTime.js';
// ...
await initAuthoritativeTime?.(); // si tu Node permite top-level await
// o:
// initAuthoritativeTime();

// CONFIGURACION PRODUCCION
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

// const PORT = process.env.PORT || 3000;

// console.log(process.env.PORT)

const app = express();

/*  🔑 CORS configurado con whitelist y credenciales */
const CORS_WHITELIST = ['http://localhost:5173', 'http://127.0.0.1:5173'];

const corsOptions = {
  origin(origin, cb) {
    if (!origin || CORS_WHITELIST.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-User-Id', // ✅ agrega tu header custom
    'x-user-id',
    'Idempotency-Key',
    'idempotency-key',
    'x-client-reported-time',
    'x-time-guard-reason'
  ],
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
// app.options('*', cors(corsOptions)); // manejar preflight

app.use(express.json());

// 👉 Montamos /time ANTES o DESPUÉS de GetRoutes; es un GET exacto y no interfiere
app.use(timeRouter); // <-- NUEVO

app.use(
  timeGuard([
    '/ventas', // ej: POST /ventas, GET
    '/caja',
    '/movimientos', // si tenés endpoints de caja/movimientos
    '/stock' // operaciones de stock
  ])
);
app.use('/', GetRoutes);
// definimos la conexion

// Para verificar si nuestra conexión funciona, lo hacemos con el método authenticate()
//  el cual nos devuelve una promesa que funciona de la siguiente manera:
// un try y un catch para captar cualquier tipo de errores
try {
  db.authenticate();
  console.log('Conexion con la db establecida');
} catch (error) {
  console.log(`El error de la conexion es : ${error}`);
}

const pool = mysql.createPool({
  host: 'localhost', // Configurar según tu base de datos
  user: 'root', // Configurar según tu base de datos
  password: '123456', // Configurar según tu base de datos
  database: 'DB_SodaSaleDESA_10112025'
});

// Forzar sesión en UTC
(async () => {
  try {
    const conn = await pool.getConnection();
    await conn.query("SET time_zone = '+00:00'");
    conn.release();
    console.log('MySQL session time_zone establecido en UTC (+00:00)');
  } catch (e) {
    console.error(
      'No se pudo setear time_zone en UTC para MySQL session:',
      e.message
    );
  }
})();

// Ruta de login
app.post('/login', login);

// Ruta protegida
app.get('/protected', authenticateToken, (req, res) => {
  res.json({ message: 'Esto es una ruta protegida' });
});

app.get('/', (req, res) => {
  if (req.url == '/') {
    res.send('si en la URL pone  vera los registros en formato JSON'); // este hola mundo se mostrara en el puerto 5000 y en la raiz principal
  } else if (req.url != '/') {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404 ERROR');
  }
});

// sirve archivos estáticos
app.use(
  '/uploads',
  express.static(BASE_UPLOAD_DIR, {
    // opcional: evita problemas de políticas de recursos cruzados
    setHeaders(res) {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    }
  })
);

// Ejemplo para historial completo
// GET /ventas-historial?desde=2025-07-01&hasta=2025-07-31&local=1&vendedor=3&cliente=5
app.get('/ventas-historial', async (req, res) => {
  try {
    const {
      desde,
      hasta,
      local,
      vendedor,
      cliente,
      busqueda,
      page = 1,
      limit = 10
    } = req.query;

    const limitNum = Number(limit);
    const pageNum = Number(page);
    const offsetNum = (pageNum - 1) * limitNum;

    const localId = local ? Number(local) : null;
    const vendedorId = vendedor ? Number(vendedor) : null;
    const clienteId = cliente ? Number(cliente) : null;

    let filtros = [];
    let params = [];

    if (desde && !hasta) {
      filtros.push('DATE(v.fecha) = ?');
      params.push(desde);
    } else {
      if (desde) {
        filtros.push('DATE(v.fecha) >= ?');
        params.push(desde);
      }
      if (hasta) {
        filtros.push('DATE(v.fecha) <= ?');
        params.push(hasta);
      }
    }

    if (localId) {
      filtros.push('v.local_id = ?');
      params.push(localId);
    }
    if (vendedorId) {
      filtros.push('v.usuario_id = ?');
      params.push(vendedorId);
    }
    if (clienteId) {
      filtros.push('v.cliente_id = ?');
      params.push(clienteId);
    }

    if (busqueda) {
      const busquedaId = busqueda.trim().replace('#', '');
      const posibleId = Number(busquedaId);

      if (!isNaN(posibleId)) {
        filtros.push('v.id = ?');
        params.push(posibleId);
      } else {
        filtros.push(`(
          IFNULL(c.nombre, '') LIKE ? OR
          IFNULL(u.nombre, '') LIKE ? OR
          IFNULL(l.nombre, '') LIKE ?
        )`);
        params.push(`%${busqueda}%`, `%${busqueda}%`, `%${busqueda}%`);
      }
    }

    const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

    const baseFrom = `
      FROM ventas v
      LEFT JOIN clientes c ON v.cliente_id = c.id
      LEFT JOIN usuarios u ON v.usuario_id = u.id
      LEFT JOIN locales l ON v.local_id = l.id
    `;

    const [countResult] = await pool.query(
      `SELECT COUNT(DISTINCT v.id) AS total ${baseFrom} ${where}`,
      params
    );
    const total = countResult[0].total;

    // Datos de las ventas
    const query = `
      SELECT 
        v.id AS venta_id,
        v.fecha,
        v.total,
        v.estado,
        c.nombre AS cliente,
        u.nombre AS vendedor,
        l.nombre AS local,

        (
          SELECT SUM(dv.cantidad)
          FROM detalle_venta dv
          WHERE dv.venta_id = v.id
        ) AS total_productos,

        (
          SELECT SUM(dd.cantidad)
          FROM devoluciones d
          JOIN detalle_devolucion dd ON dd.devolucion_id = d.id
          WHERE d.venta_id = v.id
        ) AS total_devueltos

      FROM ventas v
      LEFT JOIN clientes c ON v.cliente_id = c.id
      LEFT JOIN usuarios u ON v.usuario_id = u.id
      LEFT JOIN locales l ON v.local_id = l.id
      ${where}
      GROUP BY v.id
      ORDER BY v.fecha DESC
      LIMIT ${limitNum} OFFSET ${offsetNum}
    `;

    const [ventas] = await pool.query(query, params);

    // Obtener los combos por cada venta
    const ventaIds = ventas.map((v) => v.venta_id);
    let detalleCombos = [];

    if (ventaIds.length) {
      const [detalleCombosRaw] = await pool.query(
        `
        SELECT dvc.*, cb.nombre, cb.descripcion, cb.precio_fijo, cb.cantidad_items
        FROM detalle_venta_combos dvc
        JOIN combos cb ON cb.id = dvc.combo_id
        WHERE dvc.venta_id IN (?)
      `,
        [ventaIds]
      );

      // Agrupar combos por venta
      detalleCombos = ventaIds.reduce((acc, id) => {
        acc[id] = detalleCombosRaw
          .filter((row) => row.venta_id === id)
          .map((row) => ({
            id: row.id,
            combo_id: row.combo_id,
            venta_id: row.venta_id,
            cantidad: row.cantidad,
            precio_combo: row.precio_combo,
            combo: {
              id: row.combo_id,
              nombre: row.nombre,
              descripcion: row.descripcion,
              precio_fijo: row.precio_fijo,
              cantidad_items: row.cantidad_items
            }
          }));
        return acc;
      }, {});
    }

    // Agregar los combos a cada venta
    const ventasConCombos = ventas.map((v) => ({
      ...v,
      detalle_venta_combos: detalleCombos[v.venta_id] || []
    }));

    res.json({
      total,
      page: pageNum,
      limit: limitNum,
      ventas: ventasConCombos
    });
  } catch (err) {
    console.error('Error en /ventas-historial:', err);
    res.status(500).json({ mensajeError: err.message });
  }
});

// GET /ventas/:id/detalle
app.get('/ventas/:id/detalle', async (req, res) => {
  try {
    const ventaId = req.params.id;
    // Info de la venta principal + joins básicos (si lo deseas)
    const [info] = await db.query(
      `
      SELECT 
        v.id AS venta_id,
        v.fecha,
        v.total,
        v.estado,
        c.nombre AS cliente,
        u.nombre AS vendedor,
        l.nombre AS local
      FROM ventas v
      LEFT JOIN clientes c ON v.cliente_id = c.id
      LEFT JOIN usuarios u ON v.usuario_id = u.id
      LEFT JOIN locales l ON v.local_id = l.id
      WHERE v.id = ?
      LIMIT 1
    `,
      [ventaId]
    );

    // Detalle de productos vendidos
    const [detalle] = await db.query(
      `
      SELECT 
        dv.cantidad,
        dv.precio_unitario,
        dv.descuento,
        p.nombre AS producto,
        t.nombre AS talle,
        s.codigo_sku
      FROM detalle_venta dv
      LEFT JOIN stock s ON dv.stock_id = s.id
      LEFT JOIN productos p ON s.producto_id = p.id
      WHERE dv.venta_id = ?
    `,
      [ventaId]
    );

    // Devolver toda la info junta
    res.json({
      ...info[0], // info principal de la venta
      detalle // array de productos vendidos
    });
  } catch (err) {
    res.status(500).json({ mensajeError: err.message });
  }
});

app.get('/ventas-mes', async (req, res) => {
  try {
    const sql = `
      SELECT
        p.id,
        p.nombre,
        COALESCE(SUM(dv.cantidad), 0) AS total_vendido
      FROM productos p
      LEFT JOIN stock s ON s.producto_id = p.id
      LEFT JOIN detalle_venta dv ON dv.stock_id = s.id
      LEFT JOIN ventas v ON dv.venta_id = v.id
        AND YEAR(v.fecha) = YEAR(CURRENT_DATE())
        AND MONTH(v.fecha) = MONTH(CURRENT_DATE())
      GROUP BY p.id, p.nombre
      ORDER BY total_vendido DESC, p.nombre ASC
    `;
    const [rows] = await pool.query(sql);
    res.json(rows);
  } catch (error) {
    console.error('Error al obtener productos vendidos del mes:', error);
    res.status(500).json({ mensajeError: 'Error interno al obtener datos' });
  }
});

// borrado de la tabla temporal para no almacenar datos basura
cron.schedule('0 0 * * *', async () => {
  try {
    await db.query('DELETE FROM ajustes_precios_temp');
    console.log('🧹 Tabla ajustes_precios_temp limpiada a las 00:00');
  } catch (error) {
    console.error('❌ Error al limpiar ajustes_precios_temp:', error);
  }
});

if (!PORT) {
  console.error('El puerto no está definido en el archivo de configuración.');
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});

process.on('uncaughtException', (err) => {
  console.error('Excepción no capturada:', err);
  process.exit(1); // Opcional: reiniciar la aplicación
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Promesa rechazada no capturada:', promise, 'razón:', reason);
  process.exit(1); // Opcional: reiniciar la aplicación
});
