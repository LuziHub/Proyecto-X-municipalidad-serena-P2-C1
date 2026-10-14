#!/usr/bin/env node
'use strict';
/*
 * Prueba de estrés progresiva para la API del SGR (sin dependencias; Node 18 o superior).
 * Ejecutar desde una máquina DISTINTA del servidor, apuntando a la URL de AWS.
 *
 *   node scripts/prueba-estres.js --url=http://IP:3000 --correo=funcionario@demo.sgr.cl --clave='...' \
 *        [--niveles=5,10,20,40,80] [--duracion=20] [--escenarios=listar,buscar,exportar] \
 *        [--p95=800] [--errores=1] [--escritura]
 *   (la clave también puede ir en la variable de entorno SGR_CLAVE)
 *
 * Qué hace:
 *   - Inicia sesión UNA vez (el login tiene límite de intentos por diseño) y reutiliza el token.
 *   - Por cada escenario sube la concurrencia nivel a nivel y mide solicitudes/s, latencia promedio,
 *     p95, p99 y porcentaje de errores. Compara con los umbrales y declara degradación cuando dos
 *     niveles seguidos no cumplen.
 *   - Al terminar cada escenario mide la recuperación (10 solicitudes secuenciales).
 *   - Guarda resultados-estres-<fecha>.csv para copiar a la planilla de pruebas.
 *   --escritura incluye el escenario "crear" (POST /api/atenciones): CREA DATOS DE PRUEBA en la base.
 * CPU y memoria del servidor no se miden aquí: regístralas con pm2 monit / top / CloudWatch.
 */
const fs = require('node:fs');

function leerArgumentos(argv) {
  const a = {};
  for (const x of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(x);
    if (m) a[m[1]] = m[2] === undefined ? true : m[2];
  }
  return a;
}

function percentil(ordenados, p) {
  if (!ordenados.length) return 0;
  const i = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);
  return ordenados[Math.max(0, i)];
}

// Resume una lista de mediciones { ms, ok } de un nivel.
function resumir(mediciones, duracionSeg) {
  const lat = mediciones.map(m => m.ms).sort((x, y) => x - y);
  const errores = mediciones.filter(m => !m.ok).length;
  const n = mediciones.length;
  return {
    solicitudes: n,
    rps: n / duracionSeg,
    promedio: n ? lat.reduce((s, v) => s + v, 0) / n : 0,
    p95: percentil(lat, 95),
    p99: percentil(lat, 99),
    erroresPct: n ? (errores / n) * 100 : 100
  };
}

const cumple = (r, umbrales) => r.solicitudes > 0 && r.p95 <= umbrales.p95 && r.erroresPct <= umbrales.errores;

async function medirNivel(hacer, concurrencia, duracionSeg) {
  const mediciones = [];
  const fin = Date.now() + duracionSeg * 1000;
  const inicio = Date.now();
  async function trabajador() {
    while (Date.now() < fin) {
      const t0 = performance.now();
      let ok = false;
      try { ok = await hacer(); } catch (_) { ok = false; }
      mediciones.push({ ms: performance.now() - t0, ok });
    }
  }
  await Promise.all(Array.from({ length: concurrencia }, trabajador));
  return resumir(mediciones, Math.max(1, (Date.now() - inicio) / 1000));
}

async function ejecutar(opts, log = console.log) {
  const { url, token, delegacion, niveles, duracion, escenarios, umbrales } = opts;
  const cab = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (delegacion) cab['X-Delegacion'] = String(delegacion);
  const get = ruta => async () => (await fetch(url + ruta, { headers: cab }).then(async r => { await r.arrayBuffer(); return r; })).ok;
  const catalogo = {
    listar: get('/api/atenciones?page=1&limit=10'),
    buscar: get('/api/atenciones?search=a&limit=10'),
    exportar: get('/api/atenciones/export'),
    crear: async () => {
      const tipos = opts.tipos;
      const r = await fetch(url + '/api/atenciones', { method: 'POST', headers: cab, body: JSON.stringify({
        solicitante: 'Prueba Estres', id_tipo: tipos.tipo, id_sub_atencion: tipos.sub, descripcion: 'Registro de prueba de estres' }) });
      await r.arrayBuffer(); return r.status === 201;
    }
  };
  const salida = [];
  for (const nombre of escenarios) {
    const hacer = catalogo[nombre];
    if (!hacer) { log(`Escenario desconocido: ${nombre}`); continue; }
    log(`\n▶ Escenario "${nombre}"`);
    log('conc  solicitudes   req/s   prom(ms)   p95(ms)   p99(ms)   errores%   umbral');
    let seguidosFallidos = 0, limite = null;
    for (const conc of niveles) {
      const r = await medirNivel(hacer, conc, duracion);
      const ok = cumple(r, umbrales);
      salida.push({ fecha: new Date().toISOString(), escenario: nombre, concurrencia: conc, duracion, ...r, cumple: ok });
      log(`${String(conc).padStart(4)}  ${String(r.solicitudes).padStart(10)}  ${r.rps.toFixed(1).padStart(6)}  ${r.promedio.toFixed(1).padStart(9)}  ${r.p95.toFixed(1).padStart(8)}  ${r.p99.toFixed(1).padStart(8)}  ${r.erroresPct.toFixed(2).padStart(8)}   ${ok ? 'CUMPLE' : 'NO CUMPLE'}`);
      seguidosFallidos = ok ? 0 : seguidosFallidos + 1;
      if (ok) limite = conc;
      if (seguidosFallidos >= 2) { log('  ↳ Degradación observada: dos niveles seguidos fuera de umbral. Se detiene el escenario.'); break; }
    }
    const rec = await medirNivel(hacer, 1, 3);
    log(`  Recuperación (1 usuario): p95 ${rec.p95.toFixed(1)} ms, errores ${rec.erroresPct.toFixed(2)} % → ${cumple(rec, umbrales) ? 'normal' : 'AÚN DEGRADADO'}`);
    log(`  Mayor concurrencia que cumple los umbrales: ${limite === null ? 'ninguna' : limite}`);
    salida.push({ fecha: new Date().toISOString(), escenario: nombre + ' (recuperación)', concurrencia: 1, duracion: 3, ...rec, cumple: cumple(rec, umbrales) });
  }
  return salida;
}

function aCsv(filas) {
  const enc = ['fecha', 'escenario', 'concurrencia', 'duracion_s', 'solicitudes', 'req_por_s', 'promedio_ms', 'p95_ms', 'p99_ms', 'errores_pct', 'cumple_umbral'];
  const f = x => (typeof x === 'number' ? x.toFixed(2) : x);
  return [enc.join(',')].concat(filas.map(r => [r.fecha, r.escenario, r.concurrencia, r.duracion, r.solicitudes, f(r.rps), f(r.promedio), f(r.p95), f(r.p99), f(r.erroresPct), r.cumple ? 'SI' : 'NO'].join(','))).join('\n') + '\n';
}

async function principal() {
  const a = leerArgumentos(process.argv.slice(2));
  const url = String(a.url || '').replace(/\/$/, '');
  const clave = a.clave || process.env.SGR_CLAVE;
  if (!url || !a.correo || !clave) {
    console.error('Uso: node scripts/prueba-estres.js --url=http://IP:3000 --correo=usuario --clave=... [--niveles=5,10,20] [--duracion=20] [--escenarios=listar,buscar,exportar] [--escritura]');
    process.exit(2);
  }
  const login = await fetch(url + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: a.correo, password: clave }) });
  const datos = await login.json().catch(() => ({}));
  if (!login.ok) { console.error('No se pudo iniciar sesión:', datos.message || login.status); process.exit(1); }
  const cabAuth = { Authorization: `Bearer ${datos.token}` };

  const escenarios = String(a.escenarios || 'listar,buscar,exportar').split(',').map(s => s.trim()).filter(Boolean);
  const opts = {
    url, token: datos.token, delegacion: datos.user.delegacionActiva && datos.user.delegacionActiva.id,
    niveles: String(a.niveles || '5,10,20,40,80').split(',').map(Number).filter(n => n > 0),
    duracion: Number(a.duracion) || 20, escenarios,
    umbrales: { p95: Number(a.p95) || 800, errores: a.errores === undefined ? 1 : Number(a.errores) }
  };
  if (a.escritura) {
    const t = await (await fetch(url + '/api/lookup/tipos', { headers: cabAuth })).json();
    const tipo = t.data && t.data[0];
    const s = tipo && await (await fetch(url + `/api/lookup/subatenciones?tipo=${tipo.id}`, { headers: cabAuth })).json();
    if (!tipo || !s.data || !s.data.length) { console.error('No hay tipo y sub atención activos para crear atenciones de prueba.'); process.exit(1); }
    opts.tipos = { tipo: tipo.id, sub: s.data[0].id };
    if (!escenarios.includes('crear')) escenarios.push('crear');
    console.log('⚠ --escritura: se crearán atenciones de prueba (solicitante "Prueba Estres").');
  }
  console.log(`URL: ${url} · usuario: ${a.correo} · umbrales: p95 ≤ ${opts.umbrales.p95} ms, errores ≤ ${opts.umbrales.errores} %`);
  const filas = await ejecutar(opts);
  const archivo = `resultados-estres-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  fs.writeFileSync(archivo, aCsv(filas));
  console.log(`\nResultados guardados en ${archivo} (cópialos a la hoja "Pruebas de estrés").`);
}

module.exports = { leerArgumentos, percentil, resumir, cumple, ejecutar, aCsv };
if (require.main === module) principal().catch(e => { console.error(e); process.exit(1); });
