'use strict';
// Demostración de roles y permisos: los 4 roles pedidos por la entrega + Consultor, probados contra la API.
const test = require('node:test');
const assert = require('node:assert/strict');
const { nuevo } = require('./helpers/entorno');
const { main } = require('../scripts/preparar-demo');

const CLAVE_DEMO = 'Demo2026x';
const silencio = () => {};

async function conRoles() {
  const c = await nuevo();
  await main({ aplicar: true, forzar: false, claveDemo: CLAVE_DEMO }, silencio);
  c.demo = {};
  for (const k of ['superadmin', 'coordinador', 'delegado', 'funcionario', 'consultor']) {
    const r = await c.login(`${k}@demo.sgr.cl`, CLAVE_DEMO);
    assert.equal(r.statusCode, 200, `login de ${k}: ${JSON.stringify(r.cuerpo)}`);
    c.demo[k] = { token: r.cuerpo.token, user: r.cuerpo.user };
  }
  return c;
}
const ver = (c, quien, ruta, extra = {}) => c.llamar('GET', ruta, { token: c.demo[quien].token, ...extra });
const modulosCon = (c, quien, accion) => Object.keys(c.demo[quien].user.permisos).filter(m => c.demo[quien].user.permisos[m].includes(accion)).sort();

const USUARIO = { nombre: 'Nuevo Funcionario', correo: 'nuevo@laserena.cl', password: 'Clave1234', estado: 'Activo' };

test('cada rol ve únicamente los módulos que le corresponden', async () => {
  const c = await conRoles();
  assert.deepEqual(modulosCon(c, 'funcionario', 'ver'), ['atenciones', 'vecinos']);
  assert.ok(!modulosCon(c, 'coordinador', 'ver').includes('roles'));
  assert.ok(modulosCon(c, 'coordinador', 'ver').includes('usuarios'));
  assert.ok(modulosCon(c, 'delegado', 'ver').includes('usuarios') && !modulosCon(c, 'delegado', 'ver').includes('roles'));
  assert.equal(modulosCon(c, 'superadmin', 'ver').length, 12);
  assert.deepEqual(modulosCon(c, 'consultor', 'crear'), []);
  assert.ok(modulosCon(c, 'consultor', 'ver').includes('reportes'));
  // los módulos plantilla solo tienen la acción "ver"
  for (const q of ['superadmin', 'coordinador', 'delegado', 'funcionario', 'consultor']) {
    for (const m of ['vecinos', 'tipos-gestion', 'verificacion', 'alertas', 'reportes']) {
      const p = c.demo[q].user.permisos[m];
      if (p) assert.deepEqual(p, ['ver'], `${q}/${m}`);
    }
  }
});

test('alcance y delegaciones de cada perfil', async () => {
  const c = await conRoles();
  const codigos = q => c.demo[q].user.delegaciones.map(d => d.codigo);
  assert.deepEqual(codigos('superadmin'), ['DEL01', 'DEL02', 'DEL04']);       // Global: todas las activas (no DEL03, inactiva)
  assert.deepEqual(codigos('coordinador'), ['DEL01', 'DEL02', 'DEL04']);      // Autorizado: las asignadas
  assert.deepEqual(codigos('delegado'), ['DEL01']);                           // Delegación: solo la suya
  assert.deepEqual(codigos('funcionario'), ['DEL01']);
  assert.equal(c.demo.superadmin.user.alcance, 'global');
  assert.equal(c.demo.delegado.user.alcance, 'delegacion');
  // un delegado no puede operar en otra delegación aunque lo pida
  assert.equal((await ver(c, 'delegado', '/atenciones', { delegacion: 2 })).statusCode, 403);
  assert.equal((await ver(c, 'coordinador', '/atenciones', { delegacion: 2 })).statusCode, 200);
});

test('Funcionario: solo registra y consulta atenciones', async () => {
  const c = await conRoles();
  const f = c.demo.funcionario.token;
  assert.equal((await ver(c, 'funcionario', '/atenciones')).statusCode, 200);
  const nueva = await c.llamar('POST', '/atenciones', { token: f, body: { solicitante: 'Rosa Díaz', id_tipo: 1, id_sub_atencion: 1, descripcion: 'Luz apagada' } });
  assert.equal(nueva.statusCode, 201);
  for (const ruta of ['/usuarios', '/roles', '/delegaciones', '/tipos-atencion', '/items-metas', '/sub-atenciones']) {
    assert.equal((await ver(c, 'funcionario', ruta)).statusCode, 403, ruta);
  }
  assert.equal((await ver(c, 'funcionario', '/atenciones/export')).statusCode, 403);
  assert.equal((await c.llamar('DELETE', `/atenciones/${nueva.cuerpo.id}`, { token: f })).statusCode, 403);
  assert.equal((await c.llamar('PUT', `/atenciones/${nueva.cuerpo.id}`, { token: f, body: { descripcion: 'Cambio' } })).statusCode, 403);
});

test('Coordinador: administra catálogos y consulta; no gestiona roles ni usuarios', async () => {
  const c = await conRoles();
  const t = c.demo.coordinador.token;
  assert.equal((await ver(c, 'coordinador', '/roles')).statusCode, 403);
  assert.equal((await ver(c, 'coordinador', '/usuarios')).statusCode, 200);
  assert.equal((await ver(c, 'coordinador', '/usuarios/export')).statusCode, 200);
  assert.equal((await c.llamar('POST', '/usuarios', { token: t, body: { ...USUARIO, id_rol: 4, id_delegacion_activa: 1 } })).statusCode, 403);
  const tipo = await c.llamar('POST', '/tipos-atencion', { token: t, body: { codigo: 'T09', nombre: 'Nuevo tipo', descripcion: 'Creado por coordinación' } });
  assert.equal(tipo.statusCode, 201);
  assert.equal((await c.llamar('PUT', `/tipos-atencion/${tipo.cuerpo.id}`, { token: t, body: { nombre: 'Tipo editado' } })).statusCode, 200);
  assert.equal((await c.llamar('DELETE', `/tipos-atencion/${tipo.cuerpo.id}`, { token: t })).statusCode, 403);   // sin permiso "eliminar"
  assert.equal((await c.llamar('POST', '/delegaciones', { token: t, body: { codigo: 'DEL09', nombre: 'X', direccion: 'Y' } })).statusCode, 403);
});

test('Delegado municipal: gestiona usuarios de su delegación sin escalar privilegios', async () => {
  const c = await conRoles();
  const d = c.demo.delegado.token;
  const [rolFunc] = c.db.sqlite.prepare("SELECT id_rol FROM roles WHERE nombre = 'Funcionario'").all().map(r => r.id_rol);
  const [rolCoord] = c.db.sqlite.prepare("SELECT id_rol FROM roles WHERE nombre = 'Coordinador'").all().map(r => r.id_rol);

  const ok = await c.llamar('POST', '/usuarios', { token: d, body: { ...USUARIO, id_rol: rolFunc, id_delegacion_activa: 1 } });
  assert.equal(ok.statusCode, 201, JSON.stringify(ok.cuerpo));
  assert.equal((await c.llamar('POST', '/usuarios', { token: d, body: { ...USUARIO, correo: 'otro@laserena.cl', id_rol: rolCoord, id_delegacion_activa: 1 } })).statusCode, 403);
  assert.equal((await c.llamar('POST', '/usuarios', { token: d, body: { ...USUARIO, correo: 'otro@laserena.cl', id_rol: 1, id_delegacion_activa: 1 } })).statusCode, 403);
  assert.equal((await c.llamar('POST', '/usuarios', { token: d, body: { ...USUARIO, correo: 'otro@laserena.cl', id_rol: rolFunc, id_delegacion_activa: 2 } })).statusCode, 403);
  assert.equal((await c.llamar('DELETE', `/usuarios/${ok.cuerpo.id}`, { token: d })).statusCode, 403);          // sin "eliminar"
  assert.equal((await ver(c, 'delegado', '/roles')).statusCode, 403);
  assert.equal((await ver(c, 'delegado', '/usuarios/export')).statusCode, 403);                                  // sin "exportar"
  // ve solo usuarios de su delegación: no aparece quien solo está en DEL02
  const lista = await ver(c, 'delegado', '/usuarios?limit=100');
  assert.ok(!lista.cuerpo.data.some(u => u.correo === 'sara@laserena.cl'));
  assert.ok(lista.cuerpo.data.some(u => u.correo === 'nuevo@laserena.cl'));
});

test('el selector de roles solo ofrece los que el usuario puede asignar', async () => {
  const c = await conRoles();
  const nombres = async q => (await ver(c, q, '/lookup/roles')).cuerpo.data.map(r => r.nombre);
  const delegado = await nombres('delegado');
  assert.ok(delegado.includes('Funcionario') && delegado.includes('Operador'));
  assert.ok(!delegado.includes('Administrador') && !delegado.includes('Superadministrador') && !delegado.includes('Coordinador'));
  assert.ok((await nombres('superadmin')).includes('Superadministrador'));
});

test('Superadministrador: gestiona roles y todo lo demás; Consultor: solo lectura', async () => {
  const c = await conRoles();
  assert.equal((await ver(c, 'superadmin', '/roles')).statusCode, 200);
  assert.equal((await ver(c, 'superadmin', '/usuarios/export')).statusCode, 200);
  assert.equal((await ver(c, 'consultor', '/atenciones')).statusCode, 200);
  assert.equal((await ver(c, 'consultor', '/atenciones/export')).statusCode, 200);
  assert.equal((await c.llamar('POST', '/atenciones', { token: c.demo.consultor.token, body: { solicitante: 'Rosa Díaz', id_tipo: 1, id_sub_atencion: 1, descripcion: 'No debería' } })).statusCode, 403);
  assert.equal((await ver(c, 'consultor', '/usuarios')).statusCode, 403);
});

test('la configuración informa qué módulos son solo plantilla', async () => {
  const c = await conRoles();
  const r = await ver(c, 'funcionario', '/lookup/config');
  assert.deepEqual(r.cuerpo.plantillas.sort(), ['alertas', 'reportes', 'tipos-gestion', 'vecinos', 'verificacion']);
});

test('cerrar sesión invalida el token en el servidor', async () => {
  const c = await conRoles();
  const t1 = c.demo.funcionario.token;
  const t2 = (await c.login('funcionario@demo.sgr.cl', CLAVE_DEMO)).cuerpo.token;      // otra sesión del mismo usuario
  assert.equal((await c.llamar('GET', '/auth/me', { token: t1 })).statusCode, 200);
  assert.equal((await c.llamar('POST', '/auth/logout', { token: t1 })).statusCode, 200);
  assert.equal((await c.llamar('GET', '/auth/me', { token: t1 })).statusCode, 401);
  assert.equal((await c.llamar('GET', '/atenciones', { token: t1 })).statusCode, 401);
  assert.equal((await c.llamar('GET', '/auth/me', { token: t2 })).statusCode, 200);    // la otra sesión sigue activa
  assert.equal((await c.llamar('POST', '/auth/logout', {})).statusCode, 401);         // sin sesión no hay logout
});

test('login con RUT escrito con puntos', async () => {
  const c = await conRoles();
  c.db.sqlite.exec("UPDATE usuarios SET rut = '12345678-5' WHERE correo = 'funcionario@demo.sgr.cl'");
  for (const rut of ['12345678-5', '12.345.678-5', '123456785']) {
    assert.equal((await c.login(rut, CLAVE_DEMO)).statusCode, 200, rut);
  }
  assert.equal((await c.login('12.345.678-4', CLAVE_DEMO)).statusCode, 401);
});
