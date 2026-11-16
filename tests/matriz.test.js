'use strict';
// Matriz SGR: reglas 1-5 y 7-9, tubo, semáforo y permisos por cargo, probados contra la API.
const test = require('node:test');
const assert = require('node:assert/strict');
const { nuevo } = require('./helpers/entorno');
const { main } = require('../scripts/preparar-demo');
const preparar = require('../scripts/preparar-matriz');

const CLAVE = 'Demo2026x';
const silencio = () => {};
const dos = n => String(n).padStart(2, '0');
const txt = d => `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`;
const sumar = (f, n) => { const d = new Date(`${f}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return txt(d); };
const { hoyChile, lunesDe } = require('../src/utils/fechas');

async function conMatriz() {
  const c = await nuevo();
  await main({ aplicar: true, forzar: false, claveDemo: CLAVE }, silencio);
  await preparar.main({ aplicar: true, claveDemo: CLAVE, datosDemo: false }, silencio);
  const hoy = hoyChile();
  // el período de la planilla es fijo; para las pruebas se desplaza para que siempre cubra "hoy"
  c.db.sqlite.prepare('UPDATE periodos SET fecha_inicio = ?, fecha_fin = ?').run(sumar(hoy, -60), sumar(hoy, 60));
  c.hoy = hoy;
  c.u = {};
  const claves = { apoyo: 'apoyo', organizaciones: 'organizaciones', social: 'social', planificacion: 'planificacion', servicios: 'servicios', seguridad: 'seguridad', compras: 'compras', delegado: 'delegado', coordinador: 'coordinador', consultor: 'consultor' };
  for (const k of Object.keys(claves)) {
    const r = await c.login(`${k}@demo.sgr.cl`, CLAVE);
    assert.equal(r.statusCode, 200, `login ${k}: ${JSON.stringify(r.cuerpo)}`);
    c.u[k] = { token: r.cuerpo.token, user: r.cuerpo.user, id: r.cuerpo.user.id };
  }
  c.item = codigo => c.db.sqlite.prepare('SELECT id_item FROM items_metas WHERE codigo = ?').get(codigo).id_item;
  c.post = (quien, ruta, body) => c.llamar('POST', ruta, { token: c.u[quien].token, body });
  c.get = (quien, ruta) => c.llamar('GET', ruta, { token: c.u[quien].token });
  c.put = (quien, ruta, body) => c.llamar('PUT', ruta, { token: c.u[quien].token, body });
  c.del = (quien, ruta) => c.llamar('DELETE', ruta, { token: c.u[quien].token });
  return c;
}

const ges = (c, extra = {}) => ({
  fecha_gestion: c.hoy, actividad: 'Atención de vecino en mesón', id_item: c.item('ATN-USU'),
  contacto_nombre: 'Vecino de Ejemplo', contacto_telefono: '+56912345678', ...extra
});

test('preparar-matriz: carga período, ítems, cargos y metas; es idempotente', async () => {
  const c = await conMatriz();
  const s = c.db.sqlite;
  const cuenta = t => s.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  assert.equal(cuenta('periodos'), 1);
  assert.equal(cuenta('items_metas'), 31);                 // 30 de la matriz + IT01 de prueba
  assert.ok(cuenta('metas_cargo') > 30);
  const antes = [cuenta('metas_cargo'), cuenta('roles'), cuenta('usuarios')];
  await preparar.main({ aplicar: true, claveDemo: CLAVE, datosDemo: false }, silencio);
  assert.deepEqual([cuenta('metas_cargo'), cuenta('roles'), cuenta('usuarios')], antes);
});

test('preparar-matriz: en simulación no cambia nada y con datos demo carga gestiones ficticias', async () => {
  const c = await nuevo();
  await main({ aplicar: true, forzar: false, claveDemo: CLAVE }, silencio);
  await preparar.main({ aplicar: false }, silencio);
  assert.equal(c.db.sqlite.prepare('SELECT COUNT(*) n FROM periodos').get().n, 0);
  await preparar.main({ aplicar: true, claveDemo: CLAVE, datosDemo: true }, silencio);
  assert.ok(c.db.sqlite.prepare('SELECT COUNT(*) n FROM gestiones').get().n > 0);
  assert.ok(c.db.sqlite.prepare("SELECT COUNT(*) n FROM tubo WHERE codigo LIKE 'TUB-%'").get().n > 0);
});

test('gestión válida: genera código GES-, puntúa y aparece solo en la lista de su dueño', async () => {
  const c = await conMatriz();
  const r = await c.post('apoyo', '/gestiones', ges(c));
  assert.equal(r.statusCode, 201, JSON.stringify(r.cuerpo));
  assert.match(r.cuerpo.codigo, /^GES-\d{5}$/);
  assert.equal(r.cuerpo.puntua, true);
  const mia = await c.get('apoyo', '/gestiones');
  assert.equal(mia.cuerpo.data.length, 1);
  const otra = await c.get('organizaciones', '/gestiones');
  assert.equal(otra.cuerpo.data.length, 0);                 // sin «equipo:ver» solo ve lo suyo
  const deleg = await c.get('delegado', '/gestiones');
  assert.equal(deleg.cuerpo.data.length, 1);                // el delegado ve a todo el equipo
});

test('regla 1: si el usuario atendido es el delegado, la gestión se guarda pero no puntúa', async () => {
  const c = await conMatriz();
  const r = await c.post('apoyo', '/gestiones', ges(c, { usuario_es_delegado: true }));
  assert.equal(r.statusCode, 201);
  assert.equal(r.cuerpo.puntua, false);
  assert.match(r.cuerpo.aviso, /delegado/i);
  // también se detecta por nombre
  const r2 = await c.post('apoyo', '/gestiones', ges(c, { contacto_nombre: 'Diego Delegado' }));
  assert.equal(r2.cuerpo.puntua, false);
});

test('regla 2: sin nombre o sin teléfono del usuario no puntúa (solo en ítems que lo exigen)', async () => {
  const c = await conMatriz();
  const sinTel = await c.post('apoyo', '/gestiones', ges(c, { contacto_telefono: undefined }));
  assert.equal(sinTel.statusCode, 201);
  assert.equal(sinTel.cuerpo.puntua, false);
  const sinNombre = await c.post('apoyo', '/gestiones', ges(c, { contacto_nombre: undefined }));
  assert.equal(sinNombre.cuerpo.puntua, false);
  // el informe de inventarios no exige contacto
  const inv = await c.post('apoyo', '/gestiones', ges(c, { id_item: c.item('INF-INV'), contacto_nombre: undefined, contacto_telefono: undefined, actividad: 'Informe de inventario' }));
  assert.equal(inv.cuerpo.puntua, true);
  // teléfono inválido se rechaza
  const mal = await c.post('apoyo', '/gestiones', ges(c, { contacto_telefono: '12' }));
  assert.equal(mal.statusCode, 400);
});

test('regla 5: una coordinación previa no puntúa', async () => {
  const c = await conMatriz();
  const r = await c.post('apoyo', '/gestiones', ges(c, { es_coordinacion: true }));
  assert.equal(r.statusCode, 201);
  assert.equal(r.cuerpo.puntua, false);
});

test('regla 3: máximo 7 gestiones por día; las emergencias no cuentan', async () => {
  const c = await conMatriz();
  for (let i = 0; i < 7; i++) assert.equal((await c.post('apoyo', '/gestiones', ges(c))).statusCode, 201, `gestión ${i + 1}`);
  const octava = await c.post('apoyo', '/gestiones', ges(c));
  assert.equal(octava.statusCode, 409);
  assert.match(octava.cuerpo.message, /7/);
  // otro día sí se puede (dentro de la ventana de ingreso)
  assert.equal((await c.post('apoyo', '/gestiones', ges(c, { fecha_gestion: sumar(c.hoy, -1) }))).statusCode, 201);
  // y la emergencia queda fuera del tope
  const em = await c.post('apoyo', '/gestiones', ges(c, { id_item: c.item('EMERG'), actividad: 'Emergencia por lluvia', contacto_nombre: undefined, contacto_telefono: undefined }));
  assert.equal(em.statusCode, 201, JSON.stringify(em.cuerpo));
  // el tope es por persona
  assert.equal((await c.post('social', '/gestiones', ges(c, { id_item: c.item('ATN-SOC') }))).statusCode, 201);
});

test('regla 4: semana cerrada y fechas futuras se rechazan; la semana anterior sigue abierta hasta el martes', async () => {
  const c = await conMatriz();
  const cerrada = sumar(lunesDe(c.hoy), -8);
  const r = await c.post('apoyo', '/gestiones', ges(c, { fecha_gestion: cerrada }));
  assert.equal(r.statusCode, 409, JSON.stringify(r.cuerpo));
  const futura = await c.post('apoyo', '/gestiones', ges(c, { fecha_gestion: sumar(c.hoy, 3) }));
  assert.equal(futura.statusCode, 409);
  // no se puede editar ni borrar una gestión que ya quedó en una semana cerrada
  const ok = await c.post('apoyo', '/gestiones', ges(c));
  const id = ok.cuerpo.id;
  c.db.sqlite.prepare('UPDATE gestiones SET fecha_gestion = ? WHERE id_gestion = ?').run(cerrada, id);
  assert.equal((await c.put('apoyo', `/gestiones/${id}`, { actividad: 'Cambio tardío de la actividad' })).statusCode, 409);
  assert.equal((await c.del('apoyo', `/gestiones/${id}`)).statusCode, 409);
});

test('ítems: solo los del cargo; nadie edita ni borra gestiones ajenas', async () => {
  const c = await conMatriz();
  const ajeno = await c.post('apoyo', '/gestiones', ges(c, { id_item: c.item('ATN-SOC') }));
  assert.equal(ajeno.statusCode, 400);
  const ok = await c.post('apoyo', '/gestiones', ges(c));
  const id = ok.cuerpo.id;
  assert.equal((await c.put('organizaciones', `/gestiones/${id}`, { actividad: 'Intento de cambio ajeno' })).statusCode, 404);
  assert.equal((await c.del('organizaciones', `/gestiones/${id}`)).statusCode, 404);
  assert.equal((await c.put('apoyo', `/gestiones/${id}`, { actividad: 'Actividad corregida por su dueña' })).statusCode, 200);
  assert.equal((await c.del('apoyo', `/gestiones/${id}`)).statusCode, 200);
});

test('tubo: se crea desde la gestión, avanza solo hacia adelante y alimenta el tablero', async () => {
  const c = await conMatriz();
  const g = await c.post('organizaciones', '/gestiones', ges(c, { id_item: c.item('VIS-ORG'), ingreso_tubo: true, actividad: 'Gestionar poda para la junta de vecinos' }));
  assert.equal(g.statusCode, 201, JSON.stringify(g.cuerpo));
  assert.match(g.cuerpo.tubo, /^TUB-\d{5}$/);
  let t = await c.get('organizaciones', '/tubo/tablero');
  assert.equal(t.statusCode, 200);
  assert.equal(t.cuerpo.indicadores.total, 1);
  assert.equal(t.cuerpo.indicadores.ingresadas, 1);
  const idTubo = c.db.sqlite.prepare('SELECT id_tubo id FROM tubo').get().id;
  const saltar = await c.put('organizaciones', `/tubo/${idTubo}/estado`, { estado: 'Realizado' });
  assert.equal(saltar.statusCode, 409);                      // no se puede saltar etapas
  for (const e of ['Pendiente', 'En proceso', 'Realizado']) assert.equal((await c.put('organizaciones', `/tubo/${idTubo}/estado`, { estado: e })).statusCode, 200, e);
  assert.equal((await c.put('organizaciones', `/tubo/${idTubo}/estado`, { estado: 'Pendiente' })).statusCode, 409);   // ni retroceder
  t = await c.get('organizaciones', '/tubo/tablero');
  assert.equal(t.cuerpo.indicadores.realizadas, 1);
  assert.equal(t.cuerpo.indicadores.tasaResolucion, 100);
  assert.equal((await c.put('organizaciones', `/tubo/${idTubo}`, { avance: 'Edición posterior' })).statusCode, 409);   // realizada: no se edita
});

test('tubo: es compartido por la delegación pero no se ve desde otra', async () => {
  const c = await conMatriz();
  await c.post('organizaciones', '/tubo', { titulo: 'Solicitud de prueba del tubo', solicitante: 'Junta Norte' });
  const otro = await c.get('social', '/tubo/tablero');
  assert.equal(otro.cuerpo.indicadores.total, 1);                   // misma delegación: lo ven los demás cargos
  const fuera = await c.llamar('GET', '/tubo/tablero', { token: c.u.coordinador.token, delegacion: 2 });
  assert.equal(fuera.cuerpo.indicadores.total, 0);
});

test('regla 8: felicitaciones y reclamos solo los registra el delegado, con respaldo y no a sí mismo', async () => {
  const c = await conMatriz();
  const body = { tipo: 'Felicitación', id_funcionario: c.u.apoyo.id, fecha: c.hoy, medio: 'Correo al delegado', detalle: 'Excelente atención a un vecino', respaldo: 'Correo del 10-11' };
  assert.equal((await c.post('apoyo', '/valoraciones', body)).statusCode, 403);          // un cargo no puede
  assert.equal((await c.post('delegado', '/valoraciones', { ...body, respaldo: undefined })).statusCode, 400);   // sin respaldo
  assert.equal((await c.post('delegado', '/valoraciones', { ...body, id_funcionario: c.u.delegado.id })).statusCode, 403);   // a sí mismo
  assert.equal((await c.post('delegado', '/valoraciones', body)).statusCode, 201);
  assert.equal((await c.post('delegado', '/valoraciones', { ...body, fecha: sumar(c.hoy, 2) })).statusCode, 400);   // futura
  // el funcionario ve solo lo suyo
  assert.equal((await c.get('apoyo', '/valoraciones')).cuerpo.data.length, 1);
  assert.equal((await c.get('organizaciones', '/valoraciones')).cuerpo.data.length, 0);
});

test('regla 9: las ausencias solo las ingresa el delegado y ajustan el objetivo del semáforo', async () => {
  const c = await conMatriz();
  const body = { id_usuario: c.u.apoyo.id, tipo: 'Vacaciones', fecha_desde: sumar(c.hoy, -10), fecha_hasta: sumar(c.hoy, -5) };
  assert.equal((await c.post('apoyo', '/ausencias', body)).statusCode, 403);
  assert.equal((await c.post('delegado', '/ausencias', { ...body, fecha_hasta: sumar(c.hoy, -20) })).statusCode, 400);
  const antes = (await c.get('apoyo', '/semaforo')).cuerpo;
  assert.equal((await c.post('delegado', '/ausencias', body)).statusCode, 201);
  const despues = (await c.get('apoyo', '/semaforo')).cuerpo;
  assert.ok(despues.objetivo.objetivo < antes.objetivo.objetivo, `objetivo ${antes.objetivo.objetivo} → ${despues.objetivo.objetivo}`);
  assert.equal(despues.objetivo.diasAusencia, 6);
});

test('semáforo: puntaje por ítem con tope del 120 %, solo cuentan las gestiones que puntúan', async () => {
  const c = await conMatriz();
  const antes = (await c.get('apoyo', '/semaforo')).cuerpo;
  assert.equal(antes.total, 0);
  // 3 con contacto (puntúan) y 1 sin teléfono (no puntúa)
  for (let i = 0; i < 3; i++) await c.post('apoyo', '/gestiones', ges(c));
  await c.post('apoyo', '/gestiones', ges(c, { contacto_telefono: undefined }));
  const r = (await c.get('apoyo', '/semaforo')).cuerpo;
  const it = r.items.find(x => x.codigo === 'ATN-USU');
  assert.equal(it.avance, 3);
  assert.equal(it.meta, 240);
  assert.ok(r.total > 0 && r.total < 0.01);
  assert.ok(['Verde', 'Naranjo', 'Rojo'].includes(r.semaforo));
  // sobre-cumplir no pasa del tope del ítem
  c.db.sqlite.prepare("UPDATE metas_cargo SET meta = 1 WHERE id_item = ?").run(c.item('ATN-USU'));
  const tope = (await c.get('apoyo', '/semaforo')).cuerpo.items.find(x => x.codigo === 'ATN-USU');
  assert.equal(tope.pct > 1.2, true);
  assert.equal(tope.pctTopado, 1.2);
  assert.equal(tope.topado, true);
});

test('equipo: el delegado ve a todos los cargos; un cargo normal no', async () => {
  const c = await conMatriz();
  const d = await c.get('delegado', '/semaforo/equipo');
  assert.equal(d.statusCode, 200);
  assert.ok(d.cuerpo.filas.length >= 6);
  assert.equal((await c.get('apoyo', '/semaforo/equipo')).statusCode, 403);
  assert.equal((await c.get('planificacion', '/semaforo/equipo')).statusCode, 200);   // Gestión y Planificación sí
});

test('metas por cargo y períodos: solo la Coordinación los administra, sin duplicados ni superposición', async () => {
  const c = await conMatriz();
  const m = c.db.sqlite.prepare('SELECT id_periodo p, id_rol r, id_item i FROM metas_cargo LIMIT 1').get();
  const dup = { id_periodo: m.p, id_rol: m.r, id_item: m.i, ponderador: 0.1, meta: 5, calculo: 'conteo' };
  assert.equal((await c.post('coordinador', '/metas-cargo', dup)).statusCode, 409);
  assert.equal((await c.post('delegado', '/metas-cargo', dup)).statusCode, 403);
  assert.equal((await c.post('apoyo', '/metas-cargo', dup)).statusCode, 403);
  const rec = { id_periodo: m.p, id_rol: m.r, id_item: c.item('TUBO-SOL'), ponderador: 0.1, meta: 5, calculo: 'reclamo' };
  assert.equal((await c.post('coordinador', '/metas-cargo', rec)).statusCode, 400);   // reclamo debe ser negativo
  const sup = { nombre: 'Período repetido', fecha_inicio: sumar(c.hoy, -5), fecha_fin: sumar(c.hoy, 5) };
  assert.equal((await c.post('coordinador', '/periodos', sup)).statusCode, 409);
  assert.equal((await c.post('coordinador', '/periodos', { nombre: 'Período futuro', fecha_inicio: sumar(c.hoy, 100), fecha_fin: sumar(c.hoy, 190) })).statusCode, 201);
});

test('el consultor solo lee la matriz y no registra nada', async () => {
  const c = await conMatriz();
  assert.equal((await c.get('consultor', '/gestiones')).statusCode, 200);
  assert.equal((await c.post('consultor', '/gestiones', ges(c))).statusCode, 403);
  assert.equal((await c.post('consultor', '/tubo', { titulo: 'No debería poder', solicitante: 'Alguien' })).statusCode, 403);
});

test('los cargos sin metas en el período (Compras) no pueden registrar gestiones', async () => {
  const c = await conMatriz();
  const r = await c.post('compras', '/gestiones', ges(c));
  assert.equal(r.statusCode, 400);
});

test('exportaciones a Excel de gestiones y del equipo', async () => {
  const c = await conMatriz();
  await c.post('apoyo', '/gestiones', ges(c));
  const x = await c.get('apoyo', '/gestiones/export');
  assert.equal(x.statusCode, 200);
  const e = await c.get('delegado', '/semaforo/equipo/export');
  assert.equal(e.statusCode, 200);
  assert.equal((await c.get('apoyo', '/semaforo/equipo/export')).statusCode, 403);
});
