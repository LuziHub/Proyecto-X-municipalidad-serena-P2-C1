'use strict';

// mysql2 devuelve DATETIME/TIMESTAMP como Date; otros motores (o las pruebas) pueden devolver texto.
function aFecha(valor) {
  if (valor instanceof Date) return valor;
  if (valor === null || valor === undefined) return null;
  const d = new Date(String(valor).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─── Fechas de calendario (YYYY-MM-DD) ───────────────────────────────────────
// Las reglas de la matriz (cierre semanal, tope diario, período) trabajan con días de calendario,
// no con instantes: se manejan como texto YYYY-MM-DD para que la zona horaria del servidor no
// cambie el día.
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const dos = n => String(n).padStart(2, '0');

// "Hoy" según el calendario de La Serena (America/Santiago), no el del servidor.
function hoyChile(ahora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}

function esFechaValida(texto) {
  if (typeof texto !== 'string' || !REGEX_FECHA.test(texto)) return false;
  const d = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

// Una columna DATE llega como Date (mysql2, hora local del servidor) o como texto (SQLite, pruebas).
function aFechaTexto(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return `${valor.getFullYear()}-${dos(valor.getMonth() + 1)}-${dos(valor.getDate())}`;
  }
  const t = String(valor).slice(0, 10);
  return esFechaValida(t) ? t : null;
}

function sumarDias(texto, n) {
  const d = new Date(`${texto}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Días entre dos fechas (b - a).
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// 1 = lunes … 7 = domingo
function diaSemanaIso(texto) {
  const d = new Date(`${texto}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}
const lunesDe = texto => sumarDias(texto, -(diaSemanaIso(texto) - 1));
const nombreDia = n => DIAS[n - 1] || '';

// dd-mm-aaaa para mensajes
const fechaCorta = texto => (texto ? texto.split('-').reverse().join('-') : '');

module.exports = {
  aFecha, hoyChile, esFechaValida, aFechaTexto, sumarDias, diasEntre, diaSemanaIso, lunesDe, nombreDia, fechaCorta, REGEX_FECHA
};
