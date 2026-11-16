'use strict';
// Ampliación de la matriz: código por área, foto y verificación, tubo de cartas, catálogo de organizaciones e importador.
const test = require('node:test');
const assert = require('node:assert/strict');
const { nuevo } = require('./helpers/entorno');
const { main } = require('../scripts/preparar-demo');
const preparar = require('../scripts/preparar-matriz');
const jjvv = require('../scripts/importar-jjvv');
const { hoyChile } = require('../src/utils/fechas');

const CLAVE = 'Demo2026x';
const silencio = () => {};
const dos = n => String(n).padStart(2, '0');
const sumar = (f, n) => { const d = new Date(`${f}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`; };

async function conMatriz() {
  const c = await nuevo();
  await main({ aplicar: true, forzar: false, claveDemo: CLAVE }, silencio);
  await preparar.main({ aplicar: true, claveDemo: CLAVE, datosDemo: false }, silencio);
  c.hoy = hoyChile();
  c.db.sqlite.prepare('UPDATE periodos SET fecha_inicio = ?, fecha_fin = ?').run(sumar(c.hoy, -60), sumar(c.hoy, 60));
  c.u = {};
  for (const k of ['apoyo', 'organizaciones', 'social', 'planificacion', 'delegado', 'coordinador', 'consultor']) {
    const r = await c.login(`${k}@demo.sgr.cl`, CLAVE);
    assert.equal(r.statusCode, 200, k);
    c.u[k] = { token: r.cuerpo.token, id: r.cuerpo.user.id };
  }
  c.item = codigo => c.db.sqlite.prepare('SELECT id_item FROM items_metas WHERE codigo = ?').get(codigo).id_item;
  c.post = (q, ruta, body) => c.llamar('POST', ruta, { token: c.u[q].token, body });
  c.get = (q, ruta) => c.llamar('GET', ruta, { token: c.u[q].token });
  c.put = (q, ruta, body) => c.llamar('PUT', ruta, { token: c.u[q].token, body });
  c.del = (q, ruta) => c.llamar('DELETE', ruta, { token: c.u[q].token });
  return c;
}
const ges = (c, extra = {}) => ({
  fecha_gestion: c.hoy, actividad: 'Atención de vecino en mesón', id_item: c.item('ATN-USU'),
  contacto_nombre: 'Vecino de Ejemplo', contacto_telefono: '+56912345678', ...extra
});

test('código de la matriz: área + mes + día + número correlativo; Gestor Social usa SOC-', async () => {
  const c = await conMatriz();
  const [, mes, dia] = c.hoy.split('-').map(Number);
  const a = await c.post('apoyo', '/gestiones', ges(c));
  const b = await c.post('apoyo', '/gestiones', ges(c));
  assert.equal(a.cuerpo.codigo_area, `APA${mes}${dia}1`);
  assert.equal(b.cuerpo.codigo_area, `APA${mes}${dia}2`);
  assert.match(a.cuerpo.codigo, /^GES-\d{5}$/);
  const s = await c.post('social', '/gestiones', ges(c, { id_item: c.item('ATN-SOC') }));
  assert.equal(s.statusCode, 201, JSON.stringify(s.cuerpo));
  assert.match(s.cuerpo.codigo, /^SOC-\d{5}$/);
  assert.equal(s.cuerpo.codigo_area, `GSOC${mes}${dia}1`);
  const lista = await c.get('apoyo', '/gestiones');
  assert.equal(lista.cuerpo.data[0].codigo_area.startsWith('APA'), true);
});

test('el tubo enlaza a la gestión SOC- del Gestor Social', async () => {
  const c = await conMatriz();
  const g = await c.post('social', '/gestiones', ges(c, { id_item: c.item('ATN-SOC'), ingreso_tubo: true, actividad: 'Visita social solicitada por vecina' }));
  assert.equal(g.statusCode, 201, JSON.stringify(g.cuerpo));
  const t = await c.get('social', '/tubo/tablero');
  assert.match(t.cuerpo.columnas.Ingresado[0].codigo_gestion, /^SOC-/);
});

test('foto y verificación: la hace la jefatura, no el dueño; el período puede exigirla', async () => {
  const c = await conMatriz();
  const g = await c.post('apoyo', '/gestiones', ges(c, { codigo_foto: 'IMG_2026-1' }));
  assert.equal(g.statusCode, 201, JSON.stringify(g.cuerpo));
  assert.equal((await c.post('apoyo', '/gestiones', ges(c, { codigo_foto: 'foto<script>' }))).statusCode, 400);
  const id = g.cuerpo.id;
  // el dueño y otros cargos no verifican
  assert.equal((await c.put('apoyo', `/gestiones/${id}/verificar`, { verificada: true })).statusCode, 403);
  assert.equal((await c.put('organizaciones', `/gestiones/${id}/verificar`, { verificada: true })).statusCode, 403);
  assert.equal((await c.put('delegado', `/gestiones/${id}/verificar`, { verificada: 'quizás' })).statusCode, 400);
  // sin exigencia, el puntaje no depende de la verificación
  const antes = (await c.get('apoyo', '/semaforo')).cuerpo.items.find(i => i.codigo === 'ATN-USU').avance;
  assert.equal(antes, 1);
  // con exigencia, solo cuentan las verificadas
  c.db.sqlite.prepare('UPDATE periodos SET exigir_verificacion = 1').run();
  assert.equal((await c.get('apoyo', '/semaforo')).cuerpo.items.find(i => i.codigo === 'ATN-USU').avance, 0);
  const v = await c.put('delegado', `/gestiones/${id}/verificar`, { verificada: true });
  assert.equal(v.statusCode, 200, JSON.stringify(v.cuerpo));
  assert.equal((await c.get('apoyo', '/semaforo')).cuerpo.items.find(i => i.codigo === 'ATN-USU').avance, 1);
  const det = await c.get('delegado', `/gestiones/${id}`);
  assert.equal(det.cuerpo.data.imagen_verificada, 1);
  assert.equal(det.cuerpo.data.fecha_verificacion, c.hoy);
  assert.equal((await c.put('delegado', `/gestiones/${id}/verificar`, { verificada: false })).statusCode, 200);
  assert.equal((await c.get('apoyo', '/semaforo')).cuerpo.items.find(i => i.codigo === 'ATN-USU').avance, 0);
});

test('tubo de cartas: alta, código CAR-, resumen como la planilla y permisos', async () => {
  const c = await conMatriz();
  const base = { fecha: c.hoy, numero: '10219', para: 'Alcaldesa', remite: 'María Rojas', tema: 'Carta de felicitaciones para funcionarios de seguridad' };
  const r = await c.post('delegado', '/cartas', base);
  assert.equal(r.statusCode, 201, JSON.stringify(r.cuerpo));
  assert.match(r.cuerpo.codigo, /^CAR-\d{5}$/);
  await c.post('delegado', '/cartas', { ...base, numero: '10220', estado: 'Finalizada', pronunciamiento: 'Delegado', derivada_a: 'Departamento de Aseo' });
  await c.post('delegado', '/cartas', { ...base, numero: '10221', estado: 'No aplica' });
  const res = (await c.get('delegado', '/cartas/resumen')).cuerpo.resumen;
  assert.deepEqual(res, { enProceso: 1, aprobadas: 0, finalizadas: 1, noAplica: 1, total: 2, totalIngresadas: 3 });
  assert.equal((await c.get('apoyo', '/cartas')).cuerpo.data.length, 3);          // misma delegación: lo ven los cargos
  assert.equal((await c.post('apoyo', '/cartas', base)).statusCode, 403);          // pero no las registran
  assert.equal((await c.post('consultor', '/cartas', base)).statusCode, 403);
  assert.equal((await c.post('delegado', '/cartas', { ...base, fecha: sumar(c.hoy, 2) })).statusCode, 400);
  assert.equal((await c.post('delegado', '/cartas', { ...base, para: 'Concejal' })).statusCode, 400);
  assert.equal((await c.put('delegado', `/cartas/${r.cuerpo.id}`, { estado: 'Aprobada' })).statusCode, 200);
  assert.equal((await c.get('delegado', '/cartas/export')).statusCode, 200);
  assert.equal((await c.get('apoyo', '/cartas/export')).statusCode, 403);
  const fuera = await c.llamar('GET', '/cartas/resumen', { token: c.u.coordinador.token, delegacion: 2 });
  assert.equal(fuera.cuerpo.resumen.totalIngresadas, 0);
});

test('catálogo de organizaciones: CRUD, sin nombres repetidos y búsqueda para el autocompletar', async () => {
  const c = await conMatriz();
  const o = { nombre: 'Junta de Vecinos Las Compañías', domicilio: 'Calle Uno 123', territorio: 'LAS COMPAÑIAS', socios_activos: 120 };
  const r = await c.post('coordinador', '/organizaciones', o);
  assert.equal(r.statusCode, 201, JSON.stringify(r.cuerpo));
  assert.equal((await c.post('coordinador', '/organizaciones', o)).statusCode, 409);
  assert.equal((await c.post('apoyo', '/organizaciones', { ...o, nombre: 'Otra' })).statusCode, 403);
  assert.equal((await c.get('apoyo', '/lookup/organizaciones?q=compa')).cuerpo.data.length, 1);
  assert.equal((await c.get('apoyo', '/lookup/organizaciones?q=c')).cuerpo.data.length, 0);          // mínimo 2 letras
  assert.equal((await c.get('apoyo', '/lookup/organizaciones?q=%25')).cuerpo.data.length, 0);          // el comodín no es especial
});

test('tubo con organización del catálogo: toma el territorio; no se borra una organización en uso', async () => {
  const c = await conMatriz();
  const org = (await c.post('coordinador', '/organizaciones', { nombre: 'Club Deportivo El Faro', territorio: 'ANTENA' })).cuerpo.id;
  const t = await c.post('organizaciones', '/tubo', { titulo: 'Solicitud de implementos deportivos', solicitante: 'Club Deportivo El Faro', id_organizacion: org });
  assert.equal(t.statusCode, 201, JSON.stringify(t.cuerpo));
  const fila = (await c.get('organizaciones', '/tubo/tablero')).cuerpo.columnas.Ingresado[0];
  assert.equal(fila.territorio, 'ANTENA');
  assert.equal(fila.organizacion, 'Club Deportivo El Faro');
  const rol = c.db.sqlite.prepare("SELECT id_rol, permisos FROM roles WHERE nombre = 'Coordinador'").get();
  const permisos = JSON.parse(rol.permisos); permisos.organizaciones.push('eliminar');
  c.db.sqlite.prepare('UPDATE roles SET permisos = ? WHERE id_rol = ?').run(JSON.stringify(permisos), rol.id_rol);
  assert.equal((await c.del('coordinador', `/organizaciones/${org}`)).statusCode, 409);   // en uso por el tubo
  assert.equal((await c.post('organizaciones', '/tubo', { titulo: 'Solicitud con organización inexistente', solicitante: 'Alguien Más', id_organizacion: 9999 })).statusCode, 400);
});

test('importador JJVV: normaliza, informa la calidad de los datos y es idempotente', async () => {
  const c = await nuevo();
  const csv = [
    'ORGANIZACIONES;DOMICILIO LEGAL ;TERRIT. DELEG.;SOCIOS ACTIVOS;FECHA CONSTIT.;Nº REG. P.J.;FECHA INSCRIPC EN REG.;REG. DIR. Nº',
    'AGRUPACION SERENA-MENTE MUJERES;PARCELA 36, SITIO 88;ALFALFARES;15;2026-05-30;4006.0;2026-06-08;',
    'Junta de Vecinos  Los Álamos ;;antena;40;30-06-2010;3000;;9759',
    'JUNTA DE VECINOS LOS ALAMOS;Otra dirección;ANTENA;41;;;;',       // repetida (tildes y mayúsculas)
    'Club de Adulto Mayor Sin Territorio;Calle 5;;12;;;;',
    ';;;;;;;'
  ].join('\n');
  const filas = jjvv.normalizarFilas(jjvv.leerCsv(csv));
  assert.equal(filas.length, 4);
  assert.equal(filas[1].nombre, 'Junta de Vecinos Los Álamos');
  assert.equal(filas[1].territorio, 'ANTENA');
  assert.equal(filas[1].fecha_constitucion, '2010-06-30');
  assert.equal(filas[0].nro_registro_pj, '4006');
  const sim = await jjvv.importarFilas(filas, { aplicar: false, db: c.db });
  assert.equal(c.db.sqlite.prepare('SELECT COUNT(*) n FROM organizaciones').get().n, 0);
  assert.deepEqual([sim.nuevas, sim.duplicadas.length, sim.sinDomicilio, sim.sinTerritorio], [3, 1, 1, 1]);
  await jjvv.importarFilas(filas, { aplicar: true, db: c.db });
  assert.equal(c.db.sqlite.prepare('SELECT COUNT(*) n FROM organizaciones').get().n, 3);
  const otra = await jjvv.importarFilas(filas, { aplicar: true, db: c.db });
  assert.equal(otra.nuevas, 0);
  assert.equal(c.db.sqlite.prepare('SELECT COUNT(*) n FROM organizaciones').get().n, 3);
  assert.throws(() => jjvv.normalizarFilas([['A', 'B'], ['x', 'y']]), /ORGANIZACIONES/);
});
