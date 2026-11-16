'use strict';

// Consultas de la matriz: período vigente, metas por cargo y puntaje de cada funcionario.

const db = require('../config/db');
const { aFechaTexto, diasEntre } = require('../utils/fechas');
const { calcularPuntaje, diasDeAusencia, objetivoDelDia, semaforo } = require('../utils/puntaje');

const normalizarPeriodo = f => (f ? {
  id: Number(f.id_periodo), nombre: f.nombre,
  fecha_inicio: aFechaTexto(f.fecha_inicio), fecha_fin: aFechaTexto(f.fecha_fin),
  tope_item: Number(f.tope_item), tope_total: Number(f.tope_total), minimo_cumplimiento: Number(f.minimo_cumplimiento),
  max_gestiones_dia: Number(f.max_gestiones_dia), cierre_dia_semana: Number(f.cierre_dia_semana),
  exigir_verificacion: Number(f.exigir_verificacion || 0) === 1, estado: f.estado
} : null);

// Período activo que contiene la fecha (YYYY-MM-DD). null si no hay.
async function periodoDe(fecha) {
  const [f] = await db.query(
    "SELECT * FROM periodos WHERE LOWER(estado) = 'activo' AND fecha_inicio <= ? AND fecha_fin >= ? ORDER BY fecha_inicio DESC LIMIT 1", [fecha, fecha]
  );
  return normalizarPeriodo(f[0]);
}

async function metasDe(idPeriodo, idRol) {
  const [f] = await db.query(
    `SELECT m.id_item, i.codigo, i.nombre AS item, m.ponderador, m.meta, m.calculo, m.requiere_contacto
       FROM metas_cargo m JOIN items_metas i ON i.id_item = m.id_item
      WHERE m.id_periodo = ? AND m.id_rol = ? ORDER BY m.id_meta`, [idPeriodo, idRol]
  );
  return f.map(m => ({ ...m, id_item: Number(m.id_item), ponderador: Number(m.ponderador), meta: Number(m.meta), requiere_contacto: Number(m.requiere_contacto) }));
}

// Puntaje, objetivo del día y semáforo de un funcionario en un período.
async function calcularDe(usuario, periodo, hoy) {
  const metas = await metasDe(periodo.id, usuario.id_rol);
  const base = { usuario: { id: Number(usuario.id), nombre: usuario.nombre, rol: usuario.rol }, tieneMetas: metas.some(m => !['felicitacion', 'reclamo'].includes(m.calculo)) };
  if (!base.tieneMetas) return { ...base, periodo, items: [], total: 0, gestion: 0, felicitaciones: { cantidad: 0, contadas: 0, puntos: 0 }, reclamos: { cantidad: 0, puntos: 0 }, advertencias: [], objetivo: null, semaforo: null, cumpleMinimo: null, gestiones: { total: 0, ultima: null, diasSinIngreso: null } };

  const rango = [periodo.fecha_inicio, periodo.fecha_fin];
  const [av] = await db.query(
    `SELECT id_item, SUM(unidades) AS n FROM gestiones WHERE id_responsable = ? AND puntua = 1 AND fecha_gestion >= ? AND fecha_gestion <= ?${periodo.exigir_verificacion ? ' AND imagen_verificada = 1' : ''} GROUP BY id_item`, [usuario.id, ...rango]
  );
  const avances = Object.fromEntries(av.map(a => [Number(a.id_item), Number(a.n)]));

  const [tb] = await db.query('SELECT estado, COUNT(*) AS n FROM tubo WHERE id_responsable = ? AND fecha_solicitud >= ? AND fecha_solicitud <= ? GROUP BY estado', [usuario.id, ...rango]);
  const tubo = { total: tb.reduce((s, r) => s + Number(r.n), 0), realizadas: Number((tb.find(r => r.estado === 'Realizado') || {}).n || 0) };

  const [va] = await db.query('SELECT tipo, COUNT(*) AS n FROM valoraciones WHERE id_funcionario = ? AND id_periodo = ? GROUP BY tipo', [usuario.id, periodo.id]);
  const cuenta = t => Number((va.find(r => r.tipo === t) || {}).n || 0);

  const [au] = await db.query('SELECT fecha_desde, fecha_hasta FROM ausencias WHERE id_usuario = ? AND fecha_hasta >= ? AND fecha_desde <= ?', [usuario.id, ...rango]);
  const ausencias = au.map(a => ({ fecha_desde: aFechaTexto(a.fecha_desde), fecha_hasta: aFechaTexto(a.fecha_hasta) }));

  const [ult] = await db.query('SELECT MAX(fecha_gestion) AS ultima, COUNT(*) AS n FROM gestiones WHERE id_responsable = ? AND fecha_gestion >= ? AND fecha_gestion <= ?', [usuario.id, ...rango]);
  const ultima = aFechaTexto(ult[0].ultima);

  const puntaje = calcularPuntaje({ metas, avances, tubo, felicitaciones: cuenta('Felicitación'), reclamos: cuenta('Reclamo'), periodo });
  const objetivo = objetivoDelDia({ periodo, hoy, diasAusencia: diasDeAusencia(ausencias, periodo, hoy) });
  return {
    ...base, periodo, ...puntaje, objetivo, tubo,
    semaforo: semaforo(puntaje.total, objetivo.objetivo),
    cumpleMinimo: puntaje.total >= periodo.minimo_cumplimiento,
    gestiones: { total: Number(ult[0].n), ultima, diasSinIngreso: ultima ? diasEntre(ultima, hoy) : null }
  };
}

// Personas de la delegación (principal o autorizada) con su rol.
async function personalDe(idDelegacion) {
  const [f] = await db.query(
    `SELECT u.id_usuario AS id, u.nombre, u.id_rol, r.nombre AS rol
       FROM usuarios u JOIN roles r ON r.id_rol = u.id_rol
      WHERE LOWER(u.estado) = 'activo'
        AND (u.id_delegacion_activa = ? OR u.id_usuario IN (SELECT ud.id_usuario FROM usuario_delegaciones ud WHERE ud.id_delegacion = ?))
      ORDER BY u.nombre`, [idDelegacion, idDelegacion]
  );
  return f.map(p => ({ ...p, id: Number(p.id), id_rol: Number(p.id_rol) }));
}

// Puntaje de todo el equipo con metas (los demás cargos —delegado, coordinador— no se miden).
async function equipoDe(idDelegacion, periodo, hoy) {
  const filas = [];
  for (const p of await personalDe(idDelegacion)) {
    const r = await calcularDe(p, periodo, hoy);
    if (r.tieneMetas) filas.push(r);
  }
  filas.sort((a, b) => b.total - a.total);
  const promedio = filas.length ? filas.reduce((s, r) => s + r.total, 0) / filas.length : 0;
  const objetivo = filas.length ? filas[0].objetivo.objetivo : objetivoDelDia({ periodo, hoy }).objetivo;
  return { filas, promedio: Math.round(promedio * 10000) / 10000, objetivo, semaforoPromedio: semaforo(promedio, objetivo) };
}

module.exports = { periodoDe, metasDe, calcularDe, personalDe, equipoDe, normalizarPeriodo };
