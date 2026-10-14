'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { percentil, resumir, cumple, aCsv, leerArgumentos } = require('../scripts/prueba-estres');

test('percentil: valores de referencia', () => {
  const v = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentil(v, 95), 95);
  assert.equal(percentil(v, 50), 50);
  assert.equal(percentil([], 95), 0);
  assert.equal(percentil([7], 99), 7);
});

test('resumir y umbrales: errores y latencia deciden si cumple', () => {
  const buenas = Array.from({ length: 100 }, () => ({ ms: 100, ok: true }));
  const r = resumir(buenas, 10);
  assert.equal(r.rps, 10);
  assert.equal(r.erroresPct, 0);
  assert.equal(cumple(r, { p95: 800, errores: 1 }), true);
  const lentas = buenas.map(m => ({ ...m, ms: 900 }));
  assert.equal(cumple(resumir(lentas, 10), { p95: 800, errores: 1 }), false);
  const conErrores = buenas.map((m, i) => ({ ...m, ok: i >= 5 }));          // 5 % de errores
  assert.equal(cumple(resumir(conErrores, 10), { p95: 800, errores: 1 }), false);
  assert.equal(cumple(resumir([], 10), { p95: 800, errores: 1 }), false);   // sin solicitudes nunca "cumple"
});

test('argumentos y CSV', () => {
  assert.deepEqual(leerArgumentos(['--url=http://x', '--escritura', '--niveles=5,10']), { url: 'http://x', escritura: true, niveles: '5,10' });
  const csv = aCsv([{ fecha: 'f', escenario: 'listar', concurrencia: 5, duracion: 20, solicitudes: 100, rps: 5, promedio: 10, p95: 20, p99: 30, erroresPct: 0, cumple: true }]);
  assert.match(csv.split('\n')[1], /^f,listar,5,20,100,5\.00,10\.00,20\.00,30\.00,0\.00,SI$/);
});
