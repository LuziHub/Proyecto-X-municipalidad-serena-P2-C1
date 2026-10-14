'use strict';
/*
 * Prepara la base EXISTENTE (sgr_laserena_db) para la demostración de roles y permisos.
 * No crea ni borra tablas. Es idempotente: se puede ejecutar varias veces.
 *
 *   node scripts/preparar-demo.js                      → solo muestra qué haría (no cambia nada)
 *   node scripts/preparar-demo.js --aplicar            → aplica los cambios
 *   node scripts/preparar-demo.js --aplicar --clave-demo='Demo2026x'
 *        → además crea los usuarios de demostración (uno por rol) y cifra las contraseñas sin cifrar
 *   --forzar-permisos → vuelve a escribir roles.permisos aunque ya tengan contenido
 *
 * Qué hace:
 *   1. Crea los roles que falten (Superadministrador, Coordinador, Delegado municipal, Funcionario, ...)
 *      y escribe roles.permisos (JSON) donde esté vacío (matriz en src/config/permisos.js).
 *   2. Asigna a Administrador y Coordinador todas las delegaciones activas (usuario_delegaciones).
 *   3. Con --clave-demo: crea un usuario de demostración por rol (si no existe) y reemplaza las
 *      contraseñas guardadas SIN cifrar. La clave no se guarda en ningún archivo: entrégala por separado.
 */
const path = require('path');
const { ROLES_DEMO, normalizarPermisos, validarPermisos } = require('../src/config/permisos');

// Usuarios de demostración: uno por rol. delegaciones: 'todas' | número de delegaciones activas (desde la primera).
const USUARIOS_DEMO = [
  { nombre: 'Sofia Superadmin', correo: 'superadmin@demo.sgr.cl', rol: 'Superadministrador', delegaciones: 1 },
  { nombre: 'Camila Coordinadora', correo: 'coordinador@demo.sgr.cl', rol: 'Coordinador', delegaciones: 'todas' },
  { nombre: 'Diego Delegado', correo: 'delegado@demo.sgr.cl', rol: 'Delegado municipal', delegaciones: 1 },
  { nombre: 'Fabiola Funcionaria', correo: 'funcionario@demo.sgr.cl', rol: 'Funcionario', delegaciones: 1 },
  { nombre: 'Carlos Consultor', correo: 'consultor@demo.sgr.cl', rol: 'Consultor', delegaciones: 2 }
];
const ROLES_CON_TODAS_LAS_DELEGACIONES = ['Administrador', 'Coordinador'];

function leerArgumentos(args) {
  return {
    aplicar: args.includes('--aplicar'),
    forzar: args.includes('--forzar-permisos'),
    claveDemo: (args.find(a => a.startsWith('--clave-demo=')) || '').slice('--clave-demo='.length)
  };
}

async function main({ aplicar, forzar, claveDemo }, log = console.log) {
  // Se cargan aquí (no al inicio) para que las pruebas puedan sustituir la conexión a MySQL.
  const db = require('../src/config/db');
  const clave = require('../src/utils/clave');
  log(aplicar ? '▶ MODO APLICAR: se modificará la base.' : '▶ Modo simulación: no se modifica nada (agrega --aplicar para ejecutar).');

  // 1. Roles y permisos
  const [existentes] = await db.query('SELECT id_rol, codigo, nombre, permisos FROM roles ORDER BY id_rol');
  for (const rol of ROLES_DEMO) {
    if (validarPermisos(rol.permisos).length) throw new Error(`Matriz base inválida para ${rol.nombre}`);
    const fila = existentes.find(r => r.nombre === rol.nombre);
    if (!fila) {
      if (existentes.some(r => r.codigo === rol.codigo)) { log(`  ⚠ Rol "${rol.nombre}": el código ${rol.codigo} ya lo usa otro rol; se omite.`); continue; }
      log(`  · Rol "${rol.nombre}" (${rol.alcance}): se creará.`);
      if (aplicar) await db.query(
        'INSERT INTO roles (codigo, nombre, descripcion, alcance, permisos, estado) VALUES (?, ?, ?, ?, ?, ?)',
        [rol.codigo, rol.nombre, rol.descripcion, rol.alcance, JSON.stringify(rol.permisos), 'Activo']
      );
      continue;
    }
    if (Object.keys(normalizarPermisos(fila.permisos)).length && !forzar) { log(`  · Rol "${rol.nombre}": ya tiene permisos (usa --forzar-permisos para reemplazarlos).`); continue; }
    log(`  · Rol "${rol.nombre}": se escribirán sus permisos.`);
    if (aplicar) await db.query('UPDATE roles SET permisos = ? WHERE id_rol = ?', [JSON.stringify(rol.permisos), fila.id_rol]);
  }

  // 2. Delegaciones de los roles con alcance "Autorizado"
  const [activas] = await db.query("SELECT id_delegacion, codigo FROM delegaciones WHERE estado = 'Activa' ORDER BY codigo");
  const marcadores = ROLES_CON_TODAS_LAS_DELEGACIONES.map(() => '?').join(', ');
  const [autorizados] = await db.query(
    `SELECT u.id_usuario, u.correo FROM usuarios u JOIN roles r ON r.id_rol = u.id_rol WHERE r.nombre IN (${marcadores})`,
    ROLES_CON_TODAS_LAS_DELEGACIONES
  );
  for (const a of autorizados) {
    const [tiene] = await db.query('SELECT id_delegacion FROM usuario_delegaciones WHERE id_usuario = ?', [a.id_usuario]);
    const set = new Set(tiene.map(t => Number(t.id_delegacion)));
    const faltan = activas.filter(d => !set.has(Number(d.id_delegacion)));
    if (!faltan.length) { log(`  · ${a.correo}: ya tiene todas las delegaciones activas.`); continue; }
    log(`  · ${a.correo}: se le autorizarán ${faltan.map(d => d.codigo).join(', ')}`);
    if (aplicar) for (const d of faltan) await db.query('INSERT INTO usuario_delegaciones (id_usuario, id_delegacion) VALUES (?, ?)', [a.id_usuario, d.id_delegacion]);
  }

  // 3. Contraseñas sin cifrar
  const [todos] = await db.query('SELECT id_usuario, correo, password_hash FROM usuarios');
  const planas = todos.filter(u => !clave.esBcrypt(u.password_hash));
  if (!planas.length) log('  · Todas las contraseñas están cifradas con bcrypt.');
  for (const u of planas) {
    if (claveDemo) {
      if (!clave.validarRequisitos(claveDemo)) throw new Error(`--clave-demo no cumple los requisitos. ${clave.REQUISITOS}`);
      log(`  · ${u.correo}: contraseña sin cifrar → se reemplazará por la clave de demostración cifrada`);
      if (aplicar) await db.query('UPDATE usuarios SET password_hash = ? WHERE id_usuario = ?', [await clave.hashear(claveDemo), u.id_usuario]);
    } else {
      log(`  ⚠ ${u.correo}: contraseña SIN cifrar; no podrá ingresar hasta restablecerla (o ejecutar con --clave-demo).`);
    }
  }

  // 4. Usuarios de demostración (solo con --clave-demo)
  if (claveDemo) {
    if (!clave.validarRequisitos(claveDemo)) throw new Error(`--clave-demo no cumple los requisitos. ${clave.REQUISITOS}`);
    if (!activas.length) throw new Error('No hay delegaciones activas para asignar a los usuarios de demostración.');
    const [roles2] = await db.query('SELECT id_rol, nombre FROM roles');
    for (const u of USUARIOS_DEMO) {
      const [ya] = await db.query('SELECT id_usuario FROM usuarios WHERE correo = ?', [u.correo]);
      if (ya.length) { log(`  · ${u.correo}: ya existe (no se modifica).`); continue; }
      const rol = roles2.find(r => r.nombre === u.rol);
      if (!rol) { log(`  ⚠ ${u.correo}: el rol "${u.rol}" aún no existe (ejecuta primero con --aplicar).`); continue; }
      const deleg = u.delegaciones === 'todas' ? activas : activas.slice(0, u.delegaciones);
      log(`  · ${u.correo}: se creará con rol ${u.rol} y delegaciones ${deleg.map(d => d.codigo).join(', ')}.`);
      if (!aplicar) continue;
      const [r] = await db.query(
        'INSERT INTO usuarios (rut, nombre, correo, password_hash, id_rol, id_delegacion_activa, estado) VALUES (NULL, ?, ?, ?, ?, ?, ?)',
        [u.nombre, u.correo, await clave.hashear(claveDemo), rol.id_rol, deleg[0].id_delegacion, 'Activo']
      );
      for (const d of deleg) await db.query('INSERT INTO usuario_delegaciones (id_usuario, id_delegacion) VALUES (?, ?)', [r.insertId, d.id_delegacion]);
    }
  }
  log(aplicar ? '✔ Listo.' : '✔ Simulación terminada.');
}

module.exports = { main, leerArgumentos };

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '../.env') });
  main(leerArgumentos(process.argv.slice(2)))
    .then(() => process.exit(0))
    .catch(err => { console.error('✖', err.message); process.exit(1); });
}
