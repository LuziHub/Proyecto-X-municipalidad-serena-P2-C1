#!/usr/bin/env node
'use strict';

// Migración aditiva e idempotente para delegaciones y responsable de atención.
//   - Agrega atenciones_ciudadanas.delegacion_id y usuario_id (si faltan).
//   - Crea usuario_delegaciones (si no existe) para asignar delegaciones a cada usuario.
// No borra ni modifica datos existentes.
//
// Uso:
//   node scripts/migrar-delegaciones.js                       → solo muestra lo que haría (simulación)
//   node scripts/migrar-delegaciones.js --aplicar             → ejecuta los cambios
//   node scripts/migrar-delegaciones.js --aplicar --delegacion-por-defecto=COD
//        → además asigna esa delegación a las atenciones que ya existían sin delegación
//
// Haz un respaldo antes de aplicar:  mysqldump -u USUARIO -p sgr_laserena_db > respaldo.sql

const path = require('path');

// Decide qué sentencias hacen falta según el esquema detectado. Pura: se prueba sin base de datos.
function planificar(esq, opciones = {}) {
  const pasos = [];
  if (!esq.tablas.includes('atenciones_ciudadanas')) {
    return { pasos, aviso: 'No existe la tabla atenciones_ciudadanas; no hay nada que migrar.' };
  }
  if (!esq.atenciones.delegacion) {
    pasos.push({ descripcion: 'Agregar atenciones_ciudadanas.delegacion_id',
      sql: 'ALTER TABLE `atenciones_ciudadanas` ADD COLUMN `delegacion_id` INT NULL, ADD INDEX `idx_atenciones_delegacion` (`delegacion_id`)' });
  }
  if (!esq.atenciones.usuario) {
    pasos.push({ descripcion: 'Agregar atenciones_ciudadanas.usuario_id (funcionario responsable)',
      sql: 'ALTER TABLE `atenciones_ciudadanas` ADD COLUMN `usuario_id` INT NULL, ADD INDEX `idx_atenciones_usuario` (`usuario_id`)' });
  }
  if (!esq.tablas.includes('usuario_delegaciones')) {
    pasos.push({ descripcion: 'Crear tabla usuario_delegaciones',
      sql: 'CREATE TABLE `usuario_delegaciones` (`usuario_id` INT NOT NULL, `delegacion_id` INT NOT NULL, PRIMARY KEY (`usuario_id`, `delegacion_id`))' });
  }
  if (opciones.delegacionPorDefecto) {
    pasos.push({ descripcion: `Asignar la delegación ${opciones.delegacionPorDefecto} a las atenciones existentes sin delegación`,
      sql: 'UPDATE `atenciones_ciudadanas` SET `delegacion_id` = (SELECT `id` FROM `delegaciones` WHERE LOWER(`codigo`) = LOWER(?) LIMIT 1) WHERE `delegacion_id` IS NULL',
      params: [opciones.delegacionPorDefecto],
      despuesDeColumnas: true });
  }
  return { pasos };
}

function leerArgumentos(argv) {
  const op = { aplicar: false, delegacionPorDefecto: null };
  for (const a of argv) {
    if (a === '--aplicar') op.aplicar = true;
    else if (a.startsWith('--delegacion-por-defecto=')) op.delegacionPorDefecto = a.split('=')[1].trim() || null;
  }
  return op;
}

async function principal() {
  require('dotenv').config({ path: path.join(__dirname, '../.env') });
  const db = require('../src/config/db');
  const { leerEsquema } = require('../src/utils/delegaciones');
  const op = leerArgumentos(process.argv.slice(2));

  const esq = await leerEsquema(db);
  const { pasos, aviso } = planificar(esq, op);
  if (aviso) { console.log(aviso); return; }

  if (op.delegacionPorDefecto) {
    const [f] = await db.query('SELECT id FROM delegaciones WHERE LOWER(codigo) = LOWER(?) LIMIT 1', [op.delegacionPorDefecto]);
    if (!f.length) throw new Error(`La delegación "${op.delegacionPorDefecto}" no existe en la tabla delegaciones.`);
  }

  if (!pasos.length) { console.log('✅ El esquema ya está al día. No hay nada que hacer.'); return; }

  console.log(op.aplicar ? 'Aplicando cambios:' : 'SIMULACIÓN (no se cambia nada). Cambios pendientes:');
  for (const p of pasos) console.log(`\n- ${p.descripcion}\n  ${p.sql}`);

  if (!op.aplicar) {
    console.log('\nPara ejecutarlos: node scripts/migrar-delegaciones.js --aplicar');
    return;
  }
  for (const p of pasos) {
    await db.query(p.sql, p.params || []);
    console.log(`✔ ${p.descripcion}`);
  }
  console.log('\n✅ Migración terminada. Asigna delegaciones a los usuarios en usuario_delegaciones (o en usuarios.delegacion).');
}

if (require.main === module) {
  principal().then(() => process.exit(0)).catch(err => { console.error('❌ Error en la migración:', err.message); process.exit(1); });
}

module.exports = { planificar, leerArgumentos };
