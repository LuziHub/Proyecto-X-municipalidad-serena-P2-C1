const express = require('express');
const cors = require('cors');
require('dotenv').config();
const db = require('./config/db');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos (Frontend / Mockup)
app.use(express.static('src/public'));

// Usar las rutas de la API
app.use('/api', apiRoutes);

// Ruta de estado
app.get('/api/status', async (req, res) => {
  res.json({ status: 'success', message: 'Servidor SGR operativo (Modo AWS Mockup activo)' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});