'use strict';

// Rutas propias de la matriz: tablero del tubo, cambio de estado, semáforo y listas auxiliares.
// Se monta ANTES de crud.js para que /tubo/tablero no se confunda con /tubo/:id.

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authRequired, requirePermiso } = require('../middleware/auth');
const { MODULOS_API, TRANSICIONES_TUBO, ESTADOS_TUBO } = require('../config/modulos');
const { puede } = require('../config/permisos');
const { alcance } = require('../utils/delegaciones');
const { hoyChile, aFechaTexto } = require('../utils/fechas');
const { ventanaIngreso } = require('../utils/reglas');
const { crearXlsx } = require('../utils/xlsx');
const { periodoDe, calcularDe, equipoDe } = require('../services/matriz');

const FALLA = { status: 'error', message: 'Error del servidor.' };
const falla = (res, err, msg) => { console.error(err); res.status(500).json({ ...FALLA, message: msg }); };
const idValido = v => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const veEquipo = auth => puede(auth.permisos, 'equipo', 'ver');
const fechasTexto = f => ({ ...f, fecha_solicitud: aFechaTexto(f.fecha_solicitud), fecha_compromiso: aFechaTexto(f.fecha_compromiso), fecha_realizado: aFechaTexto(f.fecha_realizado) });

// ─── Listas auxiliares para los formularios ──────────────────────────────────
// Ítems que el usuario puede registrar (las metas de su cargo en el período vigente) y la ventana de fechas permitida.
router.get('/lookup/items-mios', authRequired, requirePermiso([['gestiones', 'crear'], ['gestiones', 'editar']]), async (req, res) => {
  try {
    const hoy = hoyChile();
    const periodo = await periodoDe(hoy);
    if (!periodo) return res.json({ status: 'success', data: [], periodo: null, hoy });
    const [filas] = await db.query(
      `SELECT m.id_item AS id, i.codigo, i.nombre, m.calculo, m.requiere_contacto
         FROM metas_cargo m JOIN items_metas i ON i.id_item = m.id_item
        WHERE m.id_periodo = ? AND m.id_rol = ? AND m.calculo IN ('conteo', 'emergencia') AND LOWER(i.estado) = 'activo'
        ORDER BY m.id_meta`, [periodo.id, req.auth.usuario.rolId]
    );
    const v = ventanaIngreso(hoy, periodo.cierre_dia_semana);
    res.json({
      status: 'success', hoy,
      data: filas.map(f => ({ ...f, id: Number(f.id), requiere_contacto: Number(f.requiere_contacto) === 1 })),
      periodo: { id: periodo.id, nombre: periodo.nombre, fecha_inicio: periodo.fecha_inicio, fecha_fin: periodo.fecha_fin, max_gestiones_dia: periodo.max_gestiones_dia, cierre_dia_semana: periodo.cierre_dia_semana },
      ventana: { desde: v.desde < periodo.fecha_inicio ? periodo.fecha_inicio : v.desde, hasta: hoy < periodo.fecha_fin ? hoy : periodo.fecha_fin }
    });
  } catch (err) { falla(res, err, 'Error al consultar los ítems.'); }
});

router.get('/lookup/funcionarios', authRequired, requirePermiso([['valoraciones', 'crear'], ['valoraciones', 'editar'], ['ausencias', 'crear'], ['ausencias', 'editar']]), async (req, res) => {
  try {
    if (!req.auth.delegacion) return res.json({ status: 'success', data: [] });
    const { personalDe } = require('../services/matriz');
    const gente = await personalDe(req.auth.delegacion.id);
    res.json({ status: 'success', data: gente.filter(p => p.id !== req.auth.usuario.id).map(p => ({ id: p.id, nombre: `${p.nombre} · ${p.rol}` })) });
  } catch (err) { falla(res, err, 'Error al consultar el personal.'); }
});

const PUEDE_METAS = [['metas-cargo', 'crear'], ['metas-cargo', 'editar']];
router.get('/lookup/periodos', authRequired, requirePermiso(PUEDE_METAS), async (req, res) => {
  try {
    const [f] = await db.query("SELECT id_periodo AS id, nombre FROM periodos WHERE LOWER(estado) = 'activo' ORDER BY fecha_inicio DESC");
    res.json({ status: 'success', data: f });
  } catch (err) { falla(res, err, 'Error al consultar los períodos.'); }
});
router.get('/lookup/cargos', authRequired, requirePermiso(PUEDE_METAS), async (req, res) => {
  try {
    const [f] = await db.query("SELECT id_rol AS id, nombre FROM roles WHERE LOWER(estado) = 'activo' ORDER BY nombre");
    res.json({ status: 'success', data: f });
  } catch (err) { falla(res, err, 'Error al consultar los cargos.'); }
});
router.get('/lookup/items', authRequired, requirePermiso(PUEDE_METAS), async (req, res) => {
  try {
    const [f] = await db.query("SELECT id_item AS id, nombre FROM items_metas WHERE LOWER(estado) = 'activo' ORDER BY nombre");
    res.json({ status: 'success', data: f });
  } catch (err) { falla(res, err, 'Error al consultar los ítems.'); }
});

// ─── Tubo de trabajo: tablero y cambio de estado ─────────────────────────────
router.get('/tubo/tablero', authRequired, requirePermiso('tubo', 'ver'), async (req, res) => {
  try {
    const sc = alcance('tubo', req.auth);
    if (sc.error) return res.status(sc.error.status).json({ status: 'error', message: sc.error.message });
    const cfg = MODULOS_API.tubo;
    const where = [sc.where], params = [...sc.params];
    if (req.query.mias === '1') { where.push('t.id_responsable = ?'); params.push(req.auth.usuario.id); }
    const [filas] = await db.query(`SELECT ${cfg.select} FROM ${cfg.from} WHERE ${where.join(' AND ')} ORDER BY t.id_tubo DESC LIMIT 500`, params);

    const columnas = Object.fromEntries(ESTADOS_TUBO.map(e => [e, []]));
    for (const f of filas) {
      const fila = fechasTexto({ ...f, id: Number(f.id) });
      if (columnas[fila.estado]) columnas[fila.estado].push({ ...fila, puedeAvanzar: !!TRANSICIONES_TUBO[fila.estado] && (Number(fila.id_responsable) === req.auth.usuario.id || veEquipo(req.auth)) && puede(req.auth.permisos, 'tubo', 'editar'), siguiente: TRANSICIONES_TUBO[fila.estado] || null });
    }
    const n = e => columnas[e].length;
    const total = filas.length;
    res.json({
      status: 'success', columnas,
      indicadores: { total, realizadas: n('Realizado'), enProceso: n('En proceso'), pendientes: n('Pendiente'), ingresadas: n('Ingresado'), tasaResolucion: total ? Math.round((n('Realizado') / total) * 1000) / 10 : 0 }
    });
  } catch (err) { falla(res, err, 'Error al consultar el tubo.'); }
});

router.put('/tubo/:id/estado', authRequired, requirePermiso('tubo', 'editar'), async (req, res) => {
  try {
    const id = idValido(req.params.id);
    if (!id) return res.status(404).json({ status: 'error', message: 'Registro no encontrado.' });
    const sc = alcance('tubo', req.auth);
    if (sc.error) return res.status(sc.error.status).json({ status: 'error', message: sc.error.message });
    const [f] = await db.query(`SELECT t.* FROM tubo t WHERE t.id_tubo = ? AND ${sc.where} LIMIT 1`, [id, ...sc.params]);
    const fila = f[0];
    if (!fila) return res.status(404).json({ status: 'error', message: 'Registro no encontrado.' });
    if (Number(fila.id_responsable) !== req.auth.usuario.id && !veEquipo(req.auth)) {
      return res.status(403).json({ status: 'error', message: 'Solo puedes cambiar el estado de tus propias gestiones del tubo.' });
    }

    const siguiente = TRANSICIONES_TUBO[fila.estado];
    if (!siguiente) return res.status(409).json({ status: 'error', message: 'Esta gestión ya está realizada.' });
    const pedido = typeof (req.body || {}).estado === 'string' ? req.body.estado.trim().toLowerCase() : '';
    if (pedido !== siguiente.toLowerCase()) {
      return res.status(409).json({ status: 'error', message: `Desde «${fila.estado}» solo se puede pasar a «${siguiente}».` });
    }
    const avance = typeof req.body.avance === 'string' ? req.body.avance.trim() : '';
    if (avance && (avance.length > 2000 || /[<>]/.test(avance))) {
      return res.status(400).json({ status: 'error', message: 'El avance no es válido (máximo 2000 caracteres y sin los símbolos < o >).' });
    }
    const sets = ['estado = ?'], datos = [siguiente];
    if (siguiente === 'Realizado') { sets.push('fecha_realizado = ?'); datos.push(hoyChile()); }
    if (avance) { sets.push('avance = ?'); datos.push(avance); }
    await db.query(`UPDATE tubo SET ${sets.join(', ')} WHERE id_tubo = ?`, [...datos, id]);
    res.json({ status: 'success', message: `Gestión ${fila.codigo} pasó a «${siguiente}».`, estado: siguiente });
  } catch (err) { falla(res, err, 'Error al cambiar el estado.'); }
});

// ─── Puntaje y semáforo ──────────────────────────────────────────────────────
router.get('/semaforo', authRequired, requirePermiso('semaforo', 'ver'), async (req, res) => {
  try {
    const hoy = hoyChile();
    const periodo = await periodoDe(hoy);
    if (!periodo) return res.json({ status: 'success', periodo: null, hoy });
    const [u] = await db.query('SELECT u.id_usuario AS id, u.nombre, u.id_rol, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id_rol = u.id_rol WHERE u.id_usuario = ?', [req.auth.usuario.id]);
    res.json({ status: 'success', hoy, ...(await calcularDe({ ...u[0], id: Number(u[0].id), id_rol: Number(u[0].id_rol) }, periodo, hoy)) });
  } catch (err) { falla(res, err, 'Error al calcular el puntaje.'); }
});

router.get('/semaforo/equipo', authRequired, requirePermiso('equipo', 'ver'), async (req, res) => {
  try {
    if (!req.auth.delegacion) return res.status(403).json({ status: 'error', message: 'Tu cuenta no tiene una delegación autorizada.' });
    const hoy = hoyChile();
    const periodo = await periodoDe(hoy);
    if (!periodo) return res.json({ status: 'success', periodo: null, hoy, filas: [] });
    res.json({ status: 'success', hoy, periodo, ...(await equipoDe(req.auth.delegacion.id, periodo, hoy)) });
  } catch (err) { falla(res, err, 'Error al calcular el puntaje del equipo.'); }
});

router.get('/semaforo/equipo/export', authRequired, requirePermiso('equipo', 'ver'), async (req, res) => {
  try {
    if (!req.auth.delegacion) return res.status(403).json({ status: 'error', message: 'Tu cuenta no tiene una delegación autorizada.' });
    const hoy = hoyChile();
    const periodo = await periodoDe(hoy);
    if (!periodo) return res.status(404).json({ status: 'error', message: 'No hay un período activo para exportar.' });
    const eq = await equipoDe(req.auth.delegacion.id, periodo, hoy);
    if (!eq.filas.length) return res.status(404).json({ status: 'error', message: 'No hay personal con metas para exportar.' });
    const pct = n => `${Math.round(n * 1000) / 10} %`;
    const datos = eq.filas.map(r => [r.usuario.nombre, r.usuario.rol, pct(r.gestion), r.felicitaciones.contadas, r.reclamos.cantidad, pct(r.total), pct(r.objetivo.objetivo), r.semaforo, r.gestiones.total, r.gestiones.ultima || '']);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="equipo_${hoy}.xlsx"`);
    res.status(200).send(crearXlsx('Equipo', ['Funcionario', 'Cargo', 'Gestión ponderada', 'Felicitaciones', 'Reclamos', 'Total', 'Objetivo del día', 'Semáforo', 'Gestiones', 'Última gestión'], datos));
  } catch (err) { falla(res, err, 'Error al exportar el puntaje del equipo.'); }
});

// ─── Catálogo de organizaciones (solicitantes) ───────────────────────────────
// Búsqueda por texto para el autocompletar: no se envían las 2.700 organizaciones de una vez.
router.get('/lookup/organizaciones', authRequired, requirePermiso([['organizaciones', 'ver'], ['tubo', 'crear'], ['tubo', 'editar'], ['cartas', 'crear']]), async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    if (q.length < 2) return res.json({ status: 'success', data: [] });
    const like = `%${q.replace(/[\\%_]/g, m => '\\' + m)}%`;
    const [f] = await db.query(
      "SELECT id_organizacion AS id, nombre, territorio FROM organizaciones WHERE LOWER(estado) = 'activo' AND nombre LIKE ? ESCAPE '\\' ORDER BY nombre LIMIT 15", [like]
    );
    res.json({ status: 'success', data: f.map(o => ({ id: Number(o.id), nombre: o.nombre, territorio: o.territorio })) });
  } catch (err) { falla(res, err, 'Error al buscar organizaciones.'); }
});

// ─── Verificación de la imagen de una gestión (la hace la jefatura, nunca el propio funcionario) ───
router.put('/gestiones/:id/verificar', authRequired, requirePermiso('valoraciones', 'crear'), async (req, res) => {
  try {
    const id = idValido(req.params.id);
    if (!id) return res.status(404).json({ status: 'error', message: 'Registro no encontrado.' });
    const sc = alcance('gestiones', req.auth);
    if (sc.error) return res.status(sc.error.status).json({ status: 'error', message: sc.error.message });
    const [f] = await db.query(`SELECT g.* FROM gestiones g WHERE g.id_gestion = ? AND ${sc.where} LIMIT 1`, [id, ...sc.params]);
    const fila = f[0];
    if (!fila) return res.status(404).json({ status: 'error', message: 'Registro no encontrado.' });
    if (Number(fila.id_responsable) === req.auth.usuario.id) {
      return res.status(403).json({ status: 'error', message: 'No puedes verificar tus propias gestiones.' });
    }
    const v = (req.body || {}).verificada;
    if (![true, false, 1, 0, '1', '0'].includes(v)) return res.status(400).json({ status: 'error', message: 'Indica si la imagen queda verificada (true) o sin verificar (false).' });
    const si = v === true || v === 1 || v === '1';
    await db.query(
      'UPDATE gestiones SET imagen_verificada = ?, verificado_por = ?, fecha_verificacion = ? WHERE id_gestion = ?',
      [si ? 1 : 0, si ? req.auth.usuario.id : null, si ? hoyChile() : null, id]
    );
    res.json({ status: 'success', message: si ? `Gestión ${fila.codigo} verificada.` : `Gestión ${fila.codigo} sin verificar.`, verificada: si });
  } catch (err) { falla(res, err, 'Error al verificar la gestión.'); }
});

// ─── Tubo de cartas: resumen por estado ──────────────────────────────────────
router.get('/cartas/resumen', authRequired, requirePermiso('cartas', 'ver'), async (req, res) => {
  try {
    const sc = alcance('cartas', req.auth);
    if (sc.error) return res.status(sc.error.status).json({ status: 'error', message: sc.error.message });
    const [f] = await db.query(`SELECT c.estado, COUNT(*) AS n FROM cartas c WHERE ${sc.where} GROUP BY c.estado`, sc.params);
    const n = e => Number((f.find(x => x.estado === e) || {}).n || 0);
    const r = { enProceso: n('En proceso'), aprobadas: n('Aprobada'), finalizadas: n('Finalizada'), noAplica: n('No aplica') };
    // como en la planilla: el total no cuenta las cartas «No aplica»
    res.json({ status: 'success', resumen: { ...r, total: r.enProceso + r.aprobadas + r.finalizadas, totalIngresadas: r.enProceso + r.aprobadas + r.finalizadas + r.noAplica } });
  } catch (err) { falla(res, err, 'Error al resumir las cartas.'); }
});

module.exports = router;
