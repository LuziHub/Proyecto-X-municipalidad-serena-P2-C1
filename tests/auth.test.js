'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nuevo, CLAVE, jwtStub } = require('./helpers/entorno');

test('login correcto: devuelve token, permisos desde la BD y delegaciones autorizadas', async () => {
  const c = await nuevo();
  const r = await c.login('ana@laserena.cl');
  assert.equal(r.statusCode, 200);
  assert.equal(r.cuerpo.user.rol, 'Operador');
  assert.deepEqual(r.cuerpo.user.permisos, { atenciones: ['ver', 'crear'] });
  assert.deepEqual(r.cuerpo.user.delegaciones.map(d => d.codigo), ['DEL01']);
  assert.equal(r.cuerpo.user.delegacionActiva.codigo, 'DEL01');
  assert.equal(JSON.stringify(r.cuerpo).includes('password'), false);
  assert.ok(c.db.sqlite.prepare('SELECT ultimo_ingreso FROM usuarios WHERE id_usuario = 2').get().ultimo_ingreso);
});

test('login incorrecto: contraseña errada, usuario inexistente y campos vacíos', async () => {
  const c = await nuevo();
  assert.equal((await c.login('ana@laserena.cl', 'otra-clave')).statusCode, 401);
  assert.equal((await c.login('noexiste@laserena.cl')).statusCode, 401);
  assert.equal((await c.llamar('POST', '/auth/login', { body: {} })).statusCode, 400);
  assert.equal((await c.llamar('POST', '/auth/login', { body: { correo: 'ana@laserena.cl', password: '' } })).statusCode, 400);
  assert.equal((await c.llamar('POST', '/auth/login', { body: { correo: { $ne: 1 }, password: 'x' } })).statusCode, 400);
});

test('la antigua puerta trasera (admin / 123456) ya no existe', async () => {
  const c = await nuevo();
  for (const clave of ['admin', '123456']) {
    assert.equal((await c.login('admin@laserena.cl', clave)).statusCode, 401, clave);
  }
});

test('el mensaje de error no distingue entre usuario inexistente y clave incorrecta', async () => {
  const c = await nuevo();
  const a = await c.login('ana@laserena.cl', 'mala');
  const b = await c.login('fantasma@laserena.cl', 'mala');
  assert.equal(a.cuerpo.message, b.cuerpo.message);
});

test('cuenta inactiva, clave en texto plano, rol suspendido, rol sin permisos y delegación inactiva', async () => {
  const c = await nuevo();
  assert.equal((await c.login('inactiva@laserena.cl')).statusCode, 403);
  assert.equal((await c.login('plana@laserena.cl', '123456')).statusCode, 401);
  assert.equal((await c.login('suspendido@laserena.cl')).statusCode, 403);
  assert.equal((await c.login('sinperm@laserena.cl')).statusCode, 403);
  assert.equal((await c.login('sindel@laserena.cl')).statusCode, 403);
});

test('bloqueo temporal tras 5 intentos fallidos (también con la clave correcta)', async () => {
  const c = await nuevo();
  for (let i = 0; i < 5; i++) assert.equal((await c.login('ana@laserena.cl', 'mala')).statusCode, 401);
  assert.equal((await c.login('ana@laserena.cl', 'mala')).statusCode, 429);
  assert.equal((await c.login('ana@laserena.cl')).statusCode, 429);
  assert.equal((await c.login('luis@laserena.cl')).statusCode, 200); // otra cuenta no se ve afectada
});

test('rutas protegidas: sin token, token basura, firmado con otra clave o de recuperación → 401', async () => {
  const c = await nuevo();
  assert.equal((await c.llamar('GET', '/atenciones')).statusCode, 401);
  assert.equal((await c.llamar('GET', '/atenciones', { token: 'abc.def.ghi' })).statusCode, 401);
  const falso = jwtStub.sign({ id: 1 }, 'otra-clave-cualquiera-123', { expiresIn: '8h' });
  assert.equal((await c.llamar('GET', '/usuarios', { token: falso })).statusCode, 401);
  const reset = jwtStub.sign({ prop: 'reset', rid: 1, correo: 'ana@laserena.cl' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  assert.equal((await c.llamar('GET', '/atenciones', { token: reset })).statusCode, 401);
});

test('el rol del token no vale: se lee de la base en cada solicitud', async () => {
  const c = await nuevo();
  const forjado = jwtStub.sign({ id: c.ids.ana, rol: 'Administrador', permisos: { usuarios: ['ver'] } }, process.env.JWT_SECRET, { expiresIn: '8h' });
  assert.equal((await c.llamar('GET', '/usuarios', { token: forjado })).statusCode, 403);
});

test('desactivar al usuario o a su rol corta el acceso al instante', async () => {
  const c = await nuevo();
  assert.equal((await c.llamar('GET', '/atenciones', { token: c.tok.ana })).statusCode, 200);
  c.db.sqlite.exec("UPDATE roles SET estado = 'Inactivo' WHERE id_rol = 2");
  assert.equal((await c.llamar('GET', '/atenciones', { token: c.tok.ana })).statusCode, 403);
  c.db.sqlite.exec("UPDATE roles SET estado = 'Activo' WHERE id_rol = 2; UPDATE usuarios SET estado = 'Inactivo' WHERE id_usuario = 2");
  assert.equal((await c.llamar('GET', '/atenciones', { token: c.tok.ana })).statusCode, 401);
});

test('un cambio de permisos del rol se aplica sin volver a iniciar sesión', async () => {
  const c = await nuevo();
  assert.equal((await c.llamar('GET', '/usuarios', { token: c.tok.ana })).statusCode, 403);
  c.db.sqlite.exec(`UPDATE roles SET permisos = '{"usuarios":["ver"],"atenciones":["ver"]}' WHERE id_rol = 2`);
  assert.equal((await c.llamar('GET', '/usuarios', { token: c.tok.ana })).statusCode, 200);
});

test('/auth/me y cambio de delegación activa', async () => {
  const c = await nuevo();
  const me = await c.llamar('GET', '/auth/me', { token: c.tok.admin });
  assert.deepEqual(me.cuerpo.user.delegaciones.map(d => d.codigo), ['DEL01', 'DEL02', 'DEL04']);
  const ok = await c.llamar('POST', '/auth/delegacion', { token: c.tok.admin, body: { id: 2 } });
  assert.equal(ok.statusCode, 200);
  assert.equal(c.db.sqlite.prepare('SELECT id_delegacion_activa AS d FROM usuarios WHERE id_usuario = 1').get().d, 2);
  assert.equal((await c.llamar('POST', '/auth/delegacion', { token: c.tok.ana, body: { id: 2 } })).statusCode, 403);
  assert.equal((await c.llamar('POST', '/auth/delegacion', { token: c.tok.admin, body: { id: 3 } })).statusCode, 403); // inactiva
});
