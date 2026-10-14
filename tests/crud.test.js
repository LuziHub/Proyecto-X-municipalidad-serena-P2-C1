'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nuevo, CLAVE } = require('./helpers/entorno');

const ids = r => r.cuerpo.data.map(x => x.id).sort((a, b) => a - b);
const MODULOS = ['atenciones', 'delegaciones', 'roles', 'usuarios', 'items-metas', 'tipos-atencion', 'sub-atenciones'];

// ── Roles y permisos (servidor) ─────────────────────────────────────────────
test('Administrador: ve los siete módulos', async () => {
  const c = await nuevo();
  for (const m of MODULOS) assert.equal((await c.llamar('GET', `/${m}`, { token: c.tok.admin })).statusCode, 200, m);
});

test('Operador: solo atenciones; no ve ni exporta ni toca nada más', async () => {
  const c = await nuevo();
  assert.equal((await c.llamar('GET', '/atenciones', { token: c.tok.ana })).statusCode, 200);
  for (const m of MODULOS.filter(m => m !== 'atenciones')) {
    assert.equal((await c.llamar('GET', `/${m}`, { token: c.tok.ana })).statusCode, 403, `GET ${m}`);
    assert.equal((await c.llamar('GET', `/${m}/export`, { token: c.tok.ana })).statusCode, 403, `export ${m}`);
    assert.equal((await c.llamar('POST', `/${m}`, { token: c.tok.ana, body: { nombre: 'X' } })).statusCode, 403, `POST ${m}`);
  }
  assert.equal((await c.llamar('GET', '/atenciones/export', { token: c.tok.ana })).statusCode, 403);
  assert.equal((await c.llamar('PUT', '/atenciones/1', { token: c.tok.ana, body: { descripcion: 'cambio' } })).statusCode, 403);
  assert.equal((await c.llamar('DELETE', '/atenciones/1', { token: c.tok.ana })).statusCode, 403);
});

test('Consultor: solo lectura y exportación', async () => {
  const c = await nuevo();
  for (const m of ['atenciones', 'delegaciones', 'items-metas', 'tipos-atencion', 'sub-atenciones']) {
    assert.equal((await c.llamar('GET', `/${m}`, { token: c.tok.luis })).statusCode, 200, m);
    assert.equal((await c.llamar('POST', `/${m}`, { token: c.tok.luis, body: { nombre: 'X' } })).statusCode, 403, `POST ${m}`);
    assert.equal((await c.llamar('DELETE', `/${m}/1`, { token: c.tok.luis })).statusCode, 403, `DELETE ${m}`);
  }
  assert.equal((await c.llamar('GET', '/atenciones/export', { token: c.tok.luis })).statusCode, 200);
  for (const m of ['usuarios', 'roles']) assert.equal((await c.llamar('GET', `/${m}`, { token: c.tok.luis })).statusCode, 403, m);
});

// ── Delegación activa ───────────────────────────────────────────────────────
test('las atenciones se filtran por la delegación activa y el encabezado X-Delegacion la cambia', async () => {
  const c = await nuevo();
  assert.deepEqual(ids(await c.llamar('GET', '/atenciones', { token: c.tok.admin })), [1, 2]);
  assert.deepEqual(ids(await c.llamar('GET', '/atenciones', { token: c.tok.admin, delegacion: 2 })), [3]);
  assert.deepEqual(ids(await c.llamar('GET', '/atenciones', { token: c.tok.sara })), [3]);
  assert.equal((await c.llamar('GET', '/atenciones/3', { token: c.tok.admin })).statusCode, 404);
  assert.equal((await c.llamar('GET', '/atenciones/3', { token: c.tok.admin, delegacion: 2 })).statusCode, 200);
});

test('no se puede operar en una delegación no autorizada, inexistente, inactiva o inválida', async () => {
  const c = await nuevo();
  for (const d of [2, 3, 99, 'abc', '1 OR 1=1']) {
    assert.equal((await c.llamar('GET', '/atenciones', { token: c.tok.ana, delegacion: d })).statusCode, 403, `operador ${d}`);
  }
  assert.equal((await c.llamar('GET', '/atenciones', { token: c.tok.admin, delegacion: 3 })).statusCode, 403); // inactiva
  assert.equal((await c.llamar('GET', '/atenciones', { token: c.tok.admin, delegacion: 99 })).statusCode, 403);
});

test('el consultor, autorizado en dos delegaciones, puede alternar entre ellas', async () => {
  const c = await nuevo();
  assert.deepEqual(ids(await c.llamar('GET', '/atenciones', { token: c.tok.luis })), [1, 2]);
  assert.deepEqual(ids(await c.llamar('GET', '/atenciones', { token: c.tok.luis, delegacion: 2 })), [3]);
});

test('la exportación respeta el alcance, el filtro y no incluye contraseñas', async () => {
  const c = await nuevo();
  const r = await c.llamar('GET', '/atenciones/export?search=basura', { token: c.tok.admin });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'], /spreadsheetml/);
  assert.equal(r.cuerpo.slice(0, 2).toString(), 'PK');
  assert.equal((await c.llamar('GET', '/atenciones/export?search=zzz', { token: c.tok.admin })).statusCode, 404);
  const u = await c.llamar('GET', '/usuarios/export', { token: c.tok.admin });
  assert.equal(u.statusCode, 200);
  assert.equal(u.cuerpo.toString('latin1').includes('password'), false);
});

test('editar o eliminar fuera de la delegación activa → 404 y no cambia nada', async () => {
  const c = await nuevo();
  assert.equal((await c.llamar('PUT', '/atenciones/3', { token: c.tok.admin, body: { descripcion: 'cambio hackeado' } })).statusCode, 404);
  assert.equal((await c.llamar('DELETE', '/atenciones/3', { token: c.tok.admin })).statusCode, 404);
  assert.equal(c.db.sqlite.prepare('SELECT descripcion FROM atenciones_ciudadanas WHERE id_atencion = 3').get().descripcion, 'Consulta de horarios');
});

test('los usuarios se ven por delegación (alcance Autorizado) y las contraseñas nunca salen', async () => {
  const c = await nuevo();
  const lista = await c.llamar('GET', '/usuarios', { token: c.tok.admin });
  assert.ok(!lista.cuerpo.data.some(u => u.correo === 'sara@laserena.cl'));
  const otra = await c.llamar('GET', '/usuarios', { token: c.tok.admin, delegacion: 2 });
  assert.ok(otra.cuerpo.data.some(u => u.correo === 'sara@laserena.cl'));
  for (const r of [lista, await c.llamar('GET', '/usuarios/2', { token: c.tok.admin })]) {
    assert.equal(/password|hash/i.test(JSON.stringify(r.cuerpo)), false);
  }
});

// ── Ingreso de atención ─────────────────────────────────────────────────────
const ATENCION = { solicitante: 'Mario Gómez', id_tipo: 1, id_sub_atencion: 1, descripcion: 'Poste con luz intermitente' };

test('la atención guarda delegación y responsable de la sesión y devuelve su identificador', async () => {
  const c = await nuevo();
  const r = await c.llamar('POST', '/atenciones', { token: c.tok.ana, body: { ...ATENCION, id_delegacion: 2, id_responsable: 1 } });
  assert.equal(r.statusCode, 201);
  assert.match(r.cuerpo.identificador, /^ATC-\d{4}-\d{6}$/);
  const fila = c.db.sqlite.prepare('SELECT * FROM atenciones_ciudadanas WHERE id_atencion = ?').get(r.cuerpo.id);
  assert.equal(fila.id_delegacion, 1);
  assert.equal(fila.id_responsable, c.ids.ana);
  assert.equal(fila.identificador_atencion, r.cuerpo.identificador);
  assert.ok(fila.fecha_registro);
});

test('la atención se registra en la delegación activa elegida', async () => {
  const c = await nuevo();
  const r = await c.llamar('POST', '/atenciones', { token: c.tok.admin, delegacion: 2, body: ATENCION });
  assert.equal(r.statusCode, 201);
  assert.equal(c.db.sqlite.prepare('SELECT id_delegacion AS d FROM atenciones_ciudadanas WHERE id_atencion = ?').get(r.cuerpo.id).d, 2);
  assert.equal((await c.llamar('POST', '/atenciones', { token: c.tok.ana, delegacion: 2, body: ATENCION })).statusCode, 403);
});

test('atención: campos obligatorios, caracteres y dependencia tipo → sub atención', async () => {
  const c = await nuevo();
  const crear = body => c.llamar('POST', '/atenciones', { token: c.tok.ana, body });
  assert.equal((await crear({})).statusCode, 400);
  assert.equal((await crear({ ...ATENCION, solicitante: '' })).statusCode, 400);
  assert.equal((await crear({ ...ATENCION, solicitante: 'Mario<script>' })).statusCode, 400);
  assert.equal((await crear({ ...ATENCION, descripcion: 'corta' })).statusCode, 201);
  assert.equal((await crear({ ...ATENCION, descripcion: 'hola <b>' })).statusCode, 400);
  assert.equal((await crear({ ...ATENCION, id_sub_atencion: 4 })).statusCode, 400);   // la sub 4 es del tipo 2
  assert.equal((await crear({ ...ATENCION, id_sub_atencion: 3 })).statusCode, 400);   // sub inactiva
  assert.equal((await crear({ ...ATENCION, id_tipo: 3, id_sub_atencion: 1 })).statusCode, 400); // tipo inactivo
  assert.equal((await crear({ ...ATENCION, id_tipo: 99 })).statusCode, 400);
  assert.equal((await crear({ ...ATENCION, id_tipo: 2, id_sub_atencion: 4 })).statusCode, 201);
});

test('listas dependientes: solo sub atenciones activas del tipo elegido', async () => {
  const c = await nuevo();
  const subs = await c.llamar('GET', '/lookup/subatenciones?tipo=1', { token: c.tok.ana });
  assert.deepEqual(subs.cuerpo.data.map(s => s.codigo), ['S01', 'S02']);
  assert.deepEqual((await c.llamar('GET', '/lookup/subatenciones?tipo=2', { token: c.tok.ana })).cuerpo.data.map(s => s.codigo), ['S04']);
  assert.deepEqual((await c.llamar('GET', '/lookup/subatenciones?tipo=x', { token: c.tok.ana })).cuerpo.data, []);
  const tipos = await c.llamar('GET', '/lookup/tipos', { token: c.tok.ana });
  assert.deepEqual(tipos.cuerpo.data.map(t => t.codigo).sort(), ['T01', 'T02']);
  assert.equal((await c.llamar('GET', '/lookup/tipos')).statusCode, 401);
});

test('editar una atención no permite cambiar delegación ni responsable', async () => {
  const c = await nuevo();
  const r = await c.llamar('PUT', '/atenciones/1', { token: c.tok.admin, body: { descripcion: 'Descripción corregida', id_delegacion: 2, id_responsable: 4 } });
  assert.equal(r.statusCode, 200);
  const fila = c.db.sqlite.prepare('SELECT * FROM atenciones_ciudadanas WHERE id_atencion = 1').get();
  assert.equal(fila.descripcion, 'Descripción corregida');
  assert.equal(fila.id_delegacion, 1);
  assert.equal(fila.id_responsable, 2);
  assert.equal((await c.llamar('PUT', '/atenciones/1', { token: c.tok.admin, body: { id_tipo: 2 } })).statusCode, 400); // la sub actual no es de ese tipo
});

// ── Mantenedores: validaciones, duplicados y relaciones ─────────────────────
test('delegaciones: crear, duplicado, validaciones, editar y listar con búsqueda parcial', async () => {
  const c = await nuevo();
  const crear = body => c.llamar('POST', '/delegaciones', { token: c.tok.admin, body });
  assert.equal((await crear({})).statusCode, 400);
  assert.equal((await crear({ codigo: 'DEL01', nombre: 'Otra', direccion: 'x 1' })).statusCode, 409);
  assert.equal((await crear({ codigo: 'del01', nombre: 'Otra', direccion: 'x 1' })).statusCode, 409); // sin distinguir mayúsculas
  assert.equal((await crear({ codigo: 'D5', nombre: 'Avenida del Mar', direccion: 'Costanera 10', estado: 'Rara' })).statusCode, 400);
  const ok = await crear({ codigo: 'DEL05', nombre: 'Avenida del Mar', direccion: 'Costanera 10' });
  assert.equal(ok.statusCode, 201);
  assert.equal(c.db.sqlite.prepare('SELECT estado, comuna FROM delegaciones WHERE id_delegacion = ?').get(ok.cuerpo.id).comuna, 'La Serena');

  assert.equal((await c.llamar('PUT', `/delegaciones/${ok.cuerpo.id}`, { token: c.tok.admin, body: { estado: 'Inactiva' } })).statusCode, 200);
  assert.equal((await c.llamar('PUT', `/delegaciones/${ok.cuerpo.id}`, { token: c.tok.admin, body: { codigo: 'DEL01' } })).statusCode, 409);
  assert.equal((await c.llamar('PUT', `/delegaciones/${ok.cuerpo.id}`, { token: c.tok.admin, body: {} })).statusCode, 400);
  assert.deepEqual((await c.llamar('GET', '/delegaciones?search=COMPA', { token: c.tok.admin })).cuerpo.data.map(d => d.codigo), ['DEL02']);
  assert.equal((await c.llamar('GET', '/delegaciones?estado=inactiva', { token: c.tok.admin })).cuerpo.data.every(d => d.estado === 'Inactiva'), true);
  assert.equal((await c.llamar('GET', '/delegaciones?search=%25', { token: c.tok.admin })).cuerpo.data.length, 0); // % es literal
});

test('paginación: total, páginas y límite máximo', async () => {
  const c = await nuevo();
  const r = await c.llamar('GET', '/delegaciones?limit=2&page=2', { token: c.tok.admin });
  assert.equal(r.cuerpo.pagination.total, 4);
  assert.equal(r.cuerpo.pagination.totalPages, 2);
  assert.equal(r.cuerpo.data.length, 2);
  const g = await c.llamar('GET', '/delegaciones?limit=5000&page=99', { token: c.tok.admin });
  assert.equal(g.cuerpo.pagination.limit, 100);
  assert.equal(g.cuerpo.pagination.page, 1);
});

test('tipo y sub atención: relación válida y eliminación protegida', async () => {
  const c = await nuevo();
  const sub = body => c.llamar('POST', '/sub-atenciones', { token: c.tok.admin, body });
  assert.equal((await sub({ codigo: 'S09', nombre: 'Nueva', id_tipo: 99 })).statusCode, 400);
  assert.equal((await sub({ codigo: 'S09', nombre: 'Nueva', id_tipo: 3 })).statusCode, 400); // tipo inactivo
  assert.equal((await sub({ codigo: 'S09', nombre: 'Nueva' })).statusCode, 400);
  assert.equal((await sub({ codigo: 'S01', nombre: 'Duplicada', id_tipo: 1 })).statusCode, 409);
  assert.equal((await sub({ codigo: 'S09', nombre: 'Nueva', id_tipo: 1 })).statusCode, 201);

  const t = await c.llamar('DELETE', '/tipos-atencion/1', { token: c.tok.admin });
  assert.equal(t.statusCode, 409);
  assert.match(t.cuerpo.message, /sub atenciones/);
  assert.equal(t.cuerpo.puedeDesactivar, true);
  assert.equal((await c.llamar('PUT', '/tipos-atencion/1', { token: c.tok.admin, body: { estado: 'Inactivo' } })).statusCode, 200);
  assert.equal((await c.llamar('DELETE', '/tipos-atencion/3', { token: c.tok.admin })).statusCode, 200); // sin relaciones
  assert.equal((await c.llamar('GET', '/sub-atenciones', { token: c.tok.admin })).cuerpo.data[0].tipo !== undefined, true);
});

test('delegación con atenciones o usuarios no se elimina; ítems sí', async () => {
  const c = await nuevo();
  const d = await c.llamar('DELETE', '/delegaciones/1', { token: c.tok.admin });
  assert.equal(d.statusCode, 409);
  assert.equal((await c.llamar('DELETE', '/delegaciones/4', { token: c.tok.admin })).statusCode, 409); // el admin está autorizado en ella
  assert.equal((await c.llamar('DELETE', '/items-metas/1', { token: c.tok.admin })).statusCode, 200);
  assert.equal((await c.llamar('DELETE', '/items-metas/1', { token: c.tok.admin })).statusCode, 404);
  assert.equal((await c.llamar('DELETE', '/items-metas/abc', { token: c.tok.admin })).statusCode, 404);
});

// ── Usuarios ────────────────────────────────────────────────────────────────
const USUARIO = { nombre: 'Zoe Torres', correo: 'zoe@laserena.cl', id_rol: 2, id_delegacion_activa: 1, password: 'Zoe12345' };

test('usuarios: crear con contraseña bcrypt, delegaciones autorizadas y poder iniciar sesión', async () => {
  const c = await nuevo();
  const r = await c.llamar('POST', '/usuarios', { token: c.tok.admin, body: { ...USUARIO, rut: '12.345.678-5', delegaciones: [1, 2] } });
  assert.equal(r.statusCode, 201);
  const fila = c.db.sqlite.prepare('SELECT * FROM usuarios WHERE id_usuario = ?').get(r.cuerpo.id);
  assert.match(fila.password_hash, /^\$2b\$/);
  assert.equal(fila.rut, '12345678-5');
  assert.deepEqual(c.db.sqlite.prepare('SELECT id_delegacion AS d FROM usuario_delegaciones WHERE id_usuario = ? ORDER BY 1').all(r.cuerpo.id).map(x => x.d), [1, 2]);
  assert.equal((await c.login('zoe@laserena.cl', 'Zoe12345')).statusCode, 200);

  const det = await c.llamar('GET', `/usuarios/${r.cuerpo.id}`, { token: c.tok.admin });
  assert.deepEqual(det.cuerpo.data.delegaciones, [1, 2]);
});

test('usuarios: validaciones (contraseña, correo, rut, duplicados, rol y delegación inexistentes)', async () => {
  const c = await nuevo();
  const crear = body => c.llamar('POST', '/usuarios', { token: c.tok.admin, body: { ...USUARIO, ...body } });
  assert.equal((await crear({ password: undefined })).statusCode, 400);
  assert.equal((await crear({ password: 'corta1' })).statusCode, 400);
  assert.equal((await crear({ correo: 'malo' })).statusCode, 400);
  assert.equal((await crear({ rut: '12345678-4' })).statusCode, 400);
  assert.equal((await crear({ correo: 'ana@laserena.cl' })).statusCode, 409);
  assert.equal((await crear({ id_rol: 99 })).statusCode, 400);
  assert.equal((await crear({ id_rol: 4 })).statusCode, 400);                       // rol inactivo
  assert.equal((await crear({ id_delegacion_activa: 99 })).statusCode, 403);
  assert.equal((await crear({ id_delegacion_activa: 3 })).statusCode, 403);          // inactiva
  assert.equal((await crear({ delegaciones: [1, 99] })).statusCode, 403);
  assert.equal((await crear({ delegaciones: 'todas' })).statusCode, 400);
});

test('usuarios: editar sin tocar la contraseña, o cambiándola', async () => {
  const c = await nuevo();
  const antes = c.db.sqlite.prepare('SELECT password_hash FROM usuarios WHERE id_usuario = 2').get().password_hash;
  assert.equal((await c.llamar('PUT', '/usuarios/2', { token: c.tok.admin, body: { nombre: 'Ana Operadora Pérez' } })).statusCode, 200);
  assert.equal(c.db.sqlite.prepare('SELECT password_hash FROM usuarios WHERE id_usuario = 2').get().password_hash, antes);
  assert.equal((await c.llamar('PUT', '/usuarios/2', { token: c.tok.admin, body: { password: 'debil' } })).statusCode, 400);
  assert.equal((await c.llamar('PUT', '/usuarios/2', { token: c.tok.admin, body: { password: 'Cambiada123' } })).statusCode, 200);
  assert.equal((await c.login('ana@laserena.cl', 'Cambiada123')).statusCode, 200);
  assert.equal((await c.login('ana@laserena.cl', CLAVE)).statusCode, 401);
});

test('usuarios: nadie escala privilegios (roles con más permisos, usuarios con más permisos, delegaciones ajenas)', async () => {
  const c = await nuevo();
  // Un consultor con permiso para administrar usuarios, pero con menos permisos que un administrador
  c.db.sqlite.exec(`UPDATE roles SET permisos = '{"usuarios":["ver","crear","editar","eliminar"],"atenciones":["ver"]}' WHERE id_rol = 3`);
  const luis = c.tok.luis;
  assert.equal((await c.llamar('POST', '/usuarios', { token: luis, body: { ...USUARIO, id_rol: 1 } })).statusCode, 403);          // rol Administrador
  assert.equal((await c.llamar('PUT', '/usuarios/1', { token: luis, body: { nombre: 'Hackeado' } })).statusCode, 403);           // sin delegación ni permisos suficientes...
  assert.equal((await c.llamar('PUT', '/usuarios/1', { token: luis, delegacion: 1, body: { nombre: 'Hackeado' } })).statusCode, 403); // ...y con más permisos
  assert.equal((await c.llamar('DELETE', '/usuarios/1', { token: luis })).statusCode, 403);
  assert.equal((await c.llamar('POST', '/usuarios', { token: luis, body: { ...USUARIO, id_delegacion_activa: 4 } })).statusCode, 403); // delegación no autorizada
  assert.equal((await c.llamar('PUT', '/usuarios/3', { token: luis, body: { id_rol: 1 } })).statusCode, 403);                     // ascenderse a sí mismo
  assert.equal(c.db.sqlite.prepare('SELECT nombre FROM usuarios WHERE id_usuario = 1').get().nombre, 'Ada Admin');
});

test('usuarios: no se cambia el propio rol o estado ni se elimina la propia cuenta', async () => {
  const c = await nuevo();
  assert.equal((await c.llamar('PUT', '/usuarios/1', { token: c.tok.admin, body: { id_rol: 2 } })).statusCode, 403);
  assert.equal((await c.llamar('PUT', '/usuarios/1', { token: c.tok.admin, body: { estado: 'Inactivo' } })).statusCode, 403);
  assert.equal((await c.llamar('DELETE', '/usuarios/1', { token: c.tok.admin })).statusCode, 403);
  assert.equal((await c.llamar('PUT', '/usuarios/1', { token: c.tok.admin, body: { nombre: 'Ada Admin Cruz' } })).statusCode, 200);
});

test('usuarios: con atenciones registradas no se elimina (se desactiva)', async () => {
  const c = await nuevo();
  const r = await c.llamar('DELETE', '/usuarios/2', { token: c.tok.admin });
  assert.equal(r.statusCode, 409);
  assert.equal(r.cuerpo.puedeDesactivar, true);
  const nuevoU = await c.llamar('POST', '/usuarios', { token: c.tok.admin, body: USUARIO });
  assert.equal((await c.llamar('DELETE', `/usuarios/${nuevoU.cuerpo.id}`, { token: c.tok.admin })).statusCode, 200);
});

// ── Roles ───────────────────────────────────────────────────────────────────
test('roles: crear con permisos y alcance, validaciones y duplicados', async () => {
  const c = await nuevo();
  const crear = body => c.llamar('POST', '/roles', { token: c.tok.admin, body });
  const base = { codigo: 'ROL10', nombre: 'Supervisor', descripcion: 'Supervisa', alcance: 'Delegación', permisos: { atenciones: ['ver', 'exportar'] } };
  assert.equal((await crear({ ...base, permisos: { inventado: ['ver'] } })).statusCode, 400);
  assert.equal((await crear({ ...base, permisos: { atenciones: ['volar'] } })).statusCode, 400);
  assert.equal((await crear({ ...base, alcance: 'Universal' })).statusCode, 400);
  assert.equal((await crear({ ...base, nombre: 'Operador' })).statusCode, 409);
  assert.equal((await crear({ ...base, codigo: 'ROL01' })).statusCode, 409);
  const ok = await crear(base);
  assert.equal(ok.statusCode, 201);
  const det = await c.llamar('GET', `/roles/${ok.cuerpo.id}`, { token: c.tok.admin });
  assert.deepEqual(det.cuerpo.data.permisos, { atenciones: ['ver', 'exportar'] });
  assert.equal(det.cuerpo.data.alcance, 'Delegación');
});

test('roles: un rol nuevo funciona de inmediato (los permisos viven en la base)', async () => {
  const c = await nuevo();
  const r = await c.llamar('POST', '/roles', { token: c.tok.admin, body: { codigo: 'ROL11', nombre: 'Auditor', alcance: 'Autorizado', permisos: { usuarios: ['ver'] } } });
  const u = await c.llamar('POST', '/usuarios', { token: c.tok.admin, body: { ...USUARIO, id_rol: r.cuerpo.id } });
  assert.equal(u.statusCode, 201);
  const sesion = await c.login('zoe@laserena.cl', 'Zoe12345');
  assert.deepEqual(sesion.cuerpo.user.permisos, { usuarios: ['ver'] });
  assert.equal((await c.llamar('GET', '/usuarios', { token: sesion.cuerpo.token })).statusCode, 200);
  assert.equal((await c.llamar('GET', '/atenciones', { token: sesion.cuerpo.token })).statusCode, 403);
});

test('roles: no se otorgan permisos ni alcance superiores, ni se modifica el propio rol', async () => {
  const c = await nuevo();
  // Un usuario con permiso de administrar roles pero sin poder eliminar usuarios
  c.db.sqlite.exec(`UPDATE roles SET permisos = '{"roles":["ver","crear","editar","eliminar"],"atenciones":["ver"]}' WHERE id_rol = 3`);
  const luis = c.tok.luis;
  const crear = permisos => c.llamar('POST', '/roles', { token: luis, body: { codigo: 'RX', nombre: 'RolX', alcance: 'Delegación', permisos } });
  assert.equal((await crear({ usuarios: ['eliminar'] })).statusCode, 403);
  assert.equal((await crear({ atenciones: ['ver'] })).statusCode, 201);
  assert.equal((await c.llamar('POST', '/roles', { token: luis, body: { codigo: 'RY', nombre: 'RolY', alcance: 'Global', permisos: { atenciones: ['ver'] } } })).statusCode, 403);
  assert.equal((await c.llamar('PUT', '/roles/3', { token: luis, body: { permisos: { roles: ['ver'] } } })).statusCode, 403);        // su propio rol
  assert.equal((await c.llamar('PUT', '/roles/1', { token: luis, body: { descripcion: 'cambio' } })).statusCode, 403);               // rol con más permisos
  assert.equal((await c.llamar('DELETE', '/roles/1', { token: luis })).statusCode, 403);
  assert.equal((await c.llamar('PUT', '/roles/3', { token: c.tok.admin, body: { descripcion: 'Consulta y reportes' } })).statusCode, 200);
  assert.equal((await c.llamar('DELETE', '/roles/1', { token: c.tok.admin })).statusCode, 403);                                      // su propio rol
  assert.equal((await c.llamar('DELETE', '/roles/2', { token: c.tok.admin })).statusCode, 409);                                      // tiene usuarios
});

test('formato inválido de identificadores y cuerpos', async () => {
  const c = await nuevo();
  assert.equal((await c.llamar('GET', '/atenciones/abc', { token: c.tok.admin })).statusCode, 404);
  assert.equal((await c.llamar('PUT', '/atenciones/9999', { token: c.tok.admin, body: { descripcion: 'abcdef' } })).statusCode, 404);
  assert.equal((await c.llamar('POST', '/tipos-atencion', { token: c.tok.admin })).statusCode, 400);
  assert.equal((await c.llamar('POST', '/tipos-atencion', { token: c.tok.admin, body: 'texto' })).statusCode, 400);
  assert.equal((await c.llamar('POST', '/tipos-atencion', { token: c.tok.admin, body: { codigo: 'T9', nombre: { $gt: '' }, descripcion: 'x' } })).statusCode, 400);
});
