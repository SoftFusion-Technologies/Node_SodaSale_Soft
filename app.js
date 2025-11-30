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
import './Models/Geografia/relacionesGeografia.js';
import initVendedoresRelations from './Models/Vendedores/relacionesVendedores.js';
import initRelacionesVentasCxC from './Models/relacionesVentasCxC.js';
import initRelacionesRepartos from './Models/Repartos/relacionesRepartos.js';

initVendedoresRelations();
initRelacionesVentasCxC();
initRelacionesRepartos();

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
    'X-User-Id', // agrega  header custom
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
    '/ventas' // ej: POST /ventas, GET
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
