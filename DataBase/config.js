// config.js

export const PORT = process.env.PORT || 8080; // Cambiar el puerto por 3000 si no está definido en las variables de entorno
export const DB_HOST = process.env.DB_HOST || 'localhost';
export const DB_USER = process.env.DB_USER || 'root';
export const DB_PASSWORD = process.env.DB_PASSWORD || '123456';
export const DB_NAME = process.env.DB_NAME || 'DB_SodaSaleDESA_10112025'; // Asegúrate de que la base de datos sea la correcta
export const DB_PORT = process.env.DB_PORT || 3306; // Asegúrate de que sea 3306
