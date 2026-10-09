const express = require('express');
const router = express.Router();

// 1. Ruta de Login y Recuperación de Contraseña
router.post('/auth/login', (req, res) => {
  const { rut, password } = req.body;
  // Simulación de validación de credenciales
  if ((rut === "12.345.678-9" || rut === "12345678-9") && password === "admin") {
    res.json({
      status: 'success',
      message: 'Acceso autorizado',
      token: 'mock-jwt-token-sgr-2026',
      user: { nombre: 'Administrador General', rol: 'admin', delegacion: 'DEL01 - Centro' }
    });
  } else {
    res.status(401).json({ status: 'error', message: 'RUT o contraseña incorrectos.' });
  }
});

router.post('/auth/recover', (req, res) => {
  const { email } = req.body;
  // Respuesta genérica para no revelar existencia de cuentas (según pauta)
  res.json({ status: 'success', message: 'Si la cuenta existe, recibirás instrucciones.' });
});

// 2. Placeholders para los 6 Mantenedores (Delegaciones, Roles, Usuarios, Ítems y metas, Tipos de Atención, Sub Atenciones)
const endpointsCrud = ['delegaciones', 'roles', 'usuarios', 'items-metas', 'tipos-atencion', 'sub-atenciones'];

endpointsCrud.forEach(modulo => {
  router.get(`/${modulo}`, (req, res) => {
    res.json({ status: 'success', modulo, mensaje: `Listado de ${modulo} (Conectado a BD / AWS pendiente)` });
  });

  router.post(`/${modulo}`, (req, res) => {
    res.json({ status: 'success', modulo, mensaje: `Registro creado exitosamente en ${modulo}` });
  });
});

// 3. Ingreso de Atención Ciudadana
router.post('/atenciones', (req, res) => {
  res.json({ 
    status: 'success', 
    codigoAtencion: 'EVI-2026-0091', 
    message: 'Atención ciudadana registrada y asociada a la delegación activa.' 
  });
});

module.exports = router;