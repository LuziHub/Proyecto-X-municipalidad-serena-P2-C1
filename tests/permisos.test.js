'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/config/permisos');

test('normalizarPermisos acepta texto JSON, objeto y NULL, y descarta lo desconocido', () => {
  assert.deepEqual(P.normalizarPermisos('{"atenciones":["ver","crear"]}'), { atenciones: ['ver', 'crear'] });
  assert.deepEqual(P.normalizarPermisos({ atenciones: ['ver', 'hackear'], inventado: ['ver'] }), { atenciones: ['ver'] });
  for (const malo of [null, undefined, '', 'no es json', '[]', 42, '{"atenciones":"ver"}']) {
    assert.deepEqual(P.normalizarPermisos(malo), {}, String(malo));
  }
});

test('un rol sin permisos no puede nada', () => {
  assert.equal(P.puede({}, 'atenciones', 'ver'), false);
  assert.equal(P.puede(null, 'atenciones', 'ver'), false);
  assert.equal(P.puede({ atenciones: ['ver'] }, 'atenciones', 'crear'), false);
  assert.equal(P.puede({ atenciones: ['ver'] }, 'toString', 'ver'), false);
});

test('validarPermisos rechaza módulos y acciones desconocidos', () => {
  assert.deepEqual(P.validarPermisos({ atenciones: ['ver'] }), []);
  assert.ok(P.validarPermisos({ inventado: ['ver'] }).length);
  assert.ok(P.validarPermisos({ atenciones: ['volar'] }).length);
  assert.ok(P.validarPermisos([]).length);
});

test('esSubconjunto (base de la regla contra escalada de privilegios)', () => {
  const operador = P.PERMISOS_BASE.Operador;
  assert.equal(P.esSubconjunto(operador, P.PERMISOS_BASE.Administrador), true);
  assert.equal(P.esSubconjunto(P.PERMISOS_BASE.Administrador, operador), false);
  assert.equal(P.esSubconjunto({}, {}), true);
  assert.equal(P.esSubconjunto({ usuarios: ['ver'] }, operador), false);
});

test('claveAlcance: valores conocidos y alcance desconocido = el más restrictivo', () => {
  assert.equal(P.claveAlcance('Delegación'), 'delegacion');
  assert.equal(P.claveAlcance('delegacion'), 'delegacion');
  assert.equal(P.claveAlcance('Autorizado'), 'autorizado');
  assert.equal(P.claveAlcance('Lectura'), 'lectura');
  assert.equal(P.claveAlcance('Global'), 'global');
  assert.equal(P.claveAlcance('cualquier cosa'), 'delegacion');
  assert.equal(P.claveAlcance(null), 'delegacion');
});

test('los permisos base cubren la demostración de roles', () => {
  assert.ok(P.puede(P.PERMISOS_BASE.Administrador, 'roles', 'eliminar'));
  assert.ok(P.puede(P.PERMISOS_BASE.Operador, 'atenciones', 'crear'));
  assert.ok(!P.puede(P.PERMISOS_BASE.Operador, 'usuarios', 'ver'));
  assert.ok(P.puede(P.PERMISOS_BASE.Consultor, 'atenciones', 'exportar'));
  assert.ok(!P.puede(P.PERMISOS_BASE.Consultor, 'atenciones', 'crear'));
  assert.ok(!P.puede(P.PERMISOS_BASE.Consultor, 'usuarios', 'ver'));
});
