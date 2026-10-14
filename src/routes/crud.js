'use strict';

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authRequired, requirePermiso } = require('../middleware/auth');
const { MODULOS_API } = require('../config/modulos');
const { MODULOS, MODULOS_PLANTILLA, ACCIONES, ALCANCES, normalizarPermisos, esSubconjunto, claveAlcance } = require('../config/permisos');
const { alcance } = require('../utils/delegaciones');
const { validarCampos } = require('../utils/validar');
const { crearXlsx } = require('../utils/xlsx');
const clave = require('../utils/clave');

const modulosValidos = Object.keys(MODULOS_API);
modulosValidos.forEach(m => {
  if (!MODULOS[m]) throw new Error(`El módulo "${m}" no está definido en config/permisos.js`);
});

// Columnas que nunca salen del servidor.
const COLUMNAS_PRIVADAS = /(pass|clave|contrase|token|secret|hash)/i;
const limpiar = fila => Object.fromEntries(Object.entries(fila).filter(([k]) => !COLUMNAS_PRIVADAS.test(k)));

const error = (status, message) => ({ status, message });
const responderError = (res, e) => res.status(e.status).json({ status: 'error', message: e.message, ...(e.extra || {}) });
const idValido = v => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const sqlWhere = where => (where.length ? 'WHERE ' + where.join(' AND ') : '');

// ─── Filtros de listado ──────────────────────────────────────────────────────
// Escapa % y _ para que la búsqueda sea literal (el escape '!' funciona en MySQL y en SQLite).
const escaparLike = t => t.replace(/[!%_]/g, c => `!${c}`);

function construirFiltro(modulo, req, conFiltros) {
  const cfg = MODULOS_API[modulo];
  const sc = alcance(modulo, req.auth);
  if (sc.error) return { error: sc.error };

  const where = [];
  const params = [];
  if (sc.where) { where.push(sc.where); params.push(...sc.params); }

  if (conFiltros) {
    const busqueda = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase().slice(0, 100) : '';
    if (busqueda) {
      const like = `%${escaparLike(busqueda)}%`;
      where.push('(' + cfg.busqueda.map(c => `LOWER(${c}) LIKE ? ESCAPE '!'`).join(' OR ') + ')');
      cfg.busqueda.forEach(() => params.push(like));
    }
    const pedido = typeof req.query.estado === 'string' ? req.query.estado.trim().toLowerCase() : '';
    const estado = cfg.estados && cfg.estados.find(e => e.toLowerCase() === pedido);
    if (estado) { where.push(`${cfg.alias}.estado = ?`); params.push(estado); }
  }
  return { where, params };
}

function postProceso(modulo, fila) {
  const f = limpiar(fila);
  if (modulo === 'roles') f.permisos = normalizarPermisos(f.permisos);
  return f;
}

async function buscarPorId(modulo, id, req) {
  const cfg = MODULOS_API[modulo];
  const f = construirFiltro(modulo, req, false);
  if (f.error) return { error: f.error };
  const [filas] = await db.query(
    `SELECT ${cfg.select} FROM ${cfg.from} ${sqlWhere([`${cfg.alias}.${cfg.pk} = ?`, ...f.where])} LIMIT 1`, [id, ...f.params]
  );
  return { fila: filas[0] || null };
}

// ─── Validaciones comunes (duplicados y relaciones) ──────────────────────────
async function revisarIntegridad(cfg, valores, excluirId) {
  const errores = [];
  for (const c of cfg.campos) {
    const v = valores[c.col];
    if (v === null || v === undefined) continue;
    if (c.unico) {
      const [f] = await db.query(
        `SELECT ${cfg.pk} AS id FROM ${cfg.tabla} WHERE LOWER(${c.col}) = LOWER(?)${excluirId ? ` AND ${cfg.pk} <> ?` : ''} LIMIT 1`,
        excluirId ? [v, excluirId] : [v]
      );
      if (f.length) errores.push({ status: 409, message: `Ya existe un registro con ese ${c.etiqueta.toLowerCase()}.` });
    }
    if (c.fk) {
      const [f] = await db.query(`SELECT estado FROM ${c.fk.tabla} WHERE ${c.fk.pk} = ? LIMIT 1`, [v]);
      if (!f.length) errores.push({ status: 400, message: `${c.fk.texto} indicado no existe.` });
      else if (c.fk.activo && ['inactivo', 'inactiva'].includes(String(f[0].estado).toLowerCase())) {
        errores.push({ status: 400, message: `${c.fk.texto} indicado está inactivo.` });
      }
    }
  }
  return errores;
}

// ─── Reglas propias de cada módulo ───────────────────────────────────────────
// Cada regla devuelve { error } para rechazar, o { extras, despues } para completar el guardado.
const RANGO = { global: 3, autorizado: 2, lectura: 2, delegacion: 1 };

const reglas = {
  async usuarios({ req, body, valores, actual, esNuevo }) {
    const auth = req.auth;
    const permitidas = auth.delegaciones.map(d => d.id);

    // Rol: solo puede asignar roles que no den más permisos de los que él mismo tiene.
    if (valores.id_rol !== undefined) {
      const [r] = await db.query('SELECT permisos FROM roles WHERE id_rol = ?', [valores.id_rol]);
      if (r.length && !esSubconjunto(r[0].permisos, auth.permisos)) {
        return { error: error(403, 'No puedes asignar un rol con más permisos que los tuyos.') };
      }
    }
    if (actual) {
      const [r] = await db.query('SELECT permisos FROM roles WHERE id_rol = ?', [actual.id_rol]);
      if (r.length && !esSubconjunto(r[0].permisos, auth.permisos)) {
        return { error: error(403, 'No puedes modificar a un usuario con más permisos que los tuyos.') };
      }
      if (Number(actual.id) === auth.usuario.id) {
        const cambiaRol = valores.id_rol !== undefined && Number(valores.id_rol) !== Number(actual.id_rol);
        const cambiaEstado = valores.estado !== undefined && String(valores.estado).toLowerCase() !== String(actual.estado).toLowerCase();
        if (cambiaRol || cambiaEstado) return { error: error(403, 'No puedes cambiar tu propio rol ni tu estado.') };
      }
    }

    // Delegaciones: solo las que él tiene autorizadas.
    if (valores.id_delegacion_activa !== undefined && !permitidas.includes(valores.id_delegacion_activa)) {
      return { error: error(403, 'No puedes asignar usuarios a una delegación que no tienes autorizada.') };
    }
    let lista = null;
    if (body.delegaciones !== undefined) {
      if (!Array.isArray(body.delegaciones)) return { error: error(400, 'Las delegaciones autorizadas no son válidas.') };
      lista = [...new Set(body.delegaciones.map(Number))];
      if (lista.some(id => !Number.isInteger(id) || !permitidas.includes(id))) {
        return { error: error(403, 'No puedes autorizar delegaciones que tú no tienes autorizadas.') };
      }
    }

    // Contraseña (obligatoria al crear; opcional al editar)
    const extras = {};
    const pass = body.password;
    if (esNuevo || (pass !== undefined && pass !== null && pass !== '')) {
      if (!clave.validarRequisitos(pass)) {
        return { error: error(400, `La contraseña no cumple los requisitos. ${clave.REQUISITOS}`) };
      }
      extras.password_hash = await clave.hashear(pass);
    }

    return {
      extras,
      despues: async id => {
        const activa = valores.id_delegacion_activa !== undefined ? valores.id_delegacion_activa : actual && actual.id_delegacion_activa;
        if (lista === null && !esNuevo) return;
        const finales = new Set(lista || []);
        if (activa) finales.add(Number(activa));
        if (permitidas.length) {
          await db.query(
            `DELETE FROM usuario_delegaciones WHERE id_usuario = ? AND id_delegacion IN (${permitidas.map(() => '?').join(', ')})`,
            [id, ...permitidas]
          );
        }
        for (const d of finales) {
          if (permitidas.includes(d)) await db.query('INSERT INTO usuario_delegaciones (id_usuario, id_delegacion) VALUES (?, ?)', [id, d]);
        }
      }
    };
  },

  async roles({ req, valores, actual }) {
    const auth = req.auth;
    if (actual && Number(actual.id) === auth.usuario.rolId) {
      return { error: error(403, 'No puedes modificar el rol que tienes asignado. Pídele a otro administrador que lo haga.') };
    }
    if (actual && !esSubconjunto(actual.permisos, auth.permisos)) {
      return { error: error(403, 'No puedes modificar un rol con más permisos que los tuyos.') };
    }
    if (valores.permisos !== undefined && !esSubconjunto(valores.permisos, auth.permisos)) {
      return { error: error(403, 'No puedes otorgar permisos que tú no tienes.') };
    }
    if (valores.alcance !== undefined && RANGO[claveAlcance(valores.alcance)] > RANGO[auth.alcance]) {
      return { error: error(403, 'No puedes otorgar un alcance mayor al tuyo.') };
    }
    return { extras: valores.permisos !== undefined ? { permisos: JSON.stringify(normalizarPermisos(valores.permisos)) } : {}, omitir: ['permisos'] };
  },

  async atenciones({ req, valores, actual, esNuevo }) {
    // Tipo y sub atención deben estar activos y la sub debe pertenecer al tipo elegido.
    const tipo = valores.id_tipo !== undefined ? valores.id_tipo : actual && actual.id_tipo;
    const sub = valores.id_sub_atencion !== undefined ? valores.id_sub_atencion : actual && actual.id_sub_atencion;
    if (valores.id_tipo !== undefined || valores.id_sub_atencion !== undefined) {
      const [t] = await db.query('SELECT estado FROM tipos_atencion WHERE id_tipo = ?', [tipo]);
      if (!t.length) return { error: error(400, 'El tipo de atención indicado no existe.') };
      if (['inactivo', 'inactiva'].includes(String(t[0].estado).toLowerCase())) return { error: error(400, 'El tipo de atención indicado está inactivo.') };
      const [s] = await db.query('SELECT id_tipo, estado FROM sub_atenciones WHERE id_sub_atencion = ?', [sub]);
      if (!s.length) return { error: error(400, 'La sub atención indicada no existe.') };
      if (['inactivo', 'inactiva'].includes(String(s[0].estado).toLowerCase())) return { error: error(400, 'La sub atención indicada está inactiva.') };
      if (Number(s[0].id_tipo) !== Number(tipo)) return { error: error(400, 'La sub atención no corresponde al tipo de atención elegido.') };
    }
    if (esNuevo) {
      // La delegación y el responsable salen de la sesión, nunca del formulario.
      return {
        extras: {
          id_delegacion: req.auth.delegacion.id,
          id_responsable: req.auth.usuario.id,
          fecha_registro: new Date(),
          identificador_atencion: `TMP-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
        },
        despues: async id => {
          const identificador = `ATC-${new Date().getFullYear()}-${String(id).padStart(6, '0')}`;
          await db.query('UPDATE atenciones_ciudadanas SET identificador_atencion = ? WHERE id_atencion = ?', [identificador, id]);
          return { identificador };
        }
      };
    }
    return {};
  }
};

// ─── Rutas auxiliares para los formularios ───────────────────────────────────
router.get('/lookup/config', authRequired, (req, res) => {
  res.json({ status: 'success', modulos: MODULOS, plantillas: Object.keys(MODULOS_PLANTILLA), acciones: ACCIONES, alcances: ALCANCES });
});

router.get('/lookup/roles', authRequired, requirePermiso([['usuarios', 'crear'], ['usuarios', 'editar'], ['roles', 'ver']]), async (req, res) => {
  try {
    const [filas] = await db.query("SELECT id_rol AS id, codigo, nombre, permisos FROM roles WHERE LOWER(estado) NOT IN ('inactivo', 'inactiva') ORDER BY nombre");
    // Solo se ofrecen los roles que el usuario puede asignar (no dan más permisos que los suyos).
    const asignables = filas.filter(r => esSubconjunto(r.permisos, req.auth.permisos)).map(({ id, codigo, nombre }) => ({ id, codigo, nombre }));
    res.json({ status: 'success', data: asignables });
  } catch (err) { console.error(err); res.status(500).json({ status: 'error', message: 'Error al consultar los roles.' }); }
});

const VER_CATALOGOS = [['atenciones', 'crear'], ['atenciones', 'editar'], ['atenciones', 'ver'], ['sub-atenciones', 'crear'], ['sub-atenciones', 'editar']];

router.get('/lookup/tipos', authRequired, requirePermiso(VER_CATALOGOS), async (req, res) => {
  try {
    const [filas] = await db.query("SELECT id_tipo AS id, codigo, nombre FROM tipos_atencion WHERE LOWER(estado) NOT IN ('inactivo', 'inactiva') ORDER BY nombre");
    res.json({ status: 'success', data: filas });
  } catch (err) { console.error(err); res.status(500).json({ status: 'error', message: 'Error al consultar los tipos de atención.' }); }
});

// Solo sub atenciones activas del tipo elegido.
router.get('/lookup/subatenciones', authRequired, requirePermiso(VER_CATALOGOS), async (req, res) => {
  const tipo = idValido(req.query.tipo);
  if (!tipo) return res.json({ status: 'success', data: [] });
  try {
    const [filas] = await db.query(
      "SELECT id_sub_atencion AS id, codigo, nombre FROM sub_atenciones WHERE id_tipo = ? AND LOWER(estado) NOT IN ('inactivo', 'inactiva') ORDER BY nombre", [tipo]
    );
    res.json({ status: 'success', data: filas });
  } catch (err) { console.error(err); res.status(500).json({ status: 'error', message: 'Error al consultar las sub atenciones.' }); }
});

// ─── Mantenedores ────────────────────────────────────────────────────────────
function manejarErrorBd(err, res, mensajeGeneral) {
  if (err && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062)) {
    return res.status(409).json({ status: 'error', message: 'Ya existe un registro con esos datos.' });
  }
  if (err && (err.code === 'ER_ROW_IS_REFERENCED_2' || err.errno === 1451)) {
    return res.status(409).json({ status: 'error', message: 'El registro está en uso. Puedes desactivarlo en lugar de eliminarlo.' });
  }
  if (err && (err.code === 'ER_NO_REFERENCED_ROW_2' || err.errno === 1452)) {
    return res.status(400).json({ status: 'error', message: 'Alguno de los datos relacionados no existe.' });
  }
  console.error(err);
  return res.status(500).json({ status: 'error', message: mensajeGeneral });
}

modulosValidos.forEach(modulo => {
  const cfg = MODULOS_API[modulo];

  // GET: listado con búsqueda parcial, filtros, paginación y alcance por delegación
  router.get(`/${modulo}`, authRequired, requirePermiso(modulo, 'ver'), async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
      const f = construirFiltro(modulo, req, true);
      if (f.error) return responderError(res, f.error);

      const [conteo] = await db.query(`SELECT COUNT(*) AS total FROM ${cfg.from} ${sqlWhere(f.where)}`, f.params);
      const total = Number(conteo[0].total);
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const pagina = Math.min(page, totalPages);
      const [filas] = await db.query(
        `SELECT ${cfg.select} FROM ${cfg.from} ${sqlWhere(f.where)} ORDER BY ${cfg.orden} LIMIT ? OFFSET ?`,
        [...f.params, limit, (pagina - 1) * limit]
      );
      res.json({ status: 'success', data: filas.map(r => postProceso(modulo, r)), pagination: { total, page: pagina, limit, totalPages } });
    } catch (err) {
      manejarErrorBd(err, res, 'Error al consultar la base de datos.');
    }
  });

  // GET /export: Excel con todo lo autorizado según el filtro aplicado (todas las páginas).
  // Va ANTES de /:id para que "export" no se interprete como un identificador.
  router.get(`/${modulo}/export`, authRequired, requirePermiso(modulo, 'exportar'), async (req, res) => {
    try {
      const f = construirFiltro(modulo, req, true);
      if (f.error) return responderError(res, f.error);
      const [filas] = await db.query(
        `SELECT ${cfg.select} FROM ${cfg.from} ${sqlWhere(f.where)} ORDER BY ${cfg.orden} LIMIT 50000`, f.params
      );
      if (!filas.length) {
        return res.status(404).json({ status: 'error', message: 'No hay datos para exportar con los filtros aplicados.' });
      }
      const limpias = filas.map(r => postProceso(modulo, r));
      const encabezados = cfg.exportar.map(([, titulo]) => titulo);
      const datos = limpias.map(r => cfg.exportar.map(([k]) => r[k]));
      const archivo = `${modulo}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${archivo}"`);
      res.status(200).send(crearXlsx(cfg.etiqueta, encabezados, datos));
    } catch (err) {
      manejarErrorBd(err, res, 'Error al exportar los datos.');
    }
  });

  // GET /:id: detalle (solo registros dentro del alcance del usuario)
  router.get(`/${modulo}/:id`, authRequired, requirePermiso(modulo, 'ver'), async (req, res) => {
    try {
      const id = idValido(req.params.id);
      if (!id) return res.status(404).json({ status: 'error', message: 'Registro no encontrado.' });
      const r = await buscarPorId(modulo, id, req);
      if (r.error) return responderError(res, r.error);
      if (!r.fila) return res.status(404).json({ status: 'error', message: 'Registro no encontrado.' });
      const dato = postProceso(modulo, r.fila);
      if (modulo === 'usuarios') {
        const [d] = await db.query('SELECT id_delegacion FROM usuario_delegaciones WHERE id_usuario = ?', [id]);
        const visibles = new Set(req.auth.delegaciones.map(x => x.id));
        dato.delegaciones = d.map(x => Number(x.id_delegacion)).filter(x => visibles.has(x));
      }
      res.json({ status: 'success', data: dato });
    } catch (err) {
      manejarErrorBd(err, res, 'Error al obtener el detalle.');
    }
  });

  // POST: crear
  router.post(`/${modulo}`, authRequired, requirePermiso(modulo, 'crear'), async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if (modulo === 'atenciones') {
        const sc = alcance('atenciones', req.auth);
        if (sc.error) return responderError(res, sc.error);
      }
      const { valores, errores } = validarCampos(cfg.campos, body);
      if (errores.length) return res.status(400).json({ status: 'error', message: errores.join(' '), errores });

      const problemas = await revisarIntegridad(cfg, valores, null);
      if (problemas.length) return responderError(res, problemas[0]);

      const regla = reglas[modulo] ? await reglas[modulo]({ req, body, valores, actual: null, esNuevo: true }) : {};
      if (regla.error) return responderError(res, regla.error);

      const datos = { ...valores, ...(regla.extras || {}) };
      (regla.omitir || []).forEach(k => { if (!(regla.extras && k in regla.extras)) delete datos[k]; });
      const columnas = Object.keys(datos);
      const [resultado] = await db.query(
        `INSERT INTO ${cfg.tabla} (${columnas.join(', ')}) VALUES (${columnas.map(() => '?').join(', ')})`,
        columnas.map(c => datos[c])
      );
      const id = resultado.insertId;
      const extra = regla.despues ? await regla.despues(id) : null;
      res.status(201).json({ status: 'success', message: 'Registro creado con éxito.', id, ...(extra || {}) });
    } catch (err) {
      manejarErrorBd(err, res, 'Error al guardar en la base de datos.');
    }
  });

  // PUT: editar (solo los campos enviados)
  router.put(`/${modulo}/:id`, authRequired, requirePermiso(modulo, 'editar'), async (req, res) => {
    try {
      const id = idValido(req.params.id);
      if (!id) return res.status(404).json({ status: 'error', message: 'Registro no encontrado.' });
      const r = await buscarPorId(modulo, id, req);
      if (r.error) return responderError(res, r.error);
      if (!r.fila) return res.status(404).json({ status: 'error', message: 'Registro no encontrado.' });

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { valores, errores } = validarCampos(cfg.campos, body, { parcial: true });
      if (errores.length) return res.status(400).json({ status: 'error', message: errores.join(' '), errores });

      const problemas = await revisarIntegridad(cfg, valores, id);
      if (problemas.length) return responderError(res, problemas[0]);

      const regla = reglas[modulo] ? await reglas[modulo]({ req, body, valores, actual: r.fila, esNuevo: false }) : {};
      if (regla.error) return responderError(res, regla.error);

      const datos = { ...valores, ...(regla.extras || {}) };
      (regla.omitir || []).forEach(k => { if (!(regla.extras && k in regla.extras)) delete datos[k]; });
      // Solo cambia lo permitido: ni delegación ni responsable de una atención se editan.
      const columnas = Object.keys(datos).filter(c => c in valores || (regla.extras && c in regla.extras));
      if (!columnas.length && !(modulo === 'usuarios' && body.delegaciones !== undefined)) {
        return res.status(400).json({ status: 'error', message: 'No se enviaron campos para actualizar.' });
      }
      if (columnas.length) {
        await db.query(
          `UPDATE ${cfg.tabla} SET ${columnas.map(c => `${c} = ?`).join(', ')} WHERE ${cfg.pk} = ?`,
          [...columnas.map(c => datos[c]), id]
        );
      }
      if (regla.despues) await regla.despues(id);
      res.json({ status: 'success', message: 'Registro actualizado con éxito.' });
    } catch (err) {
      manejarErrorBd(err, res, 'Error al actualizar el registro.');
    }
  });

  // DELETE: eliminar solo si no tiene relaciones; si las tiene se sugiere desactivar
  router.delete(`/${modulo}/:id`, authRequired, requirePermiso(modulo, 'eliminar'), async (req, res) => {
    try {
      const id = idValido(req.params.id);
      if (!id) return res.status(404).json({ status: 'error', message: 'Registro no encontrado.' });
      const r = await buscarPorId(modulo, id, req);
      if (r.error) return responderError(res, r.error);
      if (!r.fila) return res.status(404).json({ status: 'error', message: 'Registro no encontrado.' });

      if (modulo === 'usuarios' && id === req.auth.usuario.id) {
        return res.status(403).json({ status: 'error', message: 'No puedes eliminar tu propia cuenta.' });
      }
      if (modulo === 'roles' && id === req.auth.usuario.rolId) {
        return res.status(403).json({ status: 'error', message: 'No puedes eliminar el rol que tienes asignado.' });
      }
      if ((modulo === 'usuarios' || modulo === 'roles') && !esSubconjunto(
        modulo === 'roles' ? r.fila.permisos : (await db.query('SELECT permisos FROM roles WHERE id_rol = ?', [r.fila.id_rol]))[0][0]?.permisos, req.auth.permisos)) {
        return res.status(403).json({ status: 'error', message: 'No puedes eliminar a alguien (o un rol) con más permisos que los tuyos.' });
      }

      for (const ref of cfg.referencias) {
        const [c] = await db.query(`SELECT COUNT(*) AS n FROM ${ref.tabla} WHERE ${ref.col} = ?`, [id]);
        if (Number(c[0].n) > 0) {
          return res.status(409).json({
            status: 'error',
            message: `No se puede eliminar porque tiene ${ref.texto} asociados.${cfg.estados ? ' Puedes desactivarlo cambiando su estado.' : ''}`,
            puedeDesactivar: !!cfg.estados
          });
        }
      }

      await db.query(`DELETE FROM ${cfg.tabla} WHERE ${cfg.pk} = ?`, [id]);
      res.json({ status: 'success', message: 'Registro eliminado correctamente.' });
    } catch (err) {
      manejarErrorBd(err, res, 'Error al eliminar el registro.');
    }
  });
});

module.exports = router;
