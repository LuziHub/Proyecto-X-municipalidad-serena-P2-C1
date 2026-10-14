'use strict';

const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../config/db');
const { authRequired, firmarToken, revocarToken, cargarSesion, contextoPublico, secreto } = require('../middleware/auth');
const clave = require('../utils/clave');
const { enviarCodigo } = require('../utils/correo');
const { crearLimitador } = require('../utils/limitador');
const { REGEX_CORREO, validarRut } = require('../utils/validar');
const { aFecha } = require('../utils/fechas');

// Parámetros de seguridad (configurables en el .env sin tocar el código).
const num = (v, def) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : def);
const CODIGO_VIGENCIA_MIN = num(process.env.RECUPERACION_VIGENCIA_MIN, 10);
const CODIGO_ESPERA_SEG = num(process.env.RECUPERACION_ESPERA_SEG, 45);
const CODIGO_MAX_POR_HORA = num(process.env.RECUPERACION_MAX_POR_HORA, 5);
const CODIGO_MAX_INTENTOS = 3;

const limiteLogin = crearLimitador({ max: 5, ventanaMs: 10 * 60 * 1000 });
const limiteLoginIp = crearLimitador({ max: 30, ventanaMs: 10 * 60 * 1000 });
const limiteRecuperacionIp = crearLimitador({ max: 20, ventanaMs: 60 * 60 * 1000 });

const MSG_LIMITE = 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.';
const ip = req => req.ip || (req.socket && req.socket.remoteAddress) || 'local';
const respuestaError = (res, status, message) => res.status(status).json({ status: 'error', message });
const texto = v => (typeof v === 'string' ? v.trim() : '');

// ─── Login ───────────────────────────────────────────────────────────────────
router.post('/auth/login', async (req, res) => {
  const correo = texto(req.body && req.body.correo);
  const password = req.body && req.body.password;
  if (!correo || typeof password !== 'string' || !password) {
    return respuestaError(res, 400, 'Ingrese su correo (o RUT) y su contraseña.');
  }

  const claveUsuario = `${ip(req)}|${correo.toLowerCase()}`;
  if (limiteLogin.bloqueado(claveUsuario) || limiteLoginIp.bloqueado(ip(req))) {
    return respuestaError(res, 429, MSG_LIMITE);
  }

  try {
    const [filas] = await db.query(
      'SELECT id_usuario, password_hash FROM usuarios WHERE correo = ? OR (rut IS NOT NULL AND rut = ?) LIMIT 1',
      [correo.toLowerCase(), validarRut(correo) || correo]   // acepta el RUT con o sin puntos y guion
    );
    const u = filas[0];

    let valida = false;
    if (u) {
      valida = await clave.comparar(password, u.password_hash);
      if (!valida && !clave.esBcrypt(u.password_hash)) {
        console.warn(`⚠️  El usuario ${u.id_usuario} no tiene una contraseña bcrypt válida; debe restablecerla.`);
      }
    } else {
      await clave.gastarTiempo(password);
    }

    if (!valida) {
      limiteLogin.registrar(claveUsuario);
      limiteLoginIp.registrar(ip(req));
      return respuestaError(res, 401, 'Credenciales incorrectas. Revisa tu correo y contraseña.');
    }

    const sesion = await cargarSesion(u.id_usuario);
    if (!sesion.ok) {
      return respuestaError(res, 403, 'Tu cuenta está inactiva. Contacta al administrador.');
    }
    const { auth } = sesion;
    if (!auth.tienePermisos) {
      return respuestaError(res, 403, 'Tu rol no tiene permisos configurados en el sistema. Contacta al administrador.');
    }
    if (!auth.delegacion) {
      return respuestaError(res, 403, 'Tu cuenta no tiene una delegación activa autorizada. Contacta al administrador.');
    }

    limiteLogin.limpiar(claveUsuario);
    await db.query('UPDATE usuarios SET ultimo_ingreso = ? WHERE id_usuario = ?', [new Date(), auth.usuario.id]);

    res.json({
      status: 'success',
      message: 'Acceso autorizado',
      token: firmarToken(auth.usuario.id),
      user: contextoPublico(auth)
    });
  } catch (err) {
    console.error(err);
    respuestaError(res, 500, 'Error al procesar la autenticación.');
  }
});

// Cierre de sesión: invalida el token en el servidor.
router.post('/auth/logout', authRequired, (req, res) => {
  revocarToken(req.tokenPayload);
  res.json({ status: 'success', message: 'Sesión cerrada.' });
});

// Contexto vigente de la sesión: usuario, rol, permisos, delegaciones autorizadas y delegación activa.
router.get('/auth/me', authRequired, (req, res) => {
  res.json({ status: 'success', user: contextoPublico(req.auth) });
});

// Guarda la delegación elegida como la activa del usuario (la retoma en su próximo ingreso).
router.post('/auth/delegacion', authRequired, async (req, res) => {
  const id = Number(req.body && req.body.id);
  const elegida = Number.isInteger(id) ? req.auth.delegaciones.find(d => d.id === id) : null;
  if (!elegida) return respuestaError(res, 403, 'No tienes autorización para operar en esa delegación.');
  try {
    await db.query('UPDATE usuarios SET id_delegacion_activa = ? WHERE id_usuario = ?', [elegida.id, req.auth.usuario.id]);
    res.json({ status: 'success', message: 'Delegación activa actualizada.', delegacion: elegida });
  } catch (err) {
    console.error(err);
    respuestaError(res, 500, 'No se pudo guardar la delegación activa.');
  }
});

// ─── Recuperación de contraseña (3 pasos) ────────────────────────────────────
// 1) forgot-password: pide el código (respuesta idéntica exista o no la cuenta)
// 2) verify-code:     valida el código y entrega un token de un solo propósito
// 3) reset-password:  con ese token fija la nueva contraseña
const MSG_SOLICITUD = 'Si el correo está registrado, se envió un código de verificación.';

router.post('/auth/forgot-password', async (req, res) => {
  const correo = texto(req.body && req.body.correo).toLowerCase();
  if (!correo || !REGEX_CORREO.test(correo)) {
    return respuestaError(res, 400, 'Ingresa un correo válido.');
  }
  if (limiteRecuperacionIp.bloqueado(ip(req))) return respuestaError(res, 429, MSG_LIMITE);
  limiteRecuperacionIp.registrar(ip(req));

  const respuesta = { status: 'success', message: MSG_SOLICITUD, esperaSegundos: CODIGO_ESPERA_SEG, vigenciaMinutos: CODIGO_VIGENCIA_MIN };

  try {
    const [usuarios] = await db.query('SELECT id_usuario, estado FROM usuarios WHERE correo = ? LIMIT 1', [correo]);
    const u = usuarios[0];
    if (!u || ['inactivo', 'inactiva', '0'].includes(String(u.estado).toLowerCase())) return res.json(respuesta);

    // Límites por cuenta: espera entre envíos y máximo por hora. Si se superan, no se envía
    // nada pero la respuesta es la misma (no revela si la cuenta existe).
    const [previos] = await db.query(
      'SELECT created_at FROM password_resets WHERE correo = ? ORDER BY id_reset DESC LIMIT ?', [correo, CODIGO_MAX_POR_HORA]
    );
    const ahora = Date.now();
    const ultimo = previos[0] && aFecha(previos[0].created_at);
    if (ultimo && ahora - ultimo.getTime() < CODIGO_ESPERA_SEG * 1000) return res.json(respuesta);
    const masAntiguo = previos.length >= CODIGO_MAX_POR_HORA && aFecha(previos[previos.length - 1].created_at);
    if (masAntiguo && ahora - masAntiguo.getTime() < 3600 * 1000) return res.json(respuesta);

    const codigo = String(crypto.randomInt(100000, 1000000));
    await db.query('UPDATE password_resets SET usado = 1 WHERE correo = ? AND usado = 0', [correo]);
    await db.query(
      'INSERT INTO password_resets (correo, codigo, intentos_fallidos, usado, expira_en, created_at) VALUES (?, ?, 0, 0, ?, ?)',
      [correo, codigo, new Date(ahora + CODIGO_VIGENCIA_MIN * 60 * 1000), new Date(ahora)]
    );
    await enviarCodigo(correo, codigo, CODIGO_VIGENCIA_MIN);
    res.json(respuesta);
  } catch (err) {
    console.error(err);
    respuestaError(res, 500, 'Error al procesar la solicitud.');
  }
});

const MSG_CODIGO_INVALIDO = 'El código ingresado no es válido o ya venció. Recuerda que tienes 3 intentos; si los agotas, solicita uno nuevo.';

router.post('/auth/verify-code', async (req, res) => {
  const correo = texto(req.body && req.body.correo).toLowerCase();
  const codigo = texto(req.body && req.body.codigo);
  if (!correo || !/^\d{6}$/.test(codigo)) {
    return respuestaError(res, 400, 'Ingresa el código de 6 dígitos que recibiste por correo.');
  }
  if (limiteRecuperacionIp.bloqueado(`v|${ip(req)}`)) return respuestaError(res, 429, MSG_LIMITE);

  try {
    const [filas] = await db.query(
      'SELECT id_reset, codigo, intentos_fallidos, expira_en FROM password_resets WHERE correo = ? AND usado = 0 ORDER BY id_reset DESC LIMIT 1',
      [correo]
    );
    const r = filas[0];
    const vencido = r && aFecha(r.expira_en).getTime() < Date.now();
    if (!r || vencido || r.intentos_fallidos >= CODIGO_MAX_INTENTOS) {
      if (r) await db.query('UPDATE password_resets SET usado = 1 WHERE id_reset = ?', [r.id_reset]);
      limiteRecuperacionIp.registrar(`v|${ip(req)}`);
      return respuestaError(res, 400, MSG_CODIGO_INVALIDO);
    }

    const coincide = r.codigo.length === codigo.length &&
      crypto.timingSafeEqual(Buffer.from(r.codigo), Buffer.from(codigo));
    if (!coincide) {
      const intentos = r.intentos_fallidos + 1;
      await db.query(
        'UPDATE password_resets SET intentos_fallidos = ?, usado = ? WHERE id_reset = ?',
        [intentos, intentos >= CODIGO_MAX_INTENTOS ? 1 : 0, r.id_reset]
      );
      limiteRecuperacionIp.registrar(`v|${ip(req)}`);
      return respuestaError(res, 400, MSG_CODIGO_INVALIDO);
    }

    // Código válido: token de un solo propósito, solo sirve para fijar la contraseña.
    const token = jwt.sign({ prop: 'reset', rid: r.id_reset, correo }, secreto(), { expiresIn: `${CODIGO_VIGENCIA_MIN}m` });
    res.json({ status: 'success', message: 'Código verificado. Ahora crea tu nueva contraseña.', token });
  } catch (err) {
    console.error(err);
    respuestaError(res, 500, 'Error al verificar el código.');
  }
});

router.post('/auth/reset-password', async (req, res) => {
  const { token, nuevaPassword, confirmacion } = req.body || {};
  let payload;
  try {
    payload = jwt.verify(String(token || ''), secreto());
  } catch (_) {
    return respuestaError(res, 400, 'La verificación expiró. Solicita un nuevo código.');
  }
  if (!payload || payload.prop !== 'reset' || !payload.rid || !payload.correo) {
    return respuestaError(res, 400, 'La verificación no es válida. Solicita un nuevo código.');
  }
  if (!clave.validarRequisitos(nuevaPassword)) {
    return respuestaError(res, 400, `La contraseña no cumple los requisitos. ${clave.REQUISITOS}`);
  }
  if (nuevaPassword !== confirmacion) {
    return respuestaError(res, 400, 'La confirmación no coincide con la nueva contraseña.');
  }

  try {
    const [filas] = await db.query(
      'SELECT id_reset, usado, expira_en FROM password_resets WHERE id_reset = ? AND correo = ? LIMIT 1', [payload.rid, payload.correo]
    );
    const r = filas[0];
    if (!r || Number(r.usado) === 1 || aFecha(r.expira_en).getTime() < Date.now()) {
      return respuestaError(res, 400, 'El código ya fue utilizado o venció. Solicita uno nuevo.');
    }

    const [cambio] = await db.query(
      'UPDATE usuarios SET password_hash = ? WHERE correo = ?', [await clave.hashear(nuevaPassword), payload.correo]
    );
    // Se invalida el código usado y cualquier otro pendiente de la cuenta.
    await db.query('UPDATE password_resets SET usado = 1 WHERE correo = ?', [payload.correo]);
    if (!cambio.affectedRows) return respuestaError(res, 400, 'No se pudo actualizar la contraseña.');
    res.json({ status: 'success', message: 'Contraseña actualizada. Ya puedes iniciar sesión con tu nueva contraseña.' });
  } catch (err) {
    console.error(err);
    respuestaError(res, 500, 'Error al actualizar la contraseña.');
  }
});

router.limitadores = { limiteLogin, limiteLoginIp, limiteRecuperacionIp };
module.exports = router;
