'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { normalizarPermisos, claveAlcance, puede } = require('../config/permisos');
const { autorizadas } = require('../utils/delegaciones');
const { bcryptDisponible } = require('../utils/clave');

// ─── Secreto de firma ────────────────────────────────────────────────────────
// No existe un valor por defecto: con el repositorio público, cualquiera podría fabricar sesiones.
function secreto() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    const err = new Error('JWT_SECRET no está configurado (mínimo 16 caracteres). Revisa el archivo .env.');
    err.code = 'CONFIG';
    throw err;
  }
  return s;
}

// Problemas de configuración que impiden arrancar (lista vacía si todo está bien).
function problemasDeConfiguracion() {
  const problemas = [];
  const s = process.env.JWT_SECRET;
  if (!s) problemas.push('Falta JWT_SECRET en el archivo .env.');
  else if (s.length < 16) problemas.push('JWT_SECRET es demasiado corto (mínimo 16 caracteres).');
  if (!bcryptDisponible()) problemas.push('Falta la librería bcrypt: ejecuta "npm install bcryptjs".');
  return problemas;
}

// El token de sesión solo identifica al usuario. Rol, estado, permisos y delegaciones se leen de
// la base en cada solicitud: un cambio de rol o una desactivación se aplican de inmediato.
function firmarToken(id) {
  return jwt.sign({ id, jti: crypto.randomBytes(12).toString('hex') }, secreto(), { expiresIn: process.env.JWT_EXPIRA || '8h' });
}

// Sesiones cerradas (logout): el token deja de servir aunque no haya vencido.
// Vive en memoria: basta para un solo proceso (PM2 en modo fork) y se limpia solo al vencer cada token.
const revocados = new Map();
function revocarToken(payload) {
  if (!payload || !payload.jti) return;
  revocados.set(payload.jti, (payload.exp || Math.floor(Date.now() / 1000) + 8 * 3600) * 1000);
  const ahora = Date.now();
  for (const [j, vence] of revocados) if (vence < ahora) revocados.delete(j);
}
const estaRevocado = payload => !!(payload && payload.jti && revocados.has(payload.jti));

const falla = (status, message) => ({ ok: false, status, message });
const esActivo = v => v === null || v === undefined || !['inactivo', 'inactiva', '0'].includes(String(v).trim().toLowerCase());

// Reconstruye el contexto autorizado de un usuario.
//   delegacionSolicitada: valor del encabezado X-Delegacion (id) o undefined.
async function cargarSesion(id, delegacionSolicitada) {
  const numero = Number(id);
  if (!Number.isInteger(numero) || numero <= 0) return falla(401, 'La sesión no es válida. Inicia sesión nuevamente.');

  const [filas] = await db.query(
    `SELECT u.id_usuario, u.nombre, u.correo, u.estado, u.id_rol, u.id_delegacion_activa,
            r.nombre AS rol_nombre, r.alcance AS rol_alcance, r.permisos AS rol_permisos, r.estado AS rol_estado
       FROM usuarios u LEFT JOIN roles r ON r.id_rol = u.id_rol
      WHERE u.id_usuario = ? LIMIT 1`, [numero]
  );
  const u = filas[0];
  if (!u || !esActivo(u.estado)) return falla(401, 'La cuenta no está disponible. Contacta al administrador.');

  // Un rol inactivo o sin permisos configurados no puede hacer nada.
  const rolVigente = u.rol_nombre !== null && u.rol_nombre !== undefined && esActivo(u.rol_estado);
  const permisos = rolVigente ? normalizarPermisos(u.rol_permisos) : {};
  const alcance = claveAlcance(u.rol_alcance);
  const delegaciones = rolVigente ? await autorizadas(u, alcance) : [];

  let delegacion = delegaciones.find(d => d.id === Number(u.id_delegacion_activa)) || delegaciones[0] || null;
  if (delegacionSolicitada !== undefined && delegacionSolicitada !== null && delegacionSolicitada !== '') {
    const pedida = Number(delegacionSolicitada);
    const hallada = Number.isInteger(pedida) ? delegaciones.find(d => d.id === pedida) : null;
    if (!hallada) return falla(403, 'No tienes autorización para operar en la delegación solicitada.');
    delegacion = hallada;
  }

  return {
    ok: true,
    auth: {
      usuario: { id: Number(u.id_usuario), nombre: u.nombre, correo: u.correo, rol: u.rol_nombre || '', rolId: u.id_rol === null ? null : Number(u.id_rol) },
      alcance,
      permisos,
      delegaciones,
      delegacion,
      tienePermisos: Object.keys(permisos).length > 0
    }
  };
}

// Middleware: exige una sesión válida y deja el contexto en req.auth.
async function authRequired(req, res, next) {
  try {
    const [tipo, token] = String(req.headers.authorization || '').split(' ');
    if (tipo !== 'Bearer' || !token) {
      return res.status(401).json({ status: 'error', message: 'Debes iniciar sesión para continuar.' });
    }
    let payload;
    try {
      payload = jwt.verify(token, secreto());
    } catch (_) {
      return res.status(401).json({ status: 'error', message: 'Tu sesión expiró o no es válida. Inicia sesión nuevamente.' });
    }
    // Los tokens de recuperación de contraseña (con "prop") no sirven como sesión.
    if (!payload || payload.prop || payload.id === undefined) {
      return res.status(401).json({ status: 'error', message: 'Tu sesión expiró o no es válida. Inicia sesión nuevamente.' });
    }

    if (estaRevocado(payload)) {
      return res.status(401).json({ status: 'error', message: 'Tu sesión fue cerrada. Inicia sesión nuevamente.' });
    }
    req.tokenPayload = payload;

    const resultado = await cargarSesion(payload.id, req.headers['x-delegacion']);
    if (!resultado.ok) return res.status(resultado.status).json({ status: 'error', message: resultado.message });
    req.auth = resultado.auth;
    next();
  } catch (err) {
    console.error('Error validando la sesión:', err);
    res.status(500).json({ status: 'error', message: 'Error del servidor al validar la sesión.' });
  }
}

// Middleware: exige un permiso concreto. Va siempre después de authRequired.
// Acepta uno o varios pares [modulo, accion]; basta con cumplir uno.
function requirePermiso(modulo, accion) {
  const pares = Array.isArray(modulo) ? modulo : [[modulo, accion]];
  return (req, res, next) => {
    if (!req.auth || !pares.some(([m, a]) => puede(req.auth.permisos, m, a))) {
      return res.status(403).json({ status: 'error', message: 'No tienes permisos para realizar esta acción.' });
    }
    next();
  };
}

// Lo que recibe el navegador. Sirve para dibujar la interfaz; no es control de acceso.
function contextoPublico(auth) {
  return {
    id: auth.usuario.id,
    nombre: auth.usuario.nombre,
    correo: auth.usuario.correo,
    rol: auth.usuario.rol,
    alcance: auth.alcance,
    permisos: auth.permisos,
    delegaciones: auth.delegaciones,
    delegacionActiva: auth.delegacion
  };
}

module.exports = {
  secreto, problemasDeConfiguracion, firmarToken, revocarToken, cargarSesion,
  authRequired, requirePermiso, contextoPublico
};
