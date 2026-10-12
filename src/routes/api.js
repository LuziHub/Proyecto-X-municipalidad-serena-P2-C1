const express = require('express');
const router = express.Router();
const db = require('../config/db'); // Importa la conexión real a MySQL

// Expresión regular estricta: solo letras con/sin tildes, ñ y espacios
const regexSoloLetras = /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]*$/;

// 1. Autenticación (Validando contra la tabla usuarios de MySQL)
router.post('/auth/login', async (req, res) => {
  const { rut, password } = req.body;
  try {
    const [rows] = await db.query('SELECT * FROM usuarios WHERE rut = ?', [rut]);
    if (rows.length > 0 && password === "admin") {
      res.json({
        status: 'success',
        message: 'Acceso autorizado',
        token: 'mock-jwt-token-sgr-2026',
        user: { nombre: rows[0].nombre, rol: rows[0].rol || 'Administrador General', delegacion: rows[0].delegacion || 'DEL-01' }
      });
    } else {
      res.status(401).json({ status: 'error', message: 'RUT o contraseña incorrectos.' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Error en el servidor al procesar la autenticación.' });
  }
});

// Mapeo de módulos a tablas reales en MySQL
const tablaPorModulo = {
  'delegaciones': 'delegaciones',
  'roles': 'roles',
  'usuarios': 'usuarios',
  'items-metas': 'items_metas',
  'tipos-atencion': 'tipos_atencion',
  'sub-atenciones': 'sub_atenciones',
  'atenciones': 'atenciones_ciudadanas'
};

const modulosValidos = Object.keys(tablaPorModulo);

modulosValidos.forEach(modulo => {
  const tabla = tablaPorModulo[modulo];

  // GET: Listar registros desde MySQL
  router.get(`/${modulo}`, async (req, res) => {
    try {
      const [rows] = await db.query(`SELECT * FROM ${tabla}`);
      res.json({ status: 'success', data: rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ status: 'error', message: 'Error al consultar la base de datos.' });
    }
  });

  // POST: Crear registro en MySQL con validaciones estrictas y mensajes detallados
  router.post(`/${modulo}`, async (req, res) => {
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

    try {
      let query = '';
      let values = [];

      if (modulo === 'atenciones') {
        const codigoGen = `SGR-2026-${Math.floor(1000 + Math.random() * 9000)}`;
        query = 'INSERT INTO atenciones_ciudadanas (codigo_atencion, ciudadano, tipo, detalle, estado) VALUES (?, ?, ?, ?, ?)';
        values = [codigoGen, body.ciudadano, body.tipo, body.detalle, 'Registrado'];
      } else if (modulo === 'delegaciones') {
        query = 'INSERT INTO delegaciones (codigo, nombre, comuna) VALUES (?, ?, ?)';
        values = [body.codigo || 'DEL-99', body.nombre, body.comuna || 'La Serena'];
      } else if (modulo === 'roles') {
        query = 'INSERT INTO roles (nombre, descripcion) VALUES (?, ?)';
        values = [body.nombre, body.detalle || ''];
      } else if (modulo === 'usuarios') {
        query = 'INSERT INTO usuarios (rut, nombre, rol, delegacion) VALUES (?, ?, ?, ?)';
        values = [body.rut || '11.111.111-1', body.nombre, body.rol || 'Operador', body.delegacion || 'DEL-01'];
      } else if (modulo === 'items-metas') {
        query = 'INSERT INTO items_metas (periodo, meta, descripcion) VALUES (?, ?, ?)';
        values = [body.nombre || '2026-Q2', 500, body.detalle || ''];
      } else if (modulo === 'tipos-atencion') {
        query = 'INSERT INTO tipos_atencion (codigo, nombre) VALUES (?, ?)';
        values = ['ATQ', body.nombre];
      } else if (modulo === 'sub-atenciones') {
        query = 'INSERT INTO sub_atenciones (tipo_id, nombre) VALUES (?, ?)';
        values = [1, body.nombre];
      }

      const [result] = await db.query(query, values);
      
      // Obtener el registro recién creado para retornarlo al cliente
      const [nuevoRegistro] = await db.query(`SELECT * FROM ${tabla} WHERE id = ?`, [result.insertId]);

      res.json({ 
        status: 'success', 
        message: 'Registro creado con éxito en la base de datos', 
        data: nuevoRegistro[0] || { id: result.insertId, ...body } 
      });

    } catch (err) {
      console.error(err);
      res.status(500).json({ status: 'error', message: 'Error al insertar el registro en la base de datos.' });
    }
  });

  // DELETE: Eliminar registro en MySQL
  router.delete(`/${modulo}/:id`, async (req, res) => {
    const id = req.params.id;
    try {
      await db.query(`DELETE FROM ${tabla} WHERE id = ?`, [id]);
      res.json({ status: 'success', message: 'Registro eliminado correctamente de la base de datos' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ status: 'error', message: 'Error al eliminar el registro de la base de datos.' });
    }
  });
});

module.exports = router;