const mysql = require('mysql2');
require('dotenv').config();

// Placeholder de conexión (Preparado para AWS RDS / MySQL)
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'sgr_laserena_db',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Verificación flexible para desarrollo local sin BD activa
pool.getConnection((err, connection) => {
  if (err) {
    console.warn('⚠️ Advertencia: No hay base de datos activa (Modo Mockup/Placeholder AWS activo).');
    console.warn('ℹ️ El servidor continuará operando para evaluar las interfaces y flujos.');
    return;
  }
  if (connection) {
    console.log('✅ Conexión exitosa a la base de datos MySQL.');
    connection.release();
  }
});

module.exports = pool.promise();