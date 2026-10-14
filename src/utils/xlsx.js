'use strict';

// Generador mínimo de archivos .xlsx (sin dependencias): una hoja con encabezado en negrita.
// Las celdas son texto en línea, por lo que Excel nunca las interpreta como fórmulas.
const zlib = require('node:zlib');

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(archivos) {
  const partes = [];
  const central = [];
  let desplazamiento = 0;
  for (const { nombre, contenido } of archivos) {
    const nom = Buffer.from(nombre);
    const datos = Buffer.from(contenido);
    const comp = zlib.deflateRawSync(datos);
    const crc = crc32(datos);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nom.length, 26); local.writeUInt16LE(0, 28);
    partes.push(local, nom, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10); cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(datos.length, 24);
    cd.writeUInt16LE(nom.length, 28); cd.writeUInt32LE(desplazamiento, 42);
    central.push(cd, nom);
    desplazamiento += local.length + nom.length + comp.length;
  }
  const dirCentral = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(archivos.length, 8); fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(dirCentral.length, 12); fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...partes, dirCentral, fin]);
}

const escapar = v => String(v)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function letraColumna(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function formatear(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    const p = n => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
  }
  return String(v);
}

// encabezados: [texto]; filas: [[valor, ...]]  → Buffer .xlsx
function crearXlsx(nombreHoja, encabezados, filas) {
  const celda = (valor, fila, col, estilo) => {
    const texto = formatear(valor);
    if (texto === '') return '';
    return `<c r="${letraColumna(col)}${fila}"${estilo ? ` s="${estilo}"` : ''} t="inlineStr"><is><t xml:space="preserve">${escapar(texto)}</t></is></c>`;
  };
  const filaXml = (valores, n, estilo) =>
    `<row r="${n}">${valores.map((v, i) => celda(v, n, i, estilo)).join('')}</row>`;

  const hoja = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    filaXml(encabezados, 1, 1) + filas.map((f, i) => filaXml(f, i + 2, 0)).join('') +
    '</sheetData></worksheet>';

  const nombre = escapar(String(nombreHoja).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Hoja1');
  return zip([
    { nombre: '[Content_Types].xml', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { nombre: '_rels/.rels', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { nombre: 'xl/workbook.xml', contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${nombre}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { nombre: 'xl/_rels/workbook.xml.rels', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { nombre: 'xl/styles.xml', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
    { nombre: 'xl/worksheets/sheet1.xml', contenido: hoja }
  ]);
}

module.exports = { crearXlsx, crc32 };
