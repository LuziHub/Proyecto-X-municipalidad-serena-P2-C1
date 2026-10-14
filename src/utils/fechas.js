'use strict';

// mysql2 devuelve DATETIME/TIMESTAMP como Date; otros motores (o las pruebas) pueden devolver texto.
function aFecha(valor) {
  if (valor instanceof Date) return valor;
  if (valor === null || valor === undefined) return null;
  const d = new Date(String(valor).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

module.exports = { aFecha };
