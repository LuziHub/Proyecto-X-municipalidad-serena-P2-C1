'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargar, crearBase } = require('./helpers/entorno');
const { planificar, leerArgumentos } = require('../scripts/migrar-delegaciones');

// El módulo de delegaciones necesita la base: se carga con la base simulada.
const { interpretarEsquema } = cargar().delegaciones;

const filas = db => db.query('SELECT * FROM information_schema.COLUMNS').then(([f]) => f);

test('detecta un esquema sin migrar', async () => {
  const db = crearBase({ migrada: false, tablaUd: false });
  const esq = interpretarEsquema(await filas(db));
  assert.equal(esq.atenciones.lista, false);
  assert.equal(esq.ud, null);
  assert.equal(esq.usuarios.delegacion, true);
});

test('detecta usuario_delegaciones con ids o con códigos', async () => {
  const porId = interpretarEsquema(await filas(crearBase({ udPorId: true })));
  assert.equal(porId.ud.porId, true);
  const porCodigo = interpretarEsquema(await filas(crearBase({ udPorId: false })));
  assert.equal(porCodigo.ud.porId, false);
});

test('la migración propone solo lo que falta', async () => {
  const sin = interpretarEsquema(await filas(crearBase({ migrada: false, tablaUd: false })));
  const plan = planificar(sin).pasos.map(p => p.descripcion).join('|');
  assert.match(plan, /delegacion_id/);
  assert.match(plan, /usuario_id/);
  assert.match(plan, /usuario_delegaciones/);

  const al = interpretarEsquema(await filas(crearBase({ migrada: true, tablaUd: true })));
  assert.deepEqual(planificar(al).pasos, []);
});

test('ejecutar el plan deja el esquema al día y es idempotente', async () => {
  const db = crearBase({ migrada: false, tablaUd: false });
  const plan = planificar(interpretarEsquema(await filas(db))).pasos;
  for (const p of plan) {
    // SQLite no admite dos ADD COLUMN en un ALTER: se ejecutan por separado (MySQL sí los acepta juntos).
    if (/^ALTER/.test(p.sql)) {
      const col = /ADD COLUMN `(\w+)` INT NULL/.exec(p.sql)[1];
      db.sqlite.exec(`ALTER TABLE atenciones_ciudadanas ADD COLUMN ${col} INTEGER`);
    } else db.sqlite.exec(p.sql);
  }
  const despues = interpretarEsquema(await filas(db));
  assert.equal(despues.atenciones.lista, true);
  assert.notEqual(despues.ud, null);
  assert.deepEqual(planificar(despues).pasos, []);
});

test('el relleno de atenciones antiguas solo se agrega si se pide', async () => {
  const esq = interpretarEsquema(await filas(crearBase({ migrada: true })));
  assert.equal(planificar(esq).pasos.length, 0);
  const p = planificar(esq, { delegacionPorDefecto: 'DEL-01' }).pasos;
  assert.equal(p.length, 1);
  assert.deepEqual(p[0].params, ['DEL-01']);
});

test('argumentos: sin --aplicar es simulación', () => {
  assert.equal(leerArgumentos([]).aplicar, false);
  const a = leerArgumentos(['--aplicar', '--delegacion-por-defecto=DEL-01']);
  assert.equal(a.aplicar, true);
  assert.equal(a.delegacionPorDefecto, 'DEL-01');
});
