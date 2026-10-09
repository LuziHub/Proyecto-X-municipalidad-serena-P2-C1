const express = require('express');
const router = express.Router();

// Expresión regular estricta: solo letras con/sin tildes, ñ y espacios
const regexSoloLetras = /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]*$/;

// Base de datos simulada en memoria (para los 6 mantenedores y atenciones)
const dbMemory = {
  delegaciones: [
    { id: 1, codigo: 'DEL-01', nombre: 'Delegación Centro La Serena', comuna: 'La Serena' },
    { id: 2, codigo: 'DEL-02', nombre: 'Delegación Avenida del Mar', comuna: 'La Serena' }
  ],
  roles: [
    { id: 1, nombre: 'Administrador General', descripcion: 'Control total del sistema' },
    { id: 2, nombre: 'Operador de Atención', descripcion: 'Registro y gestión de atenciones ciudadanas' }
  ],
  usuarios: [
    { id: 1, rut: '12.345.678-9', nombre: 'Luciano Balbontín', rol: 'Administrador General', delegacion: 'DEL-01' }
  ],
  'items-metas': [
    { id: 1, periodo: '2026-Q1', meta: 500, descripcion: 'Atenciones ciudadanas prioritarias' }
  ],
  'tipos-atencion': [
    { id: 1, codigo: 'REC', nombre: 'Reclamos y Solicitudes' },
    { id: 2, codigo: 'CON', nombre: 'Consultas Generales' }
  ],
  'sub-atenciones': [
    { id: 1, tipoId: 1, nombre: 'Alumbrado Público' },
    { id: 2, tipoId: 1, nombre: 'Bacheo de Calles' }
  ],
  atenciones: [
    { id: 1, codigoAtencion: 'SGR-2026-0001', ciudadano: 'Juan Pérez', tipo: 'Reclamos y Solicitudes', detalle: 'Luminaria apagada en Av. Mitre', estado: 'Pendiente', fecha: '2026-06-06' }
  ]
};

// 1. Autenticación
router.post('/auth/login', (req, res) => {
  const { rut, password } = req.body;
  if ((rut === "12.345.678-9" || rut === "12345678-9") && password === "admin") {
    res.json({
      status: 'success',
      message: 'Acceso autorizado',
      token: 'mock-jwt-token-sgr-2026',
      user: { nombre: 'Luciano Balbontín', rol: 'Administrador General', delegacion: 'DEL-01' }
    });
  } else {
    res.status(401).json({ status: 'error', message: 'RUT o contraseña incorrectos.' });
  }
});

// 2. Endpoints CRUD Dinámicos para los 6 Mantenedores y Atenciones
const modulosValidos = ['delegaciones', 'roles', 'usuarios', 'items-metas', 'tipos-atencion', 'sub-atenciones', 'atenciones'];

modulosValidos.forEach(modulo => {
  // GET: Listar registros
  router.get(`/${modulo}`, (req, res) => {
    res.json({ status: 'success', data: dbMemory[modulo] || [] });
  });

  // POST: Crear registro con validaciones estrictas y mensajes detallados
  router.post(`/${modulo}`, (req, res) => {
    const body = req.body;
    const campoValidar = body.nombre || body.ciudadano || '';

    if (campoValidar) {
      // 1. Validar restricción de caracteres especiales y números
      if (!regexSoloLetras.test(campoValidar)) {
        return res.status(400).json({ 
          status: 'error', 
          message: 'Error de validación: No se permiten números ni caracteres especiales en el campo de texto.' 
        });
      }
      // 2. Validar límite de longitud (máximo 25 caracteres)
      if (campoValidar.length > 25) {
        return res.status(400).json({ 
          status: 'error', 
          message: `Error de validación: El texto excede el límite permitido de 25 caracteres (actualmente tiene ${campoValidar.length}).` 
        });
      }
    }

    const nuevoElemento = { id: Date.now(), ...body };
    if (modulo === 'atenciones') {
      nuevoElemento.codigoAtencion = `SGR-2026-${Math.floor(1000 + Math.random() * 9000)}`;
      nuevoElemento.estado = 'Registrado';
    }
    dbMemory[modulo].push(nuevoElemento);
    res.json({ status: 'success', message: 'Registro creado con éxito', data: nuevoElemento });
  });

  // DELETE: Eliminar registro
  router.delete(`/${modulo}/:id`, (req, res) => {
    const id = Number(req.params.id);
    dbMemory[modulo] = dbMemory[modulo].filter(item => item.id !== id);
    res.json({ status: 'success', message: 'Registro eliminado correctamente' });
  });
});

module.exports = router;