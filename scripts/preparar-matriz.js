'use strict';
/*
 * Prepara la base para la Matriz SGR (después de ejecutar database/03_matriz.sql).
 * Es idempotente: se puede ejecutar varias veces sin duplicar nada ni pisar lo que ya exista.
 *
 *   node scripts/preparar-matriz.js                       → solo muestra qué haría
 *   node scripts/preparar-matriz.js --aplicar             → aplica los cambios
 *   node scripts/preparar-matriz.js --aplicar --clave-demo='Demo2026x' --datos-demo
 *        → además crea un usuario de demostración por cargo y gestiones/tubo FICTICIOS
 *
 * Qué hace:
 *   1. Crea el período vigente (4.º trimestre 2026) con sus parámetros, si no existe.
 *   2. Crea los ítems de la matriz (items_metas) que falten.
 *   3. Crea los roles por cargo que falten y SUMA los módulos de la matriz a los roles que ya existen
 *      (nunca quita permisos).
 *   4. Carga las metas y ponderadores de cada cargo en el período (solo las que falten).
 *   5. Con --clave-demo y --datos-demo: usuarios de cargo y datos ficticios para probar.
 * La clave no se guarda en ningún archivo: entrégala por separado.
 */
const path = require('path');
const { ROLES_DEMO, MODULOS_MATRIZ, normalizarPermisos } = require('../src/config/permisos');
const { ITEMS, CARGOS, USUARIOS_MATRIZ } = require('../src/config/matriz');

const PERIODO = { nombre: '4.º Trimestre 2026', inicio: '2026-10-01', fin: '2026-12-31' };

function leerArgumentos(args) {
  return {
    aplicar: args.includes('--aplicar'),
    claveDemo: (args.find(a => a.startsWith('--clave-demo=')) || '').slice('--clave-demo='.length),
    datosDemo: args.includes('--datos-demo')
  };
}

const dos = n => String(n).padStart(2, '0');
const texto = d => `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`;
const sumar = (f, n) => { const d = new Date(`${f}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return texto(d); };

async function main({ aplicar, claveDemo, datosDemo }, log = console.log) {
  const db = require('../src/config/db');
  const clave = require('../src/utils/clave');
  const { hoyChile } = require('../src/utils/fechas');
  log(aplicar ? '▶ MODO APLICAR: se modificará la base.' : '▶ Modo simulación: no se modifica nada (agrega --aplicar para ejecutar).');

  // 1. Período
  let [[per]] = [await db.query('SELECT id_periodo FROM periodos WHERE nombre = ?', [PERIODO.nombre])];
  let idPeriodo = per && per[0] ? per[0].id_periodo : null;
  if (idPeriodo) log(`  · Período "${PERIODO.nombre}": ya existe.`);
  else {
    log(`  · Período "${PERIODO.nombre}" (${PERIODO.inicio} a ${PERIODO.fin}): se creará.`);
    if (aplicar) {
      const [r] = await db.query('INSERT INTO periodos (nombre, fecha_inicio, fecha_fin) VALUES (?, ?, ?)', [PERIODO.nombre, PERIODO.inicio, PERIODO.fin]);
      idPeriodo = r.insertId;
    }
  }

  // 2. Ítems
  const [itemsBd] = await db.query('SELECT id_item, codigo FROM items_metas');
  const idItem = new Map(itemsBd.map(i => [i.codigo, i.id_item]));
  for (const [codigo, it] of Object.entries(ITEMS)) {
    if (idItem.has(codigo)) continue;
    log(`  · Ítem ${codigo} "${it.nombre}": se creará.`);
    if (aplicar) {
      const [r] = await db.query('INSERT INTO items_metas (codigo, nombre, descripcion, estado) VALUES (?, ?, ?, ?)', [codigo, it.nombre, it.descripcion, 'Activo']);
      idItem.set(codigo, r.insertId);
    }
  }

  // 3. Roles: crear los cargos que falten y sumar los módulos de la matriz a los existentes
  const [roles] = await db.query('SELECT id_rol, codigo, nombre, permisos FROM roles');
  const idRol = new Map(roles.map(r => [r.nombre, r.id_rol]));
  for (const rol of ROLES_DEMO) {
    const fila = roles.find(r => r.nombre === rol.nombre);
    if (!fila) {
      if (!CARGOS.some(c => c.nombre === rol.nombre)) continue;       // los roles base los crea preparar-demo.js
      if (roles.some(r => r.codigo === rol.codigo)) { log(`  ⚠ Rol "${rol.nombre}": el código ${rol.codigo} ya lo usa otro rol; se omite.`); continue; }
      log(`  · Rol de cargo "${rol.nombre}": se creará.`);
      if (aplicar) {
        const [r] = await db.query('INSERT INTO roles (codigo, nombre, descripcion, alcance, permisos, estado) VALUES (?, ?, ?, ?, ?, ?)',
          [rol.codigo, rol.nombre, rol.descripcion, rol.alcance, JSON.stringify(rol.permisos), 'Activo']);
        idRol.set(rol.nombre, r.insertId);
      }
      continue;
    }
    const actuales = normalizarPermisos(fila.permisos);
    if (!Object.keys(actuales).length) continue;                       // sin permisos: lo resuelve preparar-demo.js
    const faltan = MODULOS_MATRIZ.filter(m => rol.permisos[m] && !actuales[m]);
    if (!faltan.length) continue;
    log(`  · Rol "${rol.nombre}": se le sumarán ${faltan.join(', ')}.`);
    if (aplicar) {
      for (const m of faltan) actuales[m] = rol.permisos[m];
      await db.query('UPDATE roles SET permisos = ? WHERE id_rol = ?', [JSON.stringify(actuales), fila.id_rol]);
    }
  }

  // 4. Metas por cargo
  let nuevas = 0;
  if (idPeriodo) {
    for (const c of CARGOS) {
      const rolId = idRol.get(c.nombre);
      if (!rolId) continue;
      const [ya] = await db.query('SELECT id_item FROM metas_cargo WHERE id_periodo = ? AND id_rol = ?', [idPeriodo, rolId]);
      const tiene = new Set(ya.map(x => Number(x.id_item)));
      for (const m of c.metas) {
        const it = idItem.get(m.item);
        if (!it || tiene.has(Number(it))) continue;
        nuevas++;
        if (aplicar) await db.query(
          'INSERT INTO metas_cargo (id_periodo, id_rol, id_item, ponderador, meta, calculo, requiere_contacto) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [idPeriodo, rolId, it, m.ponderador, m.meta, m.calculo, m.contacto ? 1 : 0]);
      }
    }
  }
  log(`  · Metas por cargo: ${nuevas ? `${nuevas} por cargar` : 'al día'}.`);

  // 5. Demostración
  if (claveDemo && aplicar && idPeriodo) {
    if (!clave.validarRequisitos(claveDemo)) throw new Error(`--clave-demo no cumple los requisitos. ${clave.REQUISITOS}`);
    const [activas] = await db.query("SELECT id_delegacion FROM delegaciones WHERE estado = 'Activa' ORDER BY codigo");
    if (!activas.length) throw new Error('No hay delegaciones activas.');
    const deleg = activas[0].id_delegacion;
    const hoy = hoyChile();
    const hash = await clave.hashear(claveDemo);
    for (const u of USUARIOS_MATRIZ) {
      const cargo = CARGOS.find(c => c.codigo === u.cargo);
      const rolId = idRol.get(cargo.nombre);
      let [ex] = await db.query('SELECT id_usuario FROM usuarios WHERE correo = ?', [u.correo]);
      if (ex.length) { log(`  · ${u.correo}: ya existe.`); continue; }
      const [r] = await db.query('INSERT INTO usuarios (rut, nombre, correo, password_hash, id_rol, id_delegacion_activa, estado) VALUES (NULL, ?, ?, ?, ?, ?, ?)',
        [u.nombre, u.correo, hash, rolId, deleg, 'Activo']);
      await db.query('INSERT INTO usuario_delegaciones (id_usuario, id_delegacion) VALUES (?, ?)', [r.insertId, deleg]);
      log(`  · ${u.correo}: creado con el cargo ${cargo.nombre}.`);
      if (!datosDemo) continue;
      // gestiones ficticias: algunas por ítem de conteo, en días hábiles ya transcurridos
      const conteo = cargo.metas.filter(m => m.calculo === 'conteo');
      let n = 0;
      for (const [i, m] of conteo.entries()) {
        const cantidad = Math.max(1, Math.round(Math.min(m.meta, 30) * (0.9 - i * 0.15)));
        for (let k = 0; k < cantidad; k++) {
          const f = sumar(hoy, -((k * 2 + i) % 40));
          if (f < PERIODO.inicio) continue;
          const [g] = await db.query(
            'INSERT INTO gestiones (codigo, fecha_gestion, actividad, id_item, contacto_nombre, contacto_telefono, puntua, unidades, id_delegacion, id_responsable) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)',
            ['TMP', f, `${ITEMS[m.item].nombre} (demo)`, idItem.get(m.item), m.contacto ? 'Vecino de ejemplo' : null, m.contacto ? '+56912345678' : null, deleg, r.insertId]);
          const [, mes, dd] = f.split('-').map(Number);
          n++;
          await db.query('UPDATE gestiones SET codigo = ?, codigo_area = ? WHERE id_gestion = ?',
            [`${cargo.codigo === 'GSOC' ? 'SOC' : 'GES'}-${String(g.insertId).padStart(5, '0')}`, `${cargo.codigo}${mes}${dd}${n}`, g.insertId]);
        }
      }
      if (cargo.metas.some(m => m.calculo === 'tubo')) {
        const estados = ['Ingresado', 'Pendiente', 'En proceso', 'Realizado', 'Realizado'];
        for (const [k, e] of estados.entries()) {
          const [t] = await db.query(
            'INSERT INTO tubo (codigo, titulo, solicitante, ambito, estado, fecha_solicitud, fecha_realizado, id_delegacion, id_responsable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            ['TMP', `Solicitud de ejemplo ${k + 1}`, 'Solicitante de ejemplo', k % 2 ? 'EXT' : 'INT', e, sumar(hoy, -10 + k), e === 'Realizado' ? sumar(hoy, -3) : null, deleg, r.insertId]);
          await db.query('UPDATE tubo SET codigo = ? WHERE id_tubo = ?', [`TUB-${String(t.insertId).padStart(5, '0')}`, t.insertId]);
        }
      }
      log(`    ${n} gestiones ficticias cargadas.`);
    }
    // catálogo y cartas FICTICIOS
    if (datosDemo) {
      const [hayOrg] = await db.query("SELECT COUNT(*) AS n FROM organizaciones WHERE nombre LIKE '%(demo)'");
      if (!Number(hayOrg[0].n)) {
        const orgs = [['Junta de Vecinos Villa Ejemplo Norte (demo)', 'CENTRO'], ['Club Deportivo Ejemplo Sur (demo)', 'ANTENA'], ['Centro de Madres Ejemplo (demo)', 'CIAS'], ['Comité de Adelanto Rural Ejemplo (demo)', 'RURAL']];
        for (const [n, t] of orgs) await db.query("INSERT INTO organizaciones (nombre, territorio, socios_activos, estado) VALUES (?, ?, 25, 'Activo')", [n, t]);
        const [del] = await db.query("SELECT id_usuario FROM usuarios WHERE correo = 'delegado@demo.sgr.cl'");
        const resp = del[0] ? del[0].id_usuario : null;
        if (resp) {
          const cartas = [['Alcaldesa', 'En proceso', 'No aplica'], ['Alcaldesa', 'Aprobada', 'Gabinete'], ['Delegado', 'Finalizada', 'Delegado'], ['Otro', 'No aplica', 'No aplica'], ['Alcaldesa', 'Finalizada', 'Alcaldesa'], ['Delegado', 'En proceso', 'Delegado']];
          for (const [i, [para, estado, pron]] of cartas.entries()) {
            const [r] = await db.query(
              'INSERT INTO cartas (codigo, fecha, numero, para, remite, tema, estado, pronunciamiento, id_delegacion, id_responsable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              ['TMP', sumar(hoy, -12 + i), String(10000 + i), para, 'Remitente de ejemplo', `Solicitud de ejemplo ${i + 1} (demo)`, estado, pron, deleg, resp]);
            await db.query('UPDATE cartas SET codigo = ? WHERE id_carta = ?', [`CAR-${String(r.insertId).padStart(5, '0')}`, r.insertId]);
          }
        }
        log('    Catálogo y cartas ficticios cargados.');
      }
    }
  } else if (claveDemo || datosDemo) {
    log('  · Los usuarios de demostración se crean con --aplicar --clave-demo=...; los datos ficticios, además con --datos-demo.');
  }
  log(aplicar ? '✔ Listo.' : '✔ Simulación terminada.');
}

module.exports = { main, leerArgumentos, PERIODO };

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '../.env') });
  main(leerArgumentos(process.argv.slice(2)))
    .then(() => process.exit(0))
    .catch(err => { console.error('✖', err.message); process.exit(1); });
}
