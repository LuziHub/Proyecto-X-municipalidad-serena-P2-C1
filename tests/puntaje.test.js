'use strict';
// Cálculo puro del puntaje y reglas de fecha, con ejemplos tomados de la planilla.
const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularPuntaje, diasDeAusencia, objetivoDelDia, semaforo } = require('../src/utils/puntaje');
const { evaluarPuntaje, ventanaIngreso, validarFechaIngreso, validarTopeDiario } = require('../src/utils/reglas');

const periodo = { nombre: 'T4', fecha_inicio: '2026-10-01', fecha_fin: '2026-12-31', tope_item: 1.2, tope_total: 1.5 };
const metasApa = [
  { id_item: 1, codigo: 'ATN-USU', item: 'a', ponderador: 0.2, meta: 240, calculo: 'conteo' },
  { id_item: 2, codigo: 'LLAM-PREV', item: 'b', ponderador: 0.3, meta: 90, calculo: 'conteo' },
  { id_item: 3, codigo: 'INF-INV', item: 'c', ponderador: 0.25, meta: 1, calculo: 'conteo' },
  { id_item: 4, codigo: 'INF-COM', item: 'd', ponderador: 0.2, meta: 12, calculo: 'conteo' },
  { id_item: 5, codigo: 'EMERG', item: 'e', ponderador: 0.05, meta: 0, calculo: 'emergencia' },
  { id_item: 6, codigo: 'FELICIT', item: 'f', ponderador: 0.1, meta: 3, calculo: 'felicitacion' },
  { id_item: 7, codigo: 'RECLAMO', item: 'g', ponderador: -0.3, meta: 0, calculo: 'reclamo' }
];

test('cumplimiento exacto de todas las metas da 100 %', () => {
  const r = calcularPuntaje({ metas: metasApa, avances: { 1: 240, 2: 90, 3: 1, 4: 12, 5: 1 }, periodo });
  assert.equal(r.total, 1);
  assert.equal(r.advertencias.length, 0);
});

test('regla 7: cada ítem se topa en 120 %', () => {
  const r = calcularPuntaje({ metas: metasApa, avances: { 1: 1000 }, periodo });
  const it = r.items.find(i => i.codigo === 'ATN-USU');
  assert.equal(it.pctTopado, 1.2);
  assert.equal(it.ponderado, 0.24);
});

test('felicitaciones suman 10 % hasta 3 y reclamos restan', () => {
  const base = { metas: metasApa, avances: { 1: 240, 2: 90, 3: 1, 4: 12, 5: 1 }, periodo };
  assert.equal(calcularPuntaje({ ...base, felicitaciones: 2 }).total, 1.2);
  assert.equal(calcularPuntaje({ ...base, felicitaciones: 9 }).felicitaciones.contadas, 3);
  assert.equal(calcularPuntaje({ ...base, reclamos: 1 }).total, 0.7);
});

test('tope total del colaborador (antes de restar reclamos)', () => {
  // con ítems al 120 % y 3 felicitaciones el máximo teórico es 149 % (la emergencia no pasa de 100 %): nunca llega al tope de 150 %
  const maximo = calcularPuntaje({ metas: metasApa, avances: { 1: 1e6, 2: 1e6, 3: 9, 4: 99, 5: 1 }, felicitaciones: 3, periodo });
  assert.equal(maximo.total, 1.49);
  assert.equal(maximo.topadoTotal, false);
  // si la Coordinación baja el tope del período, sí se aplica
  const r = calcularPuntaje({ metas: metasApa, avances: { 1: 1e6, 2: 1e6, 3: 9, 4: 99, 5: 1 }, felicitaciones: 3, periodo: { ...periodo, tope_total: 1.3 } });
  assert.equal(r.topadoTotal, true);
  assert.equal(r.total, 1.3);
});

test('tubo: porcentaje realizado sobre la meta del 80 %', () => {
  const m = [{ id_item: 9, codigo: 'TUBO-SOL', item: 't', ponderador: 0.25, meta: 0.8, calculo: 'tubo' }];
  assert.equal(calcularPuntaje({ metas: m, tubo: { total: 10, realizadas: 8 }, periodo }).total, 0.25);
  assert.equal(calcularPuntaje({ metas: m, tubo: { total: 10, realizadas: 4 }, periodo }).total, 0.125);
  assert.equal(calcularPuntaje({ metas: m, tubo: { total: 0, realizadas: 0 }, periodo }).total, 0);
});

test('advierte cuando los ponderadores no suman 100 % (caso Gestión y Planificación: 85 %)', () => {
  const m = [{ id_item: 1, codigo: 'X', item: 'x', ponderador: 0.85, meta: 1, calculo: 'conteo' }];
  assert.match(calcularPuntaje({ metas: m, periodo }).advertencias[0], /85/);
});

test('objetivo y semáforo: las ausencias bajan el objetivo', () => {
  const sin = objetivoDelDia({ periodo, hoy: '2026-11-15', diasAusencia: 0 });
  const con = objetivoDelDia({ periodo, hoy: '2026-11-15', diasAusencia: 10 });
  assert.ok(con.objetivo < sin.objetivo);
  assert.equal(objetivoDelDia({ periodo, hoy: '2027-03-01' }).objetivo, 1);      // pasado el período: tope 1
  assert.equal(objetivoDelDia({ periodo, hoy: '2026-09-01' }).objetivo, 0);      // antes del inicio
  assert.equal(semaforo(0.6, 0.6), 'Verde');
  assert.equal(semaforo(0.4, 0.6), 'Naranjo');
  assert.equal(semaforo(0.2, 0.6), 'Rojo');
  assert.equal(diasDeAusencia([{ fecha_desde: '2026-09-25', fecha_hasta: '2026-10-03' }, { fecha_desde: '2026-12-20', fecha_hasta: '2026-12-31' }], periodo, '2026-11-15'), 3);
});

test('reglas 1, 2 y 5 en evaluarPuntaje', () => {
  const ok = { contactoNombre: 'Ana Pérez', contactoTelefono: '+56912345678', requiereContacto: true, nombresDelegados: ['Diego Delegado'] };
  assert.equal(evaluarPuntaje(ok).puntua, true);
  assert.equal(evaluarPuntaje({ ...ok, usuarioEsDelegado: true }).puntua, false);
  assert.equal(evaluarPuntaje({ ...ok, contactoNombre: ' diego  DELEGADO ' }).puntua, false);   // sin importar mayúsculas ni espacios
  assert.equal(evaluarPuntaje({ ...ok, esCoordinacion: true }).puntua, false);
  assert.equal(evaluarPuntaje({ ...ok, contactoTelefono: '123' }).puntua, false);
  assert.equal(evaluarPuntaje({ ...ok, requiereContacto: false, contactoNombre: '', contactoTelefono: '' }).puntua, true);
});

test('regla 4: la semana anterior se puede ingresar hasta el martes inclusive', () => {
  // 2026-11-17 es martes; 2026-11-18, miércoles
  assert.equal(ventanaIngreso('2026-11-17', 2).desde, '2026-11-09');
  assert.equal(ventanaIngreso('2026-11-18', 2).desde, '2026-11-16');
  assert.equal(validarFechaIngreso({ fecha: '2026-11-13', hoy: '2026-11-17', cierreDia: 2 }).ok, true);
  assert.equal(validarFechaIngreso({ fecha: '2026-11-13', hoy: '2026-11-18', cierreDia: 2 }).ok, false);
  assert.equal(validarFechaIngreso({ fecha: '2026-11-19', hoy: '2026-11-18', cierreDia: 2 }).ok, false);   // futura
  assert.equal(validarFechaIngreso({ fecha: '2026-09-30', hoy: '2026-10-01', cierreDia: 2, periodo }).ok, false);   // fuera de período
});

test('regla 3: tope diario', () => {
  assert.equal(validarTopeDiario({ yaIngresadas: 6, maximo: 7 }).ok, true);
  assert.equal(validarTopeDiario({ yaIngresadas: 7, maximo: 7 }).ok, false);
});
