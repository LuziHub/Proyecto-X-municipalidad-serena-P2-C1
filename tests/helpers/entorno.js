'use strict';

// Entorno de pruebas SIN red ni MySQL:
//   - db: SQLite en memoria con las mismas tablas y columnas de sgr_laserena_db (interfaz de mysql2/promise).
//   - express, jsonwebtoken, nodemailer y bcryptjs: sustitutos mínimos (HS256 real con node:crypto;
//     el "bcrypt" de prueba usa SHA-256 con el mismo formato de 60 caracteres).
// Sirve para probar la lógica de permisos, delegaciones, validaciones y recuperación.
// NO prueba MySQL, Express ni bcryptjs reales: eso se comprueba en el servidor (ver LEEME).

const Module = require('node:module');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const RAIZ = path.resolve(__dirname, '../..');
const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');

// ── Base de datos ───────────────────────────────────────────────────────────
const ESQUEMA = `
CREATE TABLE delegaciones (id_delegacion INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL, direccion TEXT NOT NULL, comuna TEXT NOT NULL DEFAULT 'La Serena', estado TEXT NOT NULL DEFAULT 'Activa', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE roles (id_rol INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL UNIQUE, descripcion TEXT, alcance TEXT NOT NULL DEFAULT 'Delegación', permisos TEXT, estado TEXT NOT NULL DEFAULT 'Activo', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE usuarios (id_usuario INTEGER PRIMARY KEY AUTOINCREMENT, rut TEXT, nombre TEXT NOT NULL, correo TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, id_rol INTEGER NOT NULL REFERENCES roles(id_rol), id_delegacion_activa INTEGER NOT NULL REFERENCES delegaciones(id_delegacion), estado TEXT NOT NULL DEFAULT 'Activo', ultimo_ingreso TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE usuario_delegaciones (id_usuario INTEGER NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE, id_delegacion INTEGER NOT NULL REFERENCES delegaciones(id_delegacion), PRIMARY KEY (id_usuario, id_delegacion));
CREATE TABLE items_metas (id_item INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL, descripcion TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'Activo', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE tipos_atencion (id_tipo INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL, descripcion TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'Activo', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE sub_atenciones (id_sub_atencion INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL, id_tipo INTEGER NOT NULL REFERENCES tipos_atencion(id_tipo), estado TEXT NOT NULL DEFAULT 'Activa', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE atenciones_ciudadanas (id_atencion INTEGER PRIMARY KEY AUTOINCREMENT, identificador_atencion TEXT NOT NULL UNIQUE, solicitante TEXT NOT NULL, id_tipo INTEGER NOT NULL REFERENCES tipos_atencion(id_tipo), id_sub_atencion INTEGER NOT NULL REFERENCES sub_atenciones(id_sub_atencion), descripcion TEXT NOT NULL, id_delegacion INTEGER NOT NULL REFERENCES delegaciones(id_delegacion), id_responsable INTEGER NOT NULL REFERENCES usuarios(id_usuario), fecha_registro TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE password_resets (id_reset INTEGER PRIMARY KEY AUTOINCREMENT, correo TEXT NOT NULL, codigo TEXT NOT NULL, intentos_fallidos INTEGER NOT NULL DEFAULT 0, usado INTEGER NOT NULL DEFAULT 0, expira_en TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`;

const dosDigitos = n => String(n).padStart(2, '0');
const aTexto = d => `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())} ${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}:${dosDigitos(d.getSeconds())}`;

function crearBase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(ESQUEMA);
  return {
    sqlite,
    async query(sql, params = []) {
      const args = params.map(p => (p === undefined ? null : p instanceof Date ? aTexto(p) : p));
      const limpio = sql.trim();
      if (/^select/i.test(limpio)) return [sqlite.prepare(limpio).all(...args)];
      const r = sqlite.prepare(limpio).run(...args);
      return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
    }
  };
}

// ── Sustitutos de módulos externos ──────────────────────────────────────────
const b64 = b => Buffer.from(b).toString('base64url');
const SEGUNDOS = { s: 1, m: 60, h: 3600, d: 86400 };
const jwtStub = {
  sign(payload, secreto, { expiresIn = '1h' } = {}) {
    const m = /^(\d+)([smhd])$/.exec(expiresIn);
    const cuerpo = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + Number(m[1]) * SEGUNDOS[m[2]] };
    const datos = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64(JSON.stringify(cuerpo))}`;
    return `${datos}.${crypto.createHmac('sha256', secreto).update(datos).digest('base64url')}`;
  },
  verify(token, secreto) {
    const [h, p, s] = String(token).split('.');
    if (!h || !p || !s) throw new Error('jwt malformed');
    const esperado = crypto.createHmac('sha256', secreto).update(`${h}.${p}`).digest('base64url');
    if (s.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(esperado))) throw new Error('invalid signature');
    const cuerpo = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (cuerpo.exp && cuerpo.exp < Date.now() / 1000) throw new Error('jwt expired');
    return cuerpo;
  }
};

const bcryptStub = {
  hash: async texto => `$2b$10$${sha(texto).slice(0, 53)}`,
  compare: async (texto, hash) => String(hash).slice(7) === sha(texto).slice(0, 53)
};

function crearExpressStub() {
  function Router() {
    const rutas = [];
    const r = {
      rutas,
      use(sub) { rutas.push(...sub.rutas); return r; },
      async handle(req, res) {
        for (const ruta of rutas) {
          if (ruta.metodo !== req.method) continue;
          const m = ruta.regex.exec(req.path);
          if (!m) continue;
          req.params = {};
          ruta.claves.forEach((k, i) => { req.params[k] = decodeURIComponent(m[i + 1]); });
          let i = 0;
          const pendientes = [];
          // Express no espera a los manejadores asíncronos; aquí sí, para poder inspeccionar la respuesta.
          const siguiente = () => {
            const fn = ruta.manejadores[i++];
            if (fn) pendientes.push(Promise.resolve(fn(req, res, siguiente)));
          };
          siguiente();
          while (pendientes.length) await pendientes.shift();
          return true;
        }
        return false;
      }
    };
    for (const metodo of ['get', 'post', 'put', 'delete']) {
      r[metodo] = (ruta, ...manejadores) => {
        const claves = [];
        const regex = new RegExp('^' + ruta.replace(/:([a-zA-Z]+)/g, (_, k) => { claves.push(k); return '([^/]+)'; }) + '$');
        rutas.push({ metodo: metodo.toUpperCase(), regex, claves, manejadores });
        return r;
      };
    }
    return r;
  }
  const express = () => { throw new Error('express() no está simulado'); };
  express.Router = Router;
  return express;
}

// ── Carga del código del proyecto con los sustitutos ────────────────────────
function cargar() {
  process.env.JWT_SECRET = 'secreto-de-prueba-123456';
  process.env.SMTP_HOST = 'smtp.prueba.local';
  process.env.RECUPERACION_ESPERA_SEG = '45';
  delete process.env.NODE_ENV;
  const db = crearBase();
  const correos = [];
  const sustitutos = {
    express: crearExpressStub(),
    jsonwebtoken: jwtStub,
    bcryptjs: bcryptStub,
    nodemailer: { createTransport: () => ({ sendMail: async m => { correos.push(m); return {}; } }) },
    [path.join(RAIZ, 'src/config/db')]: db,
    [path.join(RAIZ, 'src/config/db.js')]: db
  };

  const original = Module._load;
  Module._load = function (request, parent, ...resto) {
    if (sustitutos[request]) return sustitutos[request];
    if (parent && request.startsWith('.')) {
      const abs = path.resolve(path.dirname(parent.filename), request);
      if (sustitutos[abs]) return sustitutos[abs];
    }
    return original.call(this, request, parent, ...resto);
  };

  // Estado nuevo en cada carga (limitadores, caché de módulos).
  for (const k of Object.keys(require.cache)) if (k.startsWith(RAIZ) && !k.includes(`${path.sep}tests${path.sep}`)) delete require.cache[k];

  const router = require(path.join(RAIZ, 'src/routes/api.js'));
  const auth = require(path.join(RAIZ, 'src/middleware/auth.js'));
  const permisos = require(path.join(RAIZ, 'src/config/permisos.js'));

  async function llamar(metodo, url, { token, delegacion, body, ip = '10.0.0.1' } = {}) {
    const [ruta, qs = ''] = url.split('?');
    const req = {
      method: metodo.toUpperCase(), path: ruta, url, ip,
      query: Object.fromEntries(new URLSearchParams(qs)),
      headers: {}, body
    };
    if (token) req.headers.authorization = `Bearer ${token}`;
    if (delegacion !== undefined) req.headers['x-delegacion'] = String(delegacion);
    const res = { statusCode: 200, headers: {}, cuerpo: undefined };
    res.status = c => { res.statusCode = c; return res; };
    res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
    res.json = o => { res.cuerpo = o; return res; };
    res.send = t => { res.cuerpo = t; return res; };
    const silenciar = [console.error, console.warn, console.log];
    console.error = console.warn = console.log = () => {};
    try {
      const atendida = await router.handle(req, res);
      if (!atendida) res.statusCode = 404;
    } finally { [console.error, console.warn, console.log] = silenciar; }
    return res;
  }

  return { db, router, auth, permisos, correos, llamar, descargar: () => { Module._load = original; } };
}

// ── Datos de prueba (misma estructura que tu base real) ─────────────────────
const CLAVE = 'Clave1234';
async function sembrar(ctx) {
  const s = ctx.db.sqlite;
  const { PERMISOS_BASE } = ctx.permisos;
  const hash = await bcryptStub.hash(CLAVE);

  const del = s.prepare('INSERT INTO delegaciones (codigo, nombre, direccion, estado) VALUES (?, ?, ?, ?)');
  [['DEL01', 'Centro', 'Prat 1', 'Activa'], ['DEL02', 'Las Compañías', 'Cuatro Esquinas 2', 'Activa'], ['DEL03', 'La Pampa', 'Pampa 3', 'Inactiva'],
   ['DEL04', 'Rural', 'Ruta 5', 'Activa']].forEach(f => del.run(...f));

  const rol = s.prepare('INSERT INTO roles (codigo, nombre, descripcion, alcance, permisos, estado) VALUES (?, ?, ?, ?, ?, ?)');
  rol.run('ROL01', 'Administrador', 'Control total', 'Autorizado', JSON.stringify(PERMISOS_BASE.Administrador), 'Activo');   // 1
  rol.run('ROL02', 'Operador', 'Registro diario', 'Delegación', JSON.stringify(PERMISOS_BASE.Operador), 'Activo');           // 2
  rol.run('ROL03', 'Consultor', 'Consulta', 'Lectura', JSON.stringify(PERMISOS_BASE.Consultor), 'Activo');                   // 3
  rol.run('ROL04', 'Suspendido', 'Rol dado de baja', 'Autorizado', JSON.stringify(PERMISOS_BASE.Administrador), 'Inactivo'); // 4
  rol.run('ROL05', 'SinPermisos', 'Sin configurar', 'Delegación', null, 'Activo');                                           // 5

  const usu = s.prepare('INSERT INTO usuarios (rut, nombre, correo, password_hash, id_rol, id_delegacion_activa, estado) VALUES (?, ?, ?, ?, ?, ?, ?)');
  usu.run(null, 'Ada Admin', 'admin@laserena.cl', hash, 1, 1, 'Activo');                 // 1
  usu.run(null, 'Ana Operadora', 'ana@laserena.cl', hash, 2, 1, 'Activo');               // 2
  usu.run(null, 'Luis Consultor', 'luis@laserena.cl', hash, 3, 1, 'Activo');             // 3
  usu.run(null, 'Sara Operadora', 'sara@laserena.cl', hash, 2, 2, 'Activo');             // 4
  usu.run(null, 'Ines Inactiva', 'inactiva@laserena.cl', hash, 2, 1, 'Inactivo');        // 5
  usu.run(null, 'Clave Plana', 'plana@laserena.cl', '123456', 2, 1, 'Activo');           // 6
  usu.run(null, 'Sin Delegacion', 'sindel@laserena.cl', hash, 2, 3, 'Activo');           // 7 (su delegación está inactiva)
  usu.run(null, 'Rol Suspendido', 'suspendido@laserena.cl', hash, 4, 1, 'Activo');       // 8
  usu.run(null, 'Sin Permisos', 'sinperm@laserena.cl', hash, 5, 1, 'Activo');            // 9

  const ud = s.prepare('INSERT INTO usuario_delegaciones (id_usuario, id_delegacion) VALUES (?, ?)');
  [1, 2, 4].forEach(d => ud.run(1, d));  // el administrador está autorizado en todas las activas
  ud.run(3, 2);                          // el consultor además en DEL02

  const tipo = s.prepare('INSERT INTO tipos_atencion (codigo, nombre, descripcion, estado) VALUES (?, ?, ?, ?)');
  tipo.run('T01', 'Reclamo', 'Reclamos vecinales', 'Activo');   // 1
  tipo.run('T02', 'Consulta', 'Consultas', 'Activo');           // 2
  tipo.run('T03', 'Antiguo', 'Tipo en desuso', 'Inactivo');     // 3
  const sub = s.prepare('INSERT INTO sub_atenciones (codigo, nombre, id_tipo, estado) VALUES (?, ?, ?, ?)');
  sub.run('S01', 'Alumbrado', 1, 'Activa');   // 1
  sub.run('S02', 'Aseo', 1, 'Activa');        // 2
  sub.run('S03', 'Poda', 1, 'Inactiva');      // 3
  sub.run('S04', 'Horarios', 2, 'Activa');    // 4

  s.prepare('INSERT INTO items_metas (codigo, nombre, descripcion) VALUES (?, ?, ?)').run('IT01', 'Visitas', 'Visitas a terreno');

  const at = s.prepare('INSERT INTO atenciones_ciudadanas (identificador_atencion, solicitante, id_tipo, id_sub_atencion, descripcion, id_delegacion, id_responsable) VALUES (?, ?, ?, ?, ?, ?, ?)');
  at.run('ATC-2026-000001', 'Pedro Pérez', 1, 1, 'Luz apagada en calle', 1, 2);   // DEL01, de Ana
  at.run('ATC-2026-000002', 'María Soto', 1, 2, 'Basura acumulada', 1, 1);        // DEL01, del admin
  at.run('ATC-2026-000003', 'Juan Rojas', 2, 4, 'Consulta de horarios', 2, 4);    // DEL02, de Sara
}

async function nuevo() {
  const ctx = cargar();
  await sembrar(ctx);
  const ids = { admin: 1, ana: 2, luis: 3, sara: 4, inactiva: 5, plana: 6, sindel: 7, suspendido: 8, sinperm: 9 };
  ctx.tok = Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, ctx.auth.firmarToken(v)]));
  ctx.ids = ids;
  ctx.login = (correo, password = CLAVE, extra = {}) => ctx.llamar('POST', '/auth/login', { body: { correo, password }, ...extra });
  return ctx;
}

module.exports = { cargar, sembrar, nuevo, crearBase, jwtStub, bcryptStub, CLAVE, aTexto };
