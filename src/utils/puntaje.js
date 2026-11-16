'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Cálculo del puntaje de la matriz (réplica de las hojas por cargo de la planilla).
//
// Para cada ítem de las metas del cargo:
//   conteo      avance = unidades de gestiones que puntúan   → % = avance / meta
//   emergencia  100 % si hubo al menos una gestión de emergencia (la meta es "la que ocurra")
//   tubo        avance = realizadas / ingresadas en el tubo  → % = avance / meta (p. ej. 80 %)
//   felicitacion  suma ponderador por cada una, hasta "meta" (máx. 3)
//   reclamo       resta ponderador por cada una
// El % de cada ítem se topa (regla 7: 120 %); el total se topa por colaborador (150 %).
// ─────────────────────────────────────────────────────────────────────────────

const { diasEntre, sumarDias } = require('./fechas');

const redondear = (n, d = 4) => Math.round((Number(n) + Number.EPSILON) * 10 ** d) / 10 ** d;
const CALCULOS_REGISTRABLES = ['conteo', 'emergencia'];

function calcularPuntaje({ metas, avances = {}, tubo = { total: 0, realizadas: 0 }, felicitaciones = 0, reclamos = 0, periodo }) {
  const topeItem = Number(periodo.tope_item);
  const topeTotal = Number(periodo.tope_total);
  const items = [];
  let gestion = 0, felicitacionesPuntos = 0, reclamosPuntos = 0, sumaPonderadores = 0;
  let felicitacionesContadas = 0;

  for (const m of metas) {
    const ponderador = Number(m.ponderador);
    const meta = Number(m.meta);

    if (m.calculo === 'felicitacion') {
      felicitacionesContadas = Math.min(felicitaciones, meta > 0 ? meta : felicitaciones);
      felicitacionesPuntos = felicitacionesContadas * ponderador;
      continue;
    }
    if (m.calculo === 'reclamo') { reclamosPuntos = reclamos * ponderador; continue; }

    let avance, pct;
    if (m.calculo === 'tubo') {
      avance = tubo.total > 0 ? tubo.realizadas / tubo.total : 0;
      pct = meta > 0 ? avance / meta : 0;
    } else if (m.calculo === 'emergencia') {
      avance = Number(avances[m.id_item] || 0);
      pct = avance > 0 ? 1 : 0;
    } else {
      avance = Number(avances[m.id_item] || 0);
      pct = meta > 0 ? avance / meta : 0;
    }
    const pctTopado = Math.min(pct, topeItem);
    const ponderado = pctTopado * ponderador;
    sumaPonderadores += ponderador;
    gestion += ponderado;
    items.push({
      id_item: m.id_item, codigo: m.codigo, item: m.item, calculo: m.calculo,
      ponderador, meta, avance: redondear(avance), pct: redondear(pct), pctTopado: redondear(pctTopado),
      topado: pct > topeItem, ponderado: redondear(ponderado)
    });
  }

  const subtotal = gestion + felicitacionesPuntos;
  const subtotalTopado = Math.min(subtotal, topeTotal);
  const total = subtotalTopado + reclamosPuntos;
  const advertencias = [];
  if (items.length && Math.abs(sumaPonderadores - 1) > 0.0001) {
    advertencias.push(`Los ponderadores de las metas suman ${redondear(sumaPonderadores * 100, 1)} % y deberían sumar 100 %.`);
  }
  return {
    items, gestion: redondear(gestion),
    felicitaciones: { cantidad: felicitaciones, contadas: felicitacionesContadas, puntos: redondear(felicitacionesPuntos) },
    reclamos: { cantidad: reclamos, puntos: redondear(reclamosPuntos) },
    subtotal: redondear(subtotal), topadoTotal: subtotal > topeTotal, total: redondear(total),
    sumaPonderadores: redondear(sumaPonderadores), advertencias
  };
}

// Días de ausencia (licencias, vacaciones, emergencias, compensatorios) que caen entre el inicio
// del período y "hoy". Cada ausencia: { fecha_desde, fecha_hasta } (YYYY-MM-DD).
function diasDeAusencia(ausencias, periodo, hoy) {
  const fin = hoy < periodo.fecha_fin ? hoy : periodo.fecha_fin;
  let dias = 0;
  for (const a of ausencias) {
    const desde = a.fecha_desde > periodo.fecha_inicio ? a.fecha_desde : periodo.fecha_inicio;
    const hasta = a.fecha_hasta < fin ? a.fecha_hasta : fin;
    if (hasta >= desde) dias += diasEntre(desde, hasta) + 1;
  }
  return dias;
}

// Objetivo del día: fracción del período transcurrida, descontando ausencias (como la hoja SEMÁFORO:
// días transcurridos − ausencias, sobre los días del período). Nunca supera 1.
function objetivoDelDia({ periodo, hoy, diasAusencia = 0 }) {
  const diasPeriodo = diasEntre(periodo.fecha_inicio, periodo.fecha_fin) + 1;
  const fin = hoy < periodo.fecha_fin ? hoy : periodo.fecha_fin;
  const transcurridos = hoy < periodo.fecha_inicio ? 0 : diasEntre(periodo.fecha_inicio, fin) + 1;
  const netos = Math.max(0, transcurridos - diasAusencia);
  return { objetivo: redondear(Math.min(1, netos / diasPeriodo)), diasPeriodo, transcurridos, diasAusencia, diasNetos: netos };
}

// Semáforo: verde si alcanza el objetivo del día, naranjo si llega al 60 % de él, rojo si no.
function semaforo(total, objetivo) {
  if (objetivo <= 0 || total >= objetivo) return 'Verde';
  return total >= objetivo * 0.6 ? 'Naranjo' : 'Rojo';
}

module.exports = { calcularPuntaje, diasDeAusencia, objetivoDelDia, semaforo, CALCULOS_REGISTRABLES, redondear, sumarDias };
