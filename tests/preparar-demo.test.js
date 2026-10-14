'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nuevo } = require('./helpers/entorno');
const { main } = require('../scripts/preparar-demo');

// Deja la base como la real hoy: roles sin permisos, administradores sin delegaciones, claves sin cifrar.
function ensuciar(c) {
  const s = c.db.sqlite;
  s.exec("UPDATE roles SET permisos = NULL WHERE id_rol IN (1, 2, 3)");
  s.exec('DELETE FROM usuario_delegaciones');
  s.exec("UPDATE usuarios SET password_hash = 'abc123' WHERE id_usuario IN (6, 9)");
}
const silencio = () => {};

test('preparar-demo: en simulación no cambia nada', async () => {
  const c = await nuevo(); ensuciar(c);
  await main({ aplicar: false, forzar: false, claveDemo: '' }, silencio);
  assert.equal(c.db.sqlite.prepare('SELECT permisos FROM roles WHERE id_rol = 1').get().permisos, null);
  assert.equal(c.db.sqlite.prepare('SELECT COUNT(*) n FROM usuario_delegaciones').get().n, 0);
});

test('preparar-demo: aplica permisos, delegaciones de administradores y claves; es idempotente', async () => {
  const c = await nuevo(); ensuciar(c);
  await main({ aplicar: true, forzar: false, claveDemo: 'Demo2026x' }, silencio);
  const s = c.db.sqlite;
  assert.deepEqual(Object.keys(JSON.parse(s.prepare('SELECT permisos FROM roles WHERE id_rol = 1').get().permisos)).length, 12);
  assert.deepEqual(JSON.parse(s.prepare('SELECT permisos FROM roles WHERE id_rol = 2').get().permisos), { atenciones: ['ver', 'crear'] });
  // el administrador queda con las 3 delegaciones activas (la inactiva DEL03 no)
  assert.deepEqual(s.prepare('SELECT id_delegacion d FROM usuario_delegaciones WHERE id_usuario = 1 ORDER BY 1').all().map(x => x.d), [1, 2, 4]);
  assert.match(s.prepare('SELECT password_hash h FROM usuarios WHERE id_usuario = 6').get().h, /^\$2b\$/);
  // y ya se puede entrar con la clave de demostración
  assert.equal((await c.login('plana@laserena.cl', 'Demo2026x')).statusCode, 200);
  const antes = JSON.stringify(s.prepare('SELECT * FROM usuario_delegaciones').all());
  await main({ aplicar: true, forzar: false, claveDemo: 'Demo2026x' }, silencio);
  assert.equal(JSON.stringify(s.prepare('SELECT * FROM usuario_delegaciones').all()), antes);
});

test('preparar-demo: no pisa permisos existentes salvo --forzar-permisos', async () => {
  const c = await nuevo();
  c.db.sqlite.exec(`UPDATE roles SET permisos = '{"atenciones":["ver"]}' WHERE id_rol = 2`);
  await main({ aplicar: true, forzar: false, claveDemo: '' }, silencio);
  assert.deepEqual(JSON.parse(c.db.sqlite.prepare('SELECT permisos FROM roles WHERE id_rol = 2').get().permisos), { atenciones: ['ver'] });
  await main({ aplicar: true, forzar: true, claveDemo: '' }, silencio);
  assert.deepEqual(JSON.parse(c.db.sqlite.prepare('SELECT permisos FROM roles WHERE id_rol = 2').get().permisos), { atenciones: ['ver', 'crear'] });
});

test('preparar-demo: rechaza una clave de demostración débil', async () => {
  const c = await nuevo(); ensuciar(c);
  await assert.rejects(main({ aplicar: true, forzar: false, claveDemo: 'corta' }, silencio), /requisitos/);
});
