'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Reglas de la matriz SGR (correo de la Coordinación de Delegaciones).
// Son funciones puras: no tocan la base, por eso se prueban solas (tests/reglas.test.js).
//
//   1. Si el usuario atendido es el delegado, la gestión no puntúa ("otra gestión").
//   2. Sin nombre y teléfono del usuario, la gestión no puntúa.
//   3. Máximo de gestiones por día (por funcionario).
//   4. Cierre semanal: una semana se puede ingresar hasta el día de cierre de la semana siguiente.
//   5. Coordinaciones previas (mails, invitaciones…) no puntúan; puntúa la acción realizada.
//   7. Tope de puntaje por ítem (ver puntaje.js).
//   8. Felicitaciones: solo las registra el delegado, con respaldo formal (ver crud.js).
//   9. Licencias, vacaciones y días administrativos los ingresa el delegado (ver crud.js).
// ─────────────────────────────────────────────────────────────────────────────

const { diaSemanaIso, lunesDe, sumarDias, nombreDia, fechaCorta } = require('./fechas');

const normalizar = t => String(t === null || t === undefined ? '' : t)
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

const telefonoValido = t => /^\+?\d[\d ]{7,13}\d$/.test(String(t || '').trim());

// ¿Puntúa esta gestión? (reglas 1, 2 y 5). Devuelve { puntua, motivo }.
//   requiereContacto: el ítem exige nombre y teléfono del usuario (p. ej. atención de usuario).
//   nombresDelegados: nombres de los delegados de la delegación, para detectar a un delegado
//                     aunque el funcionario no haya marcado la casilla.
function evaluarPuntaje({ usuarioEsDelegado, esCoordinacion, contactoNombre, contactoTelefono, requiereContacto, nombresDelegados = [] }) {
  const nombre = normalizar(contactoNombre);
  if (usuarioEsDelegado || (nombre && nombresDelegados.some(n => normalizar(n) === nombre))) {
    return { puntua: false, motivo: 'El usuario atendido es el delegado: se considera «otra gestión» y no puntúa (regla 1).' };
  }
  if (esCoordinacion) {
    return { puntua: false, motivo: 'Es una coordinación previa (correos, invitaciones, gestiones internas): no puntúa; puntúa la acción realizada (regla 5).' };
  }
  if (requiereContacto && (!nombre || !telefonoValido(contactoTelefono))) {
    return { puntua: false, motivo: 'Sin nombre y teléfono del usuario la gestión no puntúa (regla 2).' };
  }
  return { puntua: true, motivo: null };
}

// Primera fecha en la que todavía se puede ingresar, según el día de la semana de "hoy".
//   cierreDia: día ISO (1 = lunes … 7 = domingo) hasta el que se puede ingresar la semana anterior (inclusive).
function ventanaIngreso(hoy, cierreDia) {
  const lunes = lunesDe(hoy);
  const semanaAnteriorAbierta = diaSemanaIso(hoy) <= cierreDia;
  return { desde: semanaAnteriorAbierta ? sumarDias(lunes, -7) : lunes, hasta: hoy };
}

// Regla 4 (y fecha futura / fuera de período). Devuelve { ok, mensaje }.
function validarFechaIngreso({ fecha, hoy, cierreDia, periodo }) {
  if (fecha > hoy) return { ok: false, mensaje: 'No se pueden registrar gestiones con fecha futura.' };
  const { desde } = ventanaIngreso(hoy, cierreDia);
  if (fecha < desde) {
    return {
      ok: false,
      mensaje: `La semana de esa fecha ya está cerrada: las gestiones de una semana se pueden ingresar hasta el ${nombreDia(cierreDia)} de la semana siguiente. La fecha más antigua que puedes usar hoy es ${fechaCorta(desde)} (regla 4).`
    };
  }
  if (periodo && (fecha < periodo.fecha_inicio || fecha > periodo.fecha_fin)) {
    return { ok: false, mensaje: `La fecha está fuera del período «${periodo.nombre}» (${fechaCorta(periodo.fecha_inicio)} al ${fechaCorta(periodo.fecha_fin)}).` };
  }
  return { ok: true };
}

// Regla 3: ¿se puede agregar otra gestión ese día? (las emergencias no cuentan para el tope)
function validarTopeDiario({ yaIngresadas, maximo }) {
  if (yaIngresadas >= maximo) {
    return { ok: false, mensaje: `Ese día ya tienes ${yaIngresadas} gestiones y el máximo es ${maximo}. Ingresa tu trabajo día a día (regla 3).` };
  }
  return { ok: true };
}

module.exports = { normalizar, telefonoValido, evaluarPuntaje, ventanaIngreso, validarFechaIngreso, validarTopeDiario };
