'use strict';

const { validarPermisos } = require('../config/permisos');

const REGEX_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// RUT chileno con dígito verificador (módulo 11). Devuelve "12345678-5" o null si es inválido.
function validarRut(texto) {
  const limpio = String(texto || '').replace(/[.\s]/g, '').toUpperCase();
  const m = /^(\d{1,8})-?([\dK])$/.exec(limpio);
  if (!m) return null;
  let suma = 0, factor = 2;
  for (let i = m[1].length - 1; i >= 0; i--) {
    suma += Number(m[1][i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  const dv = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
  return dv === m[2] ? `${Number(m[1])}-${dv}` : null;
}

// Valida y normaliza los campos recibidos según su definición.
//   campos: [{ col, etiqueta, tipo, req, max, min, patron, mensajePatron, opciones, defecto, minimo }]
//   parcial: true → solo se validan los campos enviados (edición).
// Devuelve { valores: { col: valor }, errores: [texto] }
function validarCampos(campos, body, { parcial = false } = {}) {
  const datos = body && typeof body === 'object' ? body : {};
  const valores = {};
  const errores = [];

  for (const c of campos) {
    const etiqueta = c.etiqueta || c.col;
    let v = datos[c.col];

    if (v === undefined) {
      if (parcial) continue;
      if (c.defecto !== undefined) { valores[c.col] = c.defecto; continue; }
      if (c.req) { errores.push(`${etiqueta} es obligatorio.`); continue; }
      valores[c.col] = null;
      continue;
    }

    if (c.tipo === 'json') {
      const errs = validarPermisos(v);
      if (errs.length) errores.push(...errs); else valores[c.col] = v;
      continue;
    }

    if (v !== null && typeof v === 'object') { errores.push(`${etiqueta} no es válido.`); continue; }
    v = v === null ? '' : String(v).trim();

    if (v === '') {
      if (c.req) errores.push(`${etiqueta} es obligatorio.`);
      else valores[c.col] = null;
      continue;
    }

    switch (c.tipo) {
      case 'entero': {
        const n = Number(v);
        if (!Number.isInteger(n) || n < (c.minimo ?? 1)) errores.push(`${etiqueta} no es válido.`);
        else valores[c.col] = n;
        break;
      }
      case 'enum': {
        const hallada = c.opciones.find(o => o.toLowerCase() === v.toLowerCase());
        if (!hallada) errores.push(`${etiqueta} debe ser uno de: ${c.opciones.join(', ')}.`);
        else valores[c.col] = hallada;
        break;
      }
      case 'email':
        if (v.length > (c.max || 150) || !REGEX_CORREO.test(v)) errores.push(`${etiqueta} no tiene un formato válido.`);
        else valores[c.col] = v.toLowerCase();
        break;
      case 'rut': {
        const rut = validarRut(v);
        if (!rut) errores.push(`${etiqueta} no es válido (ejemplo: 12345678-5).`);
        else valores[c.col] = rut;
        break;
      }
      default: {
        if (c.min && v.length < c.min) { errores.push(`${etiqueta} debe tener al menos ${c.min} caracteres.`); break; }
        if (c.max && v.length > c.max) { errores.push(`${etiqueta} no puede superar ${c.max} caracteres.`); break; }
        if (c.patron && !c.patron.test(v)) { errores.push(c.mensajePatron || `${etiqueta} contiene caracteres no permitidos.`); break; }
        valores[c.col] = v;
      }
    }
  }
  return { valores, errores };
}

module.exports = { validarCampos, validarRut, REGEX_CORREO };
