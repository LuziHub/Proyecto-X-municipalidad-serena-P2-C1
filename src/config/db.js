const mysql = require('mysql2');
require('dotenv').config();

// Pool de conexión a MySQL (Preparado para la instancia local o AWS RDS)
const pool = mysql.createPool({
  host: process.env.DB_HOST || '54.175.145.126',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : '',
  database: process.env.DB_NAME || 'sgr_laserena_db',
  port: process.env.DB_PORT || 3306
});
// Verificación de conexión
pool.getConnection((err, connection) => {
  if (err) {
    console.error('❌ Error de conexión a la base de datos MySQL:', err.message);
    return;
  }
  if (connection) {
    console.log('✅ Conexión exitosa a la base de datos MySQL.');
    connection.release();
  }
});

module.exports = pool.promise();