'use strict';

// Delegaciones autorizadas de cada usuario y alcance de lo que ve cada módulo.
// Esquema real: usuarios.id_delegacion_activa, usuario_delegaciones(id_usuario, id_delegacion),
// delegaciones(id_delegacion, codigo, nombre, estado 'Activa'|'Inactiva').

const db = require('../config/db');

const ERROR_SIN_DELEGACION = {
  status: 403,
  message: 'Tu cuenta no tiene una delegación autorizada para operar en este módulo.'
};

// Inactiva solo si dice explícitamente "inactiva", "inactivo" o 0 (un valor raro no deja a todos fuera).
function sqlActiva(col) {
  return `(${col} IS NULL OR LOWER(${col}) NOT IN ('inactiva', 'inactivo', '0'))`;
}

const fila = f => ({ id: Number(f.id), codigo: String(f.codigo), nombre: String(f.nombre) });

// Delegaciones que puede usar el usuario según el alcance de su rol.
async function autorizadas(usuario, alcance) {
  const base = 'SELECT d.id_delegacion AS id, d.codigo, d.nombre FROM delegaciones d';
  const activa = sqlActiva('d.estado');
  let filas;

  if (alcance === 'global') {
    [filas] = await db.query(`${base} WHERE ${activa} ORDER BY d.codigo`);
  } else if (alcance === 'delegacion') {
    [filas] = await db.query(
      `${base} WHERE ${activa} AND d.id_delegacion = ? ORDER BY d.codigo`, [usuario.id_delegacion_activa]
    );
  } else {
    [filas] = await db.query(
      `${base} WHERE ${activa} AND (d.id_delegacion = ?
         OR d.id_delegacion IN (SELECT ud.id_delegacion FROM usuario_delegaciones ud WHERE ud.id_usuario = ?))
       ORDER BY d.codigo`,
      [usuario.id_delegacion_activa, usuario.id_usuario]
    );
  }
  return filas.map(fila);
}

// Condición SQL que limita lo que cada módulo muestra según la delegación activa.
//   → { where, params }  (where null = sin restricción)  |  { error }
function alcance(modulo, auth) {
  if (modulo === 'atenciones') {
    if (!auth.delegacion) return { error: ERROR_SIN_DELEGACION };
    return { where: 'a.id_delegacion = ?', params: [auth.delegacion.id] };
  }

  if (modulo === 'usuarios') {
    if (auth.alcance === 'global') return { where: null, params: [] };
    if (!auth.delegacion) return { error: ERROR_SIN_DELEGACION };
    return {
      where: '(u.id_delegacion_activa = ? OR u.id_usuario IN (SELECT ud.id_usuario FROM usuario_delegaciones ud WHERE ud.id_delegacion = ?))',
      params: [auth.delegacion.id, auth.delegacion.id]
    };
  }

  if (modulo === 'delegaciones' && auth.alcance === 'delegacion') {
    const ids = auth.delegaciones.map(d => d.id);
    if (!ids.length) return { where: '1 = 0', params: [] };
    return { where: `d.id_delegacion IN (${ids.map(() => '?').join(', ')})`, params: ids };
  }

  return { where: null, params: [] };
}

module.exports = { autorizadas, alcance, sqlActiva, ERROR_SIN_DELEGACION };
