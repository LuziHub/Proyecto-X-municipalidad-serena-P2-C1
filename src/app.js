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

// Servir archivos estáticos (Frontend / Mockup)[cite: 15]
app.use(express.static(path.join(__dirname, 'public')));

// Servir la carpeta assets ubicada en la raíz del proyecto (un nivel arriba de src)[cite: 15]
app.use('/assets', express.static(path.join(__dirname, '../assets')));

// Rutas explícitas para las vistas multi-pantalla[cite: 15]
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/recovery', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'recovery.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Usar las rutas de la API[cite: 15]
app.use('/api', apiRoutes);

// Ruta de estado[cite: 15]
app.get('/api/status', async (req, res) => {
  res.json({ status: 'success', message: 'Servidor SGR operativo (Conectado a MySQL AWS)' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});