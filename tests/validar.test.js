'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validarCampos, validarRut } = require('../src/utils/validar');
const { MODULOS_API } = require('../src/config/modulos');
const clave = require('../src/utils/clave');
const { crearXlsx } = require('../src/utils/xlsx');

test('RUT: acepta válidos con y sin puntos y rechaza inválidos', () => {
  assert.equal(validarRut('12.345.678-5'), '12345678-5');
  assert.equal(validarRut('12345678-5'), '12345678-5');
  assert.equal(validarRut('11.111.111-1'), '11111111-1');
  assert.equal(validarRut('12345678-4'), null);
  assert.equal(validarRut('abc'), null);
  assert.equal(validarRut(''), null);
});

test('campos obligatorios, largos y caracteres peligrosos (delegaciones)', () => {
  const campos = MODULOS_API.delegaciones.campos;
  const vacio = validarCampos(campos, {});
  assert.ok(vacio.errores.some(e => /Código es obligatorio/.test(e)));
  assert.ok(vacio.errores.some(e => /Nombre es obligatorio/.test(e)));
  assert.ok(vacio.errores.some(e => /Dirección es obligatorio/.test(e)));

  const largo = validarCampos(campos, { codigo: 'ABCDEFGHIJK', nombre: 'x'.repeat(101), direccion: 'Calle 1' });
  assert.ok(largo.errores.some(e => /Código no puede superar 10/.test(e)));
  assert.ok(largo.errores.some(e => /Nombre no puede superar 100/.test(e)));

  const xss = validarCampos(campos, { codigo: 'D1', nombre: '<script>alert(1)</script>', direccion: 'Calle 1' });
  assert.ok(xss.errores.some(e => /caracteres no permitidos/.test(e)));

  const ok = validarCampos(campos, { codigo: ' DEL-9 ', nombre: 'Las Compañías 2', direccion: 'Av. Estado N° 12', estado: 'inactiva' });
  assert.deepEqual(ok.errores, []);
  assert.equal(ok.valores.codigo, 'DEL-9');
  assert.equal(ok.valores.estado, 'Inactiva');
  assert.equal(ok.valores.comuna, 'La Serena');
});

test('validación parcial solo revisa lo enviado', () => {
  const campos = MODULOS_API.delegaciones.campos;
  assert.deepEqual(validarCampos(campos, { estado: 'Activa' }, { parcial: true }).errores, []);
  assert.ok(validarCampos(campos, { estado: 'Quizás' }, { parcial: true }).errores.length);
  assert.ok(validarCampos(campos, { nombre: '' }, { parcial: true }).errores.length);
});

test('correo y enteros', () => {
  const campos = MODULOS_API.usuarios.campos;
  const r = validarCampos(campos, { nombre: 'Ana Pérez', correo: 'no-es-correo', id_rol: 'x', id_delegacion_activa: 0, rut: '1-1' });
  assert.ok(r.errores.some(e => /Correo/.test(e)));
  assert.ok(r.errores.some(e => /Rol no es válido/.test(e)));
  assert.ok(r.errores.some(e => /Delegación principal no es válido/.test(e)));
  assert.ok(r.errores.some(e => /RUT/.test(e)));
  const ok = validarCampos(campos, { nombre: 'Ana Pérez', correo: 'ANA@Laserena.CL', id_rol: '2', id_delegacion_activa: 1 });
  assert.deepEqual(ok.errores, []);
  assert.equal(ok.valores.correo, 'ana@laserena.cl');
  assert.equal(ok.valores.id_rol, 2);
});

test('requisitos de contraseña', () => {
  for (const mala of ['corta1', 'sololetrasss', '123456789', '', null, 'a'.repeat(80) + '1']) {
    assert.equal(clave.validarRequisitos(mala), false, String(mala).slice(0, 12));
  }
  assert.equal(clave.validarRequisitos('Clave1234'), true);
});

test('un hash que no es bcrypt (clave en texto plano) nunca se acepta', async () => {
  assert.equal(clave.esBcrypt('123456'), false);
  assert.equal(clave.esBcrypt('$2y$10$' + 'a'.repeat(53)), true);
  assert.equal(await clave.comparar('123456', '123456'), false);
});

test('el Excel generado es un .xlsx válido (zip con las partes necesarias)', () => {
  const buf = crearXlsx('Prueba', ['A', 'B'], [['1', '=SUMA(1)']]);
  assert.equal(buf.slice(0, 2).toString(), 'PK');
  const texto = buf.toString('latin1');
  for (const parte of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']) {
    assert.ok(texto.includes(parte), parte);
  }
});
