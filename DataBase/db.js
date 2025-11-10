  import { Sequelize } from 'sequelize';
  import { DB_HOST, DB_NAME, DB_PASSWORD, DB_USER, DB_PORT } from './config.js';

  const db = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
    host: DB_HOST,
    port: DB_PORT,
    dialect: 'mysql',
    define: { freezeTableName: true },
    pool: {
      max: 15, // Está bien para producción, ajusta según el tamaño esperado de la carga
      min: 5,
      acquire: 30000,
      idle: 10000
    },
    dialectOptions: {
      connectTimeout: 60000, // Ajuste razonable para producción
      ssl: {
        require: true,
        rejectUnauthorized: false // Solo si tu base de datos requiere SSL, verifica esto
      }
    }
  });


  export default db;
