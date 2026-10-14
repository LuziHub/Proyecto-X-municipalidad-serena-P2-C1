const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('./config/db');
const apiRoutes = require('./routes/api');
const { problemasDeConfiguracion } = require('./middleware/auth');
const { smtpConfigurado } = require('./utils/correo');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Cabeceras básicas de seguridad
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// Servir archivos estáticos (Frontend)
app.use(express.static(path.join(__dirname, 'public')));

// Servir la carpeta assets ubicada en la raíz del proyecto (un nivel arriba de src)
app.use('/assets', express.static(path.join(__dirname, '../assets')));

// Rutas explícitas para las vistas multi-pantalla
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/recovery', (req, res) => res.sendFile(path.join(__dirname, 'public', 'recovery.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

// API
app.use('/api', apiRoutes);

// Ruta de estado
app.get('/api/status', async (req, res) => {
  res.json({ status: 'success', message: 'Servidor SGR operativo' });
});

// Cualquier ruta de API desconocida responde JSON (y no HTML)
app.use('/api', (req, res) => res.status(404).json({ status: 'error', message: 'Ruta no encontrada.' }));

// Errores no controlados (por ejemplo, un JSON mal formado en la solicitud)
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ status: 'error', message: 'La solicitud no tiene un formato válido.' });
  }
  console.error(err);
  res.status(500).json({ status: 'error', message: 'Error interno del servidor.' });
});

// Solo se levanta el servidor al ejecutar `node src/app.js` (las pruebas importan `app` sin abrir el puerto).
if (require.main === module) {
  const problemas = problemasDeConfiguracion();
  if (problemas.length) {
    console.error('❌ No se puede iniciar el servidor:');
    problemas.forEach(p => console.error('   - ' + p));
    process.exit(1);
  }
  if (!smtpConfigurado()) {
    console.warn('⚠️  SMTP no configurado (SMTP_HOST en .env): los códigos de recuperación no se enviarán por correo.');
  }
  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  });
}

module.exports = app;
