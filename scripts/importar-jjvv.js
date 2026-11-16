'use strict';
/*
 * Importa el catálogo de organizaciones (juntas de vecinos, clubes, centros de madres, etc.)
 * desde la planilla «base_datos_JJVV» (.xlsx) o desde un .csv con las mismas columnas.
 *
 *   node scripts/importar-jjvv.js archivo.xlsx              → solo informa (simulación)
 *   node scripts/importar-jjvv.js archivo.xlsx --aplicar    → carga las organizaciones nuevas
 *
 * Columnas esperadas (por encabezado): ORGANIZACIONES, DOMICILIO LEGAL, TERRIT. DELEG., SOCIOS ACTIVOS,
 * FECHA CONSTIT., Nº REG. P.J., FECHA INSCRIPC EN REG., REG. DIR. Nº
 *
 * Calidad de los datos: lo que viene incompleto (sin domicilio o sin territorio) se importa igual y se
 * informa; los nombres repetidos (sin distinguir mayúsculas, tildes ni espacios) se cargan una sola vez.
 * Es idempotente: las organizaciones que ya existen se omiten.
 * La planilla no debe subirse al repositorio; se importa desde tu computador o el servidor.
 */
const fs = require('fs');
const path = require('path');

const sinTildes = t => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '');
const limpiar = v => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && !(v instanceof Date)) v = v.text !== undefined ? v.text : (v.result !== undefined ? v.result : String(v));
  const t = String(v).replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
};
const clave = t => sinTildes(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function aFecha(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : null;
  if (d && !isNaN(d)) return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const t = limpiar(v);
  let m = t && /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t && /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(t);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}
const aEntero = v => { const n = parseInt(limpiar(v), 10); return Number.isFinite(n) && n >= 0 ? n : null; };
const aCodigo = v => { const t = limpiar(v); if (!t) return null; const c = t.replace(/\.0+$/, ''); return /^[A-Za-z0-9_-]{1,20}$/.test(c) ? c : null; };

// Encabezado → campo
function campoDe(encabezado) {
  const h = clave(encabezado || '');
  if (h.startsWith('organizacion')) return 'nombre';
  if (h.startsWith('domicilio')) return 'domicilio';
  if (h.startsWith('territ')) return 'territorio';
  if (h.startsWith('socios')) return 'socios_activos';
  if (h.startsWith('fecha constit')) return 'fecha_constitucion';
  if (h.startsWith('n reg p j') || h.startsWith('no reg p j') || h.startsWith('nº reg')) return 'nro_registro_pj';
  if (h.startsWith('fecha inscripc')) return 'fecha_inscripcion';
  if (h.startsWith('reg dir')) return 'reg_dir';
  return null;
}

// Convierte filas crudas (arreglos) en objetos normalizados. La primera fila son los encabezados.
function normalizarFilas(crudas) {
  const [cab, ...resto] = crudas;
  const campos = (cab || []).map(campoDe);
  if (!campos.includes('nombre')) throw new Error('No se encontró la columna «ORGANIZACIONES» en la primera fila.');
  return resto.map(f => {
    const o = {};
    campos.forEach((c, i) => { if (c) o[c] = f[i]; });
    return {
      nombre: limpiar(o.nombre), domicilio: limpiar(o.domicilio), territorio: (limpiar(o.territorio) || '').toUpperCase() || null,
      socios_activos: aEntero(o.socios_activos), fecha_constitucion: aFecha(o.fecha_constitucion),
      nro_registro_pj: aCodigo(o.nro_registro_pj), fecha_inscripcion: aFecha(o.fecha_inscripcion), reg_dir: aCodigo(o.reg_dir)
    };
  }).filter(o => o.nombre);
}

// Importa (o simula) las filas normalizadas. Devuelve el informe de calidad.
async function importarFilas(filas, { aplicar = false, db = require('../src/config/db') } = {}) {
  const informe = { leidas: filas.length, nuevas: 0, yaExistian: 0, duplicadas: [], sinDomicilio: 0, sinTerritorio: 0, territorios: {} };
  const [existentes] = await db.query('SELECT nombre FROM organizaciones');
  const vistos = new Set(existentes.map(e => clave(e.nombre)));
  const nuevas = [];
  for (const f of filas) {
    const k = clave(f.nombre);
    if (!k) continue;
    if (vistos.has(k)) {
      if (nuevas.some(n => clave(n.nombre) === k)) informe.duplicadas.push(f.nombre); else informe.yaExistian++;
      continue;
    }
    vistos.add(k);
    nuevas.push(f);
    if (!f.domicilio) informe.sinDomicilio++;
    if (!f.territorio) informe.sinTerritorio++;
    informe.territorios[f.territorio || '(sin territorio)'] = (informe.territorios[f.territorio || '(sin territorio)'] || 0) + 1;
  }
  informe.nuevas = nuevas.length;
  if (aplicar) {
    for (const f of nuevas) {
      await db.query(
        `INSERT INTO organizaciones (nombre, domicilio, territorio, socios_activos, fecha_constitucion, nro_registro_pj, fecha_inscripcion, reg_dir, estado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Activo')`,
        [f.nombre.slice(0, 255), f.domicilio && f.domicilio.slice(0, 255), f.territorio && f.territorio.slice(0, 60), f.socios_activos, f.fecha_constitucion, f.nro_registro_pj, f.fecha_inscripcion, f.reg_dir]
      );
    }
  }
  return informe;
}

// ── Lectura de archivos ──
function leerCsv(texto) {
  const filas = []; let fila = [], campo = '', comillas = false;
  const sep = (texto.split('\n')[0].match(/;/g) || []).length > (texto.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') comillas = false; else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && texto[i + 1] === '\n') i++; fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter(f => f.some(x => String(x).trim() !== ''));
}
async function leerArchivo(ruta) {
  if (/\.csv$/i.test(ruta)) return leerCsv(fs.readFileSync(ruta, 'utf8').replace(/^﻿/, ''));
  const ExcelJS = require('exceljs');      // ya es dependencia del proyecto (exportación a Excel)
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(ruta);
  const hoja = wb.worksheets[0];
  const filas = [];
  hoja.eachRow({ includeEmpty: false }, row => filas.push(row.values.slice(1)));
  return filas;
}

async function main(args) {
  const archivo = args.find(a => !a.startsWith('--'));
  if (!archivo) throw new Error('Indica el archivo: node scripts/importar-jjvv.js archivo.xlsx [--aplicar]');
  const aplicar = args.includes('--aplicar');
  const filas = normalizarFilas(await leerArchivo(archivo));
  const r = await importarFilas(filas, { aplicar });
  console.log(aplicar ? '▶ MODO APLICAR' : '▶ Simulación (agrega --aplicar para cargar)');
  console.log(`  Organizaciones leídas: ${r.leidas}`);
  console.log(`  ${aplicar ? 'Cargadas' : 'Por cargar'}: ${r.nuevas}   ·   ya existían: ${r.yaExistian}`);
  console.log(`  Nombres repetidos en el archivo (se carga uno): ${r.duplicadas.length}${r.duplicadas.length ? ' → ' + r.duplicadas.slice(0, 5).join('; ') : ''}`);
  console.log(`  Sin domicilio: ${r.sinDomicilio}   ·   sin territorio: ${r.sinTerritorio}`);
  console.log('  Por territorio:', Object.entries(r.territorios).map(([t, n]) => `${t} ${n}`).join(', '));
}

module.exports = { normalizarFilas, importarFilas, leerCsv, clave };

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '../.env') });
  main(process.argv.slice(2)).then(() => process.exit(0)).catch(e => { console.error('✖', e.message); process.exit(1); });
}
