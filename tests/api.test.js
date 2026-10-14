'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { cargar, sembrar, tokenDe, idDe, jwtStub } = require('./helpers/entorno');

function nuevo(opciones) {
  const ctx = cargar(opciones);
  sembrar(ctx.db);
  const t = correo => tokenDe(ctx, correo);
  ctx.t = {
    sup: t('super@laserena.cl'), coord: t('coord@laserena.cl'), deleg: t('delegado@laserena.cl'),
    func: t('func@laserena.cl'), func2: t('func2@laserena.cl')
  };
  return ctx;
}
const codigos = r => r.cuerpo.data.map(a => a.codigo_atencion).sort();

// ── Sesión ──────────────────────────────────────────────────────────────────
test('sin token, con token basura o firmado con otra clave → 401', async () => {
  const c = nuevo();
  assert.equal((await c.llamar('GET', '/atenciones')).statusCode, 401);
  assert.equal((await c.llamar('GET', '/atenciones', { token: 'abc.def.ghi' })).statusCode, 401);
  const falso = jwtStub.sign({ id: 1 }, 'otra-clave-cualquiera-123', { expiresIn: '8h' });
  assert.equal((await c.llamar('GET', '/usuarios', { token: falso })).statusCode, 401);
});

test('el rol del token no se usa: se lee de la base en cada solicitud', async () => {
  const c = nuevo();
  const forjado = jwtStub.sign({ id: idDe(c.db, 'func@laserena.cl'), rol: 'Superadministrador' }, process.env.JWT_SECRET, { expiresIn: '8h' });
  assert.equal((await c.llamar('GET', '/usuarios', { token: forjado })).statusCode, 403);
});

test('desactivar a un usuario invalida su token al instante', async () => {
  const c = nuevo();
  assert.equal((await c.llamar('GET', '/atenciones', { token: c.t.func })).statusCode, 200);
  c.db.sqlite.exec("UPDATE usuarios SET estado = 'Inactivo' WHERE correo = 'func@laserena.cl'");
  assert.equal((await c.llamar('GET', '/atenciones', { token: c.t.func })).statusCode, 401);
});

test('un cambio de rol se aplica sin volver a iniciar sesión', async () => {
  const c = nuevo();
  assert.equal((await c.llamar('GET', '/usuarios', { token: c.t.func })).statusCode, 403);
  c.db.sqlite.exec("UPDATE usuarios SET rol = 'Coordinador' WHERE correo = 'func@laserena.cl'");
  assert.equal((await c.llamar('GET', '/usuarios', { token: c.t.func })).statusCode, 200);
});

test('login: devuelve permisos y delegaciones del servidor', async () => {
  const c = nuevo();
  const r = await c.llamar('POST', '/auth/login', { body: { correo: 'func@laserena.cl', password: 'admin' } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.cuerpo.user.permisos, { atenciones: ['ver', 'crear'] });
  assert.deepEqual(r.cuerpo.user.delegaciones.map(d => d.codigo), ['DEL-01']);
  assert.equal(r.cuerpo.user.delegacionActiva.codigo, 'DEL-01');
  assert.equal(r.cuerpo.user.password, undefined);
});

test('login: rol desconocido, cuenta inactiva y cuenta sin delegación se rechazan', async () => {
  const c = nuevo();
  const entrar = correo => c.llamar('POST', '/auth/login', { body: { correo, password: 'admin' } });
  assert.equal((await entrar('rara@laserena.cl')).statusCode, 403);
  assert.equal((await entrar('inactiva@laserena.cl')).statusCode, 403);
  assert.equal((await entrar('sindel@laserena.cl')).statusCode, 403);
  assert.equal((await entrar('noexiste@laserena.cl')).statusCode, 401);
  assert.equal((await c.llamar('POST', '/auth/login', { body: {} })).statusCode, 400);
});

test('rol desconocido con token válido: no puede hacer nada', async () => {
  const c = nuevo();
  const tok = tokenDe(c, 'rara@laserena.cl');
  for (const m of ['atenciones', 'usuarios', 'roles', 'delegaciones']) {
    assert.equal((await c.llamar('GET', `/${m}`, { token: tok })).statusCode, 403, m);
  }
});

// ── Permisos por rol (servidor) ─────────────────────────────────────────────
test('funcionario: no accede a otros módulos ni puede eliminar', async () => {
  const c = nuevo();
  for (const m of ['usuarios', 'delegaciones', 'roles', 'items-metas', 'tipos-atencion', 'sub-atenciones']) {
    assert.equal((await c.llamar('GET', `/${m}`, { token: c.t.func })).statusCode, 403, `GET ${m}`);
    assert.equal((await c.llamar('GET', `/${m}/export`, { token: c.t.func })).statusCode, 403, `export ${m}`);
  }
  assert.equal((await c.llamar('DELETE', '/atenciones/1', { token: c.t.func })).statusCode, 403);
  assert.equal((await c.llamar('PUT', '/atenciones/1', { token: c.t.func, body: { detalle: 'x' } })).statusCode, 403);
});

test('coordinador: edita pero no elimina; no toca roles', async () => {
  const c = nuevo();
  assert.equal((await c.llamar('DELETE', '/usuarios/5', { token: c.t.coord })).statusCode, 403);
  assert.equal((await c.llamar('DELETE', '/tipos-atencion/1', { token: c.t.coord })).statusCode, 403);
  assert.equal((await c.llamar('POST', '/roles', { token: c.t.coord, body: { nombre: 'Nuevo' } })).statusCode, 403);
  assert.equal((await c.llamar('GET', '/roles', { token: c.t.coord })).statusCode, 200);
});

test('delegado municipal: ve y registra atenciones, no edita', async () => {
  const c = nuevo();
  assert.equal((await c.llamar('GET', '/atenciones', { token: c.t.deleg })).statusCode, 200);
  assert.equal((await c.llamar('POST', '/atenciones', { token: c.t.deleg, body: { ciudadano: 'Luz', tipo: 'Consulta', detalle: 'd' } })).statusCode, 200);
  assert.equal((await c.llamar('PUT', '/atenciones/3', { token: c.t.deleg, body: { detalle: 'x' } })).statusCode, 403);
  assert.equal((await c.llamar('GET', '/roles', { token: c.t.deleg })).statusCode, 403);
});

test('superadministrador: puede eliminar en todos los módulos', async () => {
  const c = nuevo();
  assert.equal((await c.llamar('DELETE', '/atenciones/1', { token: c.t.sup })).statusCode, 200);
  assert.equal((await c.llamar('POST', '/roles', { token: c.t.sup, body: { nombre: 'Auditor' } })).statusCode, 200);
});

// ── Delegación activa ───────────────────────────────────────────────────────
test('funcionario solo ve las atenciones que él registró', async () => {
  const c = nuevo();
  assert.deepEqual(codigos(await c.llamar('GET', '/atenciones', { token: c.t.func })), ['A-1']);
  assert.deepEqual(codigos(await c.llamar('GET', '/atenciones', { token: c.t.func2 })), ['A-2']);
  assert.equal((await c.llamar('GET', '/atenciones/2', { token: c.t.func })).statusCode, 404);
});

test('coordinador con dos delegaciones: el encabezado X-Delegacion cambia lo que ve', async () => {
  const c = nuevo();
  assert.deepEqual(codigos(await c.llamar('GET', '/atenciones', { token: c.t.coord })), ['A-1', 'A-2']);
  assert.deepEqual(codigos(await c.llamar('GET', '/atenciones', { token: c.t.coord, delegacion: 2 })), ['A-3']);
  assert.equal((await c.llamar('GET', '/atenciones/3', { token: c.t.coord })).statusCode, 404);
  assert.equal((await c.llamar('GET', '/atenciones/3', { token: c.t.coord, delegacion: 2 })).statusCode, 200);
});

test('no se puede operar en una delegación no autorizada, inexistente o inactiva', async () => {
  const c = nuevo();
  for (const d of [1, 3, 99, 'abc', '1 OR 1=1']) {
    const r = await c.llamar('GET', '/atenciones', { token: c.t.deleg, delegacion: d });
    assert.equal(r.statusCode, 403, String(d));
  }
  assert.equal((await c.llamar('GET', '/atenciones', { token: c.t.sup, delegacion: 3 })).statusCode, 403); // inactiva
  assert.equal((await c.llamar('GET', '/atenciones', { token: c.t.func, delegacion: 2 })).statusCode, 403);
});

test('superadministrador puede elegir cualquier delegación activa', async () => {
  const c = nuevo();
  assert.deepEqual(codigos(await c.llamar('GET', '/atenciones', { token: c.t.sup, delegacion: 2 })), ['A-3']);
  assert.deepEqual(codigos(await c.llamar('GET', '/atenciones', { token: c.t.sup, delegacion: 1 })), ['A-1', 'A-2']);
});

test('la exportación respeta el mismo alcance que el listado', async () => {
  const c = nuevo();
  const r = await c.llamar('GET', '/atenciones/export', { token: c.t.coord, delegacion: 2 });
  assert.equal(r.statusCode, 200);
  assert.match(r.cuerpo, /A-3/);
  assert.doesNotMatch(r.cuerpo, /A-1|A-2/);
  const f = await c.llamar('GET', '/atenciones/export', { token: c.t.func });
  assert.match(f.cuerpo, /A-1/);
  assert.doesNotMatch(f.cuerpo, /A-2|A-3/);
});

test('editar o eliminar fuera de la delegación activa → 404 y no cambia nada', async () => {
  const c = nuevo();
  assert.equal((await c.llamar('PUT', '/atenciones/3', { token: c.t.coord, body: { detalle: 'hack' } })).statusCode, 404);
  assert.equal((await c.llamar('DELETE', '/atenciones/3', { token: c.t.sup })).statusCode, 404); // activa por defecto: DEL-01
  const fila = c.db.sqlite.prepare('SELECT detalle FROM atenciones_ciudadanas WHERE id = 3').get();
  assert.equal(fila.detalle, 'poda');
});

test('una atención nueva toma delegación y responsable de la sesión, no del formulario', async () => {
  const c = nuevo();
  const r = await c.llamar('POST', '/atenciones', {
    token: c.t.func, body: { ciudadano: 'Mario', tipo: 'Reclamo', detalle: 'x', delegacion_id: 2, usuario_id: 1 }
  });
  assert.equal(r.statusCode, 200);
  const fila = c.db.sqlite.prepare('SELECT delegacion_id, usuario_id FROM atenciones_ciudadanas WHERE id = ?').get(r.cuerpo.id);
  assert.deepEqual({ ...fila }, { delegacion_id: 1, usuario_id: idDe(c.db, 'func@laserena.cl') });
});

test('crear atención en otra delegación autorizada usa la delegación activa elegida', async () => {
  const c = nuevo();
  const r = await c.llamar('POST', '/atenciones', { token: c.t.coord, delegacion: 2, body: { ciudadano: 'Nora', tipo: 'Consulta', detalle: 'x' } });
  assert.equal(r.statusCode, 200);
  const fila = c.db.sqlite.prepare('SELECT delegacion_id FROM atenciones_ciudadanas WHERE id = ?').get(r.cuerpo.id);
  assert.equal(fila.delegacion_id, 2);
});

test('usuario sin delegación no puede registrar atenciones', async () => {
  const c = nuevo();
  const tok = tokenDe(c, 'sindel@laserena.cl');
  assert.equal((await c.llamar('POST', '/atenciones', { token: tok, body: { ciudadano: 'X', tipo: 'Y' } })).statusCode, 403);
});

test('sin migración: el módulo de atenciones responde 503 en vez de mostrar todo', async () => {
  const c = nuevo({ migrada: false });
  const r = await c.llamar('GET', '/atenciones', { token: c.t.sup });
  assert.equal(r.statusCode, 503);
  assert.equal((await c.llamar('GET', '/usuarios', { token: c.t.sup })).statusCode, 200);
});

// ── Usuarios: alcance y escalada de privilegios ─────────────────────────────
test('coordinador solo ve usuarios de su delegación activa', async () => {
  const c = nuevo();
  const r = await c.llamar('GET', '/usuarios', { token: c.t.coord });
  assert.ok(r.cuerpo.data.every(u => u.delegacion === 'DEL-01'));
  assert.ok(!r.cuerpo.data.some(u => u.correo === 'delegado@laserena.cl'));
  const r2 = await c.llamar('GET', '/usuarios', { token: c.t.coord, delegacion: 2 });
  assert.ok(r2.cuerpo.data.some(u => u.correo === 'delegado@laserena.cl'));
});

test('las contraseñas nunca salen en listados, detalle ni exportación', async () => {
  const c = nuevo();
  c.db.sqlite.exec("UPDATE usuarios SET password = 'SECRETO-123'");
  const l = await c.llamar('GET', '/usuarios', { token: c.t.sup });
  const d = await c.llamar('GET', '/usuarios/1', { token: c.t.sup });
  const e = await c.llamar('GET', '/usuarios/export', { token: c.t.sup });
  for (const r of [l, d, e]) assert.doesNotMatch(JSON.stringify(r.cuerpo), /SECRETO-123/);
});

test('un coordinador no puede crear ni ascender a superadministradores', async () => {
  const c = nuevo();
  const crear = await c.llamar('POST', '/usuarios', { token: c.t.coord, body: { rut: '9-9', nombre: 'Intruso', rol: 'Superadministrador' } });
  assert.equal(crear.statusCode, 403);
  const subir = await c.llamar('PUT', '/usuarios/4', { token: c.t.coord, body: { rol: 'Superadministrador' } });
  assert.equal(subir.statusCode, 403);
  const tocar = await c.llamar('PUT', '/usuarios/1', { token: c.t.coord, body: { nombre: 'Hackeado' } });
  assert.ok([403, 404].includes(tocar.statusCode));
  assert.equal(c.db.sqlite.prepare('SELECT nombre FROM usuarios WHERE id = 1').get().nombre, 'Sara Super');
});

test('rol inválido y delegación no autorizada se rechazan al crear usuarios', async () => {
  const c = nuevo();
  assert.equal((await c.llamar('POST', '/usuarios', { token: c.t.coord, body: { rut: '9-9', nombre: 'Zoe', rol: 'Jefe Supremo' } })).statusCode, 400);
  assert.equal((await c.llamar('POST', '/usuarios', { token: c.t.coord, body: { rut: '9-9', nombre: 'Zoe', rol: 'Funcionario', delegacion: 'DEL-03' } })).statusCode, 403);
  const ok = await c.llamar('POST', '/usuarios', { token: c.t.coord, body: { rut: '9-9', nombre: 'Zoe', rol: 'funcionario', delegacion: 'del-02' } });
  assert.equal(ok.statusCode, 200);
  assert.equal(c.db.sqlite.prepare('SELECT rol FROM usuarios WHERE id = ?').get(ok.cuerpo.id).rol, 'Funcionario');
});

test('nadie cambia su propio rol o estado ni se elimina a sí mismo', async () => {
  const c = nuevo();
  assert.equal((await c.llamar('PUT', '/usuarios/2', { token: c.t.coord, body: { rol: 'Funcionario' } })).statusCode, 403);
  assert.equal((await c.llamar('PUT', '/usuarios/2', { token: c.t.coord, body: { estado: 'Inactivo' } })).statusCode, 403);
  assert.equal((await c.llamar('DELETE', '/usuarios/1', { token: c.t.sup })).statusCode, 403);
});

// ── Comportamiento general ──────────────────────────────────────────────────
test('PUT parcial: no borra los campos que no se enviaron', async () => {
  const c = nuevo();
  const r = await c.llamar('PUT', '/atenciones/1', { token: c.t.coord, body: { estado: 'Inactivo' } });
  assert.equal(r.statusCode, 200);
  const fila = c.db.sqlite.prepare('SELECT ciudadano, detalle, estado FROM atenciones_ciudadanas WHERE id = 1').get();
  assert.deepEqual({ ...fila }, { ciudadano: 'Ana', detalle: 'luz', estado: 'Inactivo' });
  assert.equal((await c.llamar('PUT', '/atenciones/1', { token: c.t.coord, body: { delegacion_id: 2 } })).statusCode, 400);
});

test('la exportación neutraliza fórmulas de planilla', async () => {
  const c = nuevo();
  c.db.sqlite.exec("UPDATE atenciones_ciudadanas SET ciudadano = '=HYPERLINK(\"http://x\")' WHERE id = 1");
  const r = await c.llamar('GET', '/atenciones/export', { token: c.t.func });
  assert.match(r.cuerpo, /"'=HYPERLINK/);
});

test('validaciones: nombres con símbolos, ids raros y paginación fuera de rango', async () => {
  const c = nuevo();
  assert.equal((await c.llamar('POST', '/atenciones', { token: c.t.func, body: { ciudadano: 'Ana<script>', tipo: 'x' } })).statusCode, 400);
  assert.equal((await c.llamar('GET', '/atenciones/abc', { token: c.t.coord })).statusCode, 404);
  const p = await c.llamar('GET', '/atenciones?page=99&limit=5000', { token: c.t.coord });
  assert.equal(p.statusCode, 200);
  assert.equal(p.cuerpo.pagination.limit, 100);
  assert.equal(p.cuerpo.pagination.page, 1);
});

test('búsqueda sin distinguir mayúsculas dentro del alcance', async () => {
  const c = nuevo();
  assert.deepEqual(codigos(await c.llamar('GET', '/atenciones?search=ANA', { token: c.t.coord })), ['A-1']);
  assert.deepEqual(codigos(await c.llamar('GET', '/atenciones?search=cora', { token: c.t.coord })), []);
});

test('tipos de atención con sub-atenciones no se pueden eliminar', async () => {
  const c = nuevo();
  const r = await c.llamar('DELETE', '/tipos-atencion/1', { token: c.t.sup });
  assert.equal(r.statusCode, 400);
});

test('la asignación por tabla usuario_delegaciones también acepta códigos de texto', async () => {
  const c = nuevo({ udPorId: false });
  c.db.sqlite.exec("DELETE FROM usuario_delegaciones; INSERT INTO usuario_delegaciones VALUES (2, 'del-02')");
  assert.deepEqual(codigos(await c.llamar('GET', '/atenciones', { token: c.t.coord, delegacion: 2 })), ['A-3']);
});

test('sin columna usuarios.delegacion funciona solo con usuario_delegaciones', async () => {
  const c = cargar({ columnaDelegacionUsuarios: false });
  c.db.sqlite.exec(`INSERT INTO delegaciones (codigo, nombre) VALUES ('DEL-01','Central');
    INSERT INTO usuarios (rut, nombre, correo, rol) VALUES ('1-1','Pía','pia@laserena.cl','Coordinador');
    INSERT INTO usuario_delegaciones VALUES (1, 1);`);
  const tok = c.auth.firmarToken(1);
  assert.equal((await c.llamar('GET', '/atenciones', { token: tok })).statusCode, 200);
  assert.equal((await c.llamar('GET', '/usuarios', { token: tok })).statusCode, 200);
});
