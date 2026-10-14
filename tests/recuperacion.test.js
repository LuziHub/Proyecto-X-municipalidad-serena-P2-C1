'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nuevo, CLAVE, aTexto } = require('./helpers/entorno');

const pedir = (c, correo, ip) => c.llamar('POST', '/auth/forgot-password', { body: { correo }, ip });
const codigoEnviado = c => /(\d{6})/.exec(c.correos[c.correos.length - 1].text)[1];
const verificar = (c, correo, codigo, ip) => c.llamar('POST', '/auth/verify-code', { body: { correo, codigo }, ip });
const envejecer = (c, segundos) => c.db.sqlite.prepare('UPDATE password_resets SET created_at = ?').run(aTexto(new Date(Date.now() - segundos * 1000)));

test('la solicitud responde igual exista o no la cuenta, y solo envía correo si existe', async () => {
  const c = await nuevo();
  const a = await pedir(c, 'ana@laserena.cl');
  const b = await pedir(c, 'fantasma@laserena.cl');
  assert.equal(a.statusCode, 200);
  assert.deepEqual(a.cuerpo, b.cuerpo);
  assert.equal(c.correos.length, 1);
  assert.equal(c.correos[0].to, 'ana@laserena.cl');
  assert.match(c.correos[0].text, /\b\d{6}\b/);
  assert.equal((await pedir(c, 'inactiva@laserena.cl')).statusCode, 200);
  assert.equal(c.correos.length, 1);
  assert.equal((await pedir(c, 'no-es-correo')).statusCode, 400);
});

test('flujo completo: pedir código, validarlo, crear la clave nueva, entrar con ella y rechazar la anterior', async () => {
  const c = await nuevo();
  await pedir(c, 'ana@laserena.cl');
  const v = await verificar(c, 'ana@laserena.cl', codigoEnviado(c));
  assert.equal(v.statusCode, 200);
  const r = await c.llamar('POST', '/auth/reset-password', { body: { token: v.cuerpo.token, nuevaPassword: 'Nueva2026x', confirmacion: 'Nueva2026x' } });
  assert.equal(r.statusCode, 200);
  assert.equal((await c.login('ana@laserena.cl', 'Nueva2026x')).statusCode, 200);
  assert.equal((await c.login('ana@laserena.cl', CLAVE)).statusCode, 401);
});

test('código incorrecto: 3 intentos y luego el código queda invalidado', async () => {
  const c = await nuevo();
  await pedir(c, 'ana@laserena.cl');
  const bueno = codigoEnviado(c);
  const malo = bueno === '000000' ? '111111' : '000000';
  for (let i = 0; i < 3; i++) assert.equal((await verificar(c, 'ana@laserena.cl', malo)).statusCode, 400);
  assert.equal((await verificar(c, 'ana@laserena.cl', bueno)).statusCode, 400); // ya invalidado
});

test('código vencido y código reutilizado', async () => {
  const c = await nuevo();
  await pedir(c, 'ana@laserena.cl');
  const cod = codigoEnviado(c);
  c.db.sqlite.prepare('UPDATE password_resets SET expira_en = ?').run(aTexto(new Date(Date.now() - 1000)));
  assert.equal((await verificar(c, 'ana@laserena.cl', cod)).statusCode, 400);

  const c2 = await nuevo();
  await pedir(c2, 'ana@laserena.cl');
  const v = await verificar(c2, 'ana@laserena.cl', codigoEnviado(c2));
  await c2.llamar('POST', '/auth/reset-password', { body: { token: v.cuerpo.token, nuevaPassword: 'Nueva2026x', confirmacion: 'Nueva2026x' } });
  assert.equal((await verificar(c2, 'ana@laserena.cl', codigoEnviado(c2))).statusCode, 400);      // código usado
  const otra = await c2.llamar('POST', '/auth/reset-password', { body: { token: v.cuerpo.token, nuevaPassword: 'Otra2026xx', confirmacion: 'Otra2026xx' } });
  assert.equal(otra.statusCode, 400);                                                               // el token ya no sirve
  assert.equal((await c2.login('ana@laserena.cl', 'Otra2026xx')).statusCode, 401);
});

test('la nueva contraseña no se acepta sin verificación válida', async () => {
  const c = await nuevo();
  const intento = body => c.llamar('POST', '/auth/reset-password', { body });
  assert.equal((await intento({ nuevaPassword: 'Nueva2026x', confirmacion: 'Nueva2026x' })).statusCode, 400);
  assert.equal((await intento({ token: 'basura', nuevaPassword: 'Nueva2026x', confirmacion: 'Nueva2026x' })).statusCode, 400);
  assert.equal((await intento({ token: c.tok.admin, nuevaPassword: 'Nueva2026x', confirmacion: 'Nueva2026x' })).statusCode, 400); // un token de sesión no sirve
  assert.equal((await c.login('ana@laserena.cl')).statusCode, 200);
});

test('requisitos de la clave y confirmación', async () => {
  const c = await nuevo();
  await pedir(c, 'ana@laserena.cl');
  const v = await verificar(c, 'ana@laserena.cl', codigoEnviado(c));
  const reset = (nueva, conf) => c.llamar('POST', '/auth/reset-password', { body: { token: v.cuerpo.token, nuevaPassword: nueva, confirmacion: conf } });
  assert.equal((await reset('corta1', 'corta1')).statusCode, 400);
  assert.equal((await reset('sololetrasss', 'sololetrasss')).statusCode, 400);
  assert.equal((await reset('Nueva2026x', 'Distinta2026')).statusCode, 400);
  assert.equal((await c.login('ana@laserena.cl')).statusCode, 200);     // nada cambió
  assert.equal((await reset('Nueva2026x', 'Nueva2026x')).statusCode, 200);
});

test('reenvío: espera de 45 s entre solicitudes y máximo por hora (sin cambiar la respuesta)', async () => {
  const c = await nuevo();
  await pedir(c, 'ana@laserena.cl');
  const respuesta2 = await pedir(c, 'ana@laserena.cl');       // inmediato: no reenvía
  assert.equal(c.correos.length, 1);
  assert.equal(respuesta2.statusCode, 200);

  envejecer(c, 60);
  await pedir(c, 'ana@laserena.cl');                           // pasada la espera: reenvía
  assert.equal(c.correos.length, 2);

  // un reenvío invalida el código anterior
  const viejo = /(\d{6})/.exec(c.correos[0].text)[1];
  const nuevoCod = codigoEnviado(c);
  if (viejo !== nuevoCod) assert.equal((await verificar(c, 'ana@laserena.cl', viejo)).statusCode, 400);

  for (let i = 0; i < 5; i++) { envejecer(c, 60); await pedir(c, 'ana@laserena.cl', `10.0.0.${i + 10}`); }
  assert.equal(c.correos.length, 5);
});
