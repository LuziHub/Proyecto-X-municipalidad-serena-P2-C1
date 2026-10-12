const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const db = require('./config/db');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos (Frontend / Mockup)
app.use(express.static(path.join(__dirname, 'public')));

// Servir la carpeta assets ubicada en la raíz del proyecto (un nivel arriba de src)
app.use('/assets', express.static(path.join(__dirname, '../assets')));

// Ruta explícita para cargar el index.html en la raíz
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Usar las rutas de la API
app.use('/api', apiRoutes);

// Ruta de estado
app.get('/api/status', async (req, res) => {
  res.json({ status: 'success', message: 'Servidor SGR operativo (Conectado a MySQL AWS)' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});