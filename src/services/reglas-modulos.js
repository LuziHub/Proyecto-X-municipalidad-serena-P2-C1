'use strict';

// Reglas de negocio propias de los módulos de la matriz. crud.js las usa igual que las de usuarios/roles/atenciones:
//   cada regla devuelve { error } para rechazar, o { extras, despues } para completar el guardado.
//   eliminar[modulo](req, fila) devuelve { error } si no se puede borrar.

const db = require('../config/db');
const { puede, ROL_DELEGADO } = require('../config/permisos');
const { hoyChile, aFechaTexto, diasEntre } = require('../utils/fechas');
const { evaluarPuntaje, validarFechaIngreso, validarTopeDiario } = require('../utils/reglas');
const { periodoDe } = require('./matriz');

const error = (status, message) => ({ status, message });
const pad = n => String(n).padStart(5, '0');
const temporal = () => `TMP-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
const veEquipo = auth => puede(auth.permisos, 'equipo', 'ver');

// ¿La persona pertenece (activa) a la delegación?
async function perteneceA(idUsuario, idDelegacion) {
  const [f] = await db.query(
    `SELECT u.id_usuario FROM usuarios u
      WHERE u.id_usuario = ? AND LOWER(u.estado) = 'activo'
        AND (u.id_delegacion_activa = ? OR u.id_usuario IN (SELECT ud.id_usuario FROM usuario_delegaciones ud WHERE ud.id_delegacion = ?))`,
    [idUsuario, idDelegacion, idDelegacion]
  );
  return f.length > 0;
}

const reglas = {
  // ── Registro de gestiones: reglas 1, 2, 3, 4 y 5 ────────────────────────────
  async gestiones({ req, valores, actual, esNuevo }) {
    const auth = req.auth;
    const hoy = hoyChile();
    const dato = k => (valores[k] !== undefined ? valores[k] : (actual ? actual[k] : null));

    // Responsable: en el alta, quien tiene la sesión; al editar, el dueño de la gestión.
    const idResp = esNuevo ? auth.usuario.id : Number(actual.id_responsable);
    if (!esNuevo && idResp !== auth.usuario.id && !veEquipo(auth)) return { error: error(403, 'Solo puedes modificar tus propias gestiones.') };
    const idDelegacion = esNuevo ? auth.delegacion.id : Number(actual.id_delegacion);

    const fecha = valores.fecha_gestion || aFechaTexto(actual.fecha_gestion);
    const periodo = await periodoDe(fecha);
    if (!periodo) return { error: error(409, 'No hay un período activo que incluya esa fecha. Pídele a la Coordinación que lo cree.') };

    // Regla 4: cierre semanal. Al editar también cuenta la fecha original (no se altera una semana cerrada).
    const f = validarFechaIngreso({ fecha, hoy, cierreDia: periodo.cierre_dia_semana, periodo });
    if (!f.ok) return { error: error(409, f.mensaje) };
    if (!esNuevo && !validarFechaIngreso({ fecha: aFechaTexto(actual.fecha_gestion), hoy, cierreDia: periodo.cierre_dia_semana }).ok) {
      return { error: error(409, 'Esa gestión pertenece a una semana ya cerrada y no se puede modificar (regla 4).') };
    }

    // El ítem debe ser una meta del cargo del responsable en este período.
    const [u] = await db.query('SELECT id_rol FROM usuarios WHERE id_usuario = ?', [idResp]);
    const idItem = Number(dato('id_item'));
    const [m] = await db.query(
      "SELECT calculo, requiere_contacto FROM metas_cargo WHERE id_periodo = ? AND id_rol = ? AND id_item = ? AND calculo IN ('conteo', 'emergencia') LIMIT 1",
      [periodo.id, u[0].id_rol, idItem]
    );
    if (!m.length) return { error: error(400, 'Ese ítem no corresponde a las metas del cargo en este período.') };

    // Regla 3: tope diario (las emergencias no cuentan).
    if (m[0].calculo !== 'emergencia') {
      const [c] = await db.query(
        `SELECT COUNT(*) AS n FROM gestiones
          WHERE id_responsable = ? AND fecha_gestion = ?${esNuevo ? '' : ' AND id_gestion <> ?'}
            AND id_item NOT IN (SELECT id_item FROM metas_cargo WHERE id_periodo = ? AND id_rol = ? AND calculo = 'emergencia')`,
        [idResp, fecha, ...(esNuevo ? [] : [actual.id]), periodo.id, u[0].id_rol]
      );
      const t = validarTopeDiario({ yaIngresadas: Number(c[0].n), maximo: periodo.max_gestiones_dia });
      if (!t.ok) return { error: error(409, t.mensaje) };
    }

    // Reglas 1, 2 y 5: ¿puntúa?
    const [dels] = await db.query(
      `SELECT u.nombre FROM usuarios u JOIN roles r ON r.id_rol = u.id_rol
        WHERE r.nombre = ? AND (u.id_delegacion_activa = ? OR u.id_usuario IN (SELECT ud.id_usuario FROM usuario_delegaciones ud WHERE ud.id_delegacion = ?))`,
      [ROL_DELEGADO, idDelegacion, idDelegacion]
    );
    const ev = evaluarPuntaje({
      usuarioEsDelegado: !!Number(dato('usuario_es_delegado')), esCoordinacion: !!Number(dato('es_coordinacion')),
      contactoNombre: dato('contacto_nombre'), contactoTelefono: dato('contacto_telefono'),
      requiereContacto: !!Number(m[0].requiere_contacto), nombresDelegados: dels.map(d => d.nombre)
    });

    const extras = { puntua: ev.puntua ? 1 : 0, motivo_no_puntua: ev.motivo };
    if (esNuevo) Object.assign(extras, { id_delegacion: idDelegacion, id_responsable: idResp, unidades: 1, codigo: temporal() });

    return {
      extras,
      despues: async id => {
        let codigo = actual ? actual.codigo : null;
        let codigoArea = actual ? actual.codigo_area : null;
        if (esNuevo) {
          // Código de la matriz: área + mes + día + número correlativo del funcionario en el período (ej. APA711).
          // Las gestiones del Gestor Social llevan prefijo SOC- en vez de GES-.
          const [rol] = await db.query('SELECT r.codigo FROM usuarios u JOIN roles r ON r.id_rol = u.id_rol WHERE u.id_usuario = ?', [idResp]);
          const [n] = await db.query(
            'SELECT COUNT(*) AS n FROM gestiones WHERE id_responsable = ? AND fecha_gestion >= ? AND fecha_gestion <= ? AND id_gestion <= ?',
            [idResp, periodo.fecha_inicio, periodo.fecha_fin, id]
          );
          const [, mes, dia] = fecha.split('-').map(Number);
          const area = rol[0] ? String(rol[0].codigo) : 'GES';
          codigoArea = `${area}${mes}${dia}${Number(n[0].n)}`;
          codigo = `${area === 'GSOC' ? 'SOC' : 'GES'}-${pad(id)}`;
          await db.query('UPDATE gestiones SET codigo = ?, codigo_area = ? WHERE id_gestion = ?', [codigo, codigoArea, id]);
        }
        let tubo = null;
        if (Number(dato('ingreso_tubo'))) {
          const [ya] = await db.query('SELECT codigo FROM tubo WHERE id_gestion = ?', [id]);
          if (ya.length) tubo = ya[0].codigo;
          else {
            const [r] = await db.query(
              `INSERT INTO tubo (codigo, id_gestion, titulo, solicitante, ambito, estado, fecha_solicitud, id_delegacion, id_responsable)
               VALUES (?, ?, ?, ?, 'INT', 'Ingresado', ?, ?, ?)`,
              [temporal(), id, dato('actividad'), dato('contacto_nombre') || 'Sin identificar', fecha, idDelegacion, idResp]
            );
            tubo = `TUB-${pad(r.insertId)}`;
            await db.query('UPDATE tubo SET codigo = ? WHERE id_tubo = ?', [tubo, r.insertId]);
          }
        }
        return { codigo, codigo_area: codigoArea, puntua: ev.puntua, aviso: ev.motivo, tubo };
      }
    };
  },

  // ── Tubo de trabajo ─────────────────────────────────────────────────────────
  async tubo({ req, valores, actual, esNuevo }) {
    const auth = req.auth;
    // Si el solicitante viene del catálogo y no se indicó territorio, se toma el de la organización.
    const territorio = {};
    if (valores.id_organizacion && !valores.territorio) {
      const [o] = await db.query('SELECT territorio FROM organizaciones WHERE id_organizacion = ?', [valores.id_organizacion]);
      if (o[0] && o[0].territorio) territorio.territorio = o[0].territorio;
    }
    if (esNuevo) {
      return {
        extras: { codigo: temporal(), estado: 'Ingresado', fecha_solicitud: hoyChile(), id_delegacion: auth.delegacion.id, id_responsable: auth.usuario.id, ...territorio },
        despues: async id => {
          const codigo = `TUB-${pad(id)}`;
          await db.query('UPDATE tubo SET codigo = ? WHERE id_tubo = ?', [codigo, id]);
          return { codigo };
        }
      };
    }
    if (actual.estado === 'Realizado') return { error: error(409, 'Una gestión realizada ya no se edita.') };
    if (Number(actual.id_responsable) !== auth.usuario.id && !veEquipo(auth)) return { error: error(403, 'Solo puedes modificar tus propias gestiones del tubo.') };
    return Object.keys(territorio).length ? { extras: territorio } : {};
  },

  // ── Tubo de cartas de Oficina de Partes ─────────────────────────────────────
  async cartas({ req, valores, actual, esNuevo }) {
    const auth = req.auth;
    if (valores.fecha && valores.fecha > hoyChile()) return { error: error(400, 'La fecha de la carta no puede ser futura.') };
    if (esNuevo) {
      return {
        extras: { codigo: temporal(), id_delegacion: auth.delegacion.id, id_responsable: auth.usuario.id },
        despues: async id => {
          const codigo = `CAR-${pad(id)}`;
          await db.query('UPDATE cartas SET codigo = ? WHERE id_carta = ?', [codigo, id]);
          return { codigo };
        }
      };
    }
    if (Number(actual.id_responsable) !== auth.usuario.id && !veEquipo(auth)) return { error: error(403, 'Solo puedes modificar las cartas que tú registraste.') };
    return {};
  },

  // ── Felicitaciones y reclamos: regla 8 ──────────────────────────────────────
  async valoraciones({ req, valores, actual, esNuevo }) {
    const auth = req.auth;
    if (!esNuevo) {
      const cambia = ['tipo', 'id_funcionario', 'fecha'].some(k => valores[k] !== undefined &&
        String(valores[k]) !== String(k === 'fecha' ? aFechaTexto(actual[k]) : actual[k]));
      if (cambia) return { error: error(400, 'No se puede cambiar el tipo, el funcionario ni la fecha: elimina el registro y vuelve a ingresarlo.') };
      return {};
    }
    if (valores.id_funcionario === auth.usuario.id) return { error: error(403, 'No puedes registrarte una felicitación o un reclamo a ti mismo (regla 8).') };
    if (!(await perteneceA(valores.id_funcionario, auth.delegacion.id))) return { error: error(400, 'El funcionario indicado no pertenece a esta delegación.') };
    if (valores.fecha > hoyChile()) return { error: error(400, 'La fecha no puede ser futura.') };
    const periodo = await periodoDe(valores.fecha);
    if (!periodo) return { error: error(409, 'No hay un período activo que incluya esa fecha.') };
    return { extras: { id_delegacion: auth.delegacion.id, id_periodo: periodo.id, registrado_por: auth.usuario.id } };
  },

  // ── Licencias, vacaciones y días administrativos: regla 9 ───────────────────
  async ausencias({ req, valores, actual, esNuevo }) {
    const auth = req.auth;
    const dato = k => (valores[k] !== undefined ? valores[k] : (actual ? (k.startsWith('fecha') ? aFechaTexto(actual[k]) : actual[k]) : null));
    if (!esNuevo && valores.id_usuario !== undefined && Number(valores.id_usuario) !== Number(actual.id_usuario)) {
      return { error: error(400, 'No se puede cambiar el funcionario: elimina la ausencia y vuelve a ingresarla.') };
    }
    const desde = dato('fecha_desde'), hasta = dato('fecha_hasta');
    if (hasta < desde) return { error: error(400, 'La fecha «Hasta» no puede ser anterior a «Desde».') };
    if (diasEntre(desde, hasta) > 366) return { error: error(400, 'La ausencia no puede superar un año.') };
    if (esNuevo) {
      if (!(await perteneceA(valores.id_usuario, auth.delegacion.id))) return { error: error(400, 'El funcionario indicado no pertenece a esta delegación.') };
      return { extras: { id_delegacion: auth.delegacion.id, registrado_por: auth.usuario.id } };
    }
    return {};
  },

  // ── Metas por cargo ─────────────────────────────────────────────────────────
  async 'metas-cargo'({ valores, actual, esNuevo }) {
    const dato = k => (valores[k] !== undefined ? valores[k] : (actual ? actual[k] : null));
    const [dup] = await db.query(
      `SELECT id_meta FROM metas_cargo WHERE id_periodo = ? AND id_rol = ? AND id_item = ?${esNuevo ? '' : ' AND id_meta <> ?'} LIMIT 1`,
      [dato('id_periodo'), dato('id_rol'), dato('id_item'), ...(esNuevo ? [] : [actual.id])]
    );
    if (dup.length) return { error: error(409, 'Ya existe una meta para ese cargo, período e ítem.') };
    const calculo = dato('calculo') || 'conteo';
    const pond = Number(dato('ponderador')), meta = Number(dato('meta'));
    if (calculo === 'reclamo' && pond > 0) return { error: error(400, 'El ponderador de un reclamo debe ser negativo.') };
    if (calculo !== 'reclamo' && pond < 0) return { error: error(400, 'Solo los reclamos llevan ponderador negativo.') };
    if (calculo === 'tubo' && meta > 1) return { error: error(400, 'Para el cálculo «tubo» la meta es una proporción entre 0 y 1 (por ejemplo 0,8 = 80 %).') };
    return {};
  },

  // ── Períodos ────────────────────────────────────────────────────────────────
  async periodos({ valores, actual, esNuevo }) {
    const dato = k => (valores[k] !== undefined ? valores[k] : (actual ? (k.startsWith('fecha') ? aFechaTexto(actual[k]) : actual[k]) : null));
    const inicio = dato('fecha_inicio'), fin = dato('fecha_fin');
    if (fin <= inicio) return { error: error(400, 'El término del período debe ser posterior al inicio.') };
    if (String(dato('estado') || 'Activo').toLowerCase() === 'activo') {
      const [s] = await db.query(
        `SELECT nombre FROM periodos WHERE LOWER(estado) = 'activo' AND fecha_inicio <= ? AND fecha_fin >= ?${esNuevo ? '' : ' AND id_periodo <> ?'} LIMIT 1`,
        [fin, inicio, ...(esNuevo ? [] : [actual.id])]
      );
      if (s.length) return { error: error(409, `Las fechas se superponen con el período activo «${s[0].nombre}».`) };
    }
    return {};
  }
};

// ── Antes de eliminar ──────────────────────────────────────────────────────────
const eliminar = {
  // Regla 4 también para borrar: no se puede quitar una gestión de una semana cerrada.
  async gestiones(req, fila) {
    if (Number(fila.id_responsable) !== req.auth.usuario.id && !veEquipo(req.auth)) return error(403, 'Solo puedes eliminar tus propias gestiones.');
    const fecha = aFechaTexto(fila.fecha_gestion);
    const periodo = await periodoDe(fecha);
    const cierre = periodo ? periodo.cierre_dia_semana : 2;
    if (!validarFechaIngreso({ fecha, hoy: hoyChile(), cierreDia: cierre }).ok) return error(409, 'Esa gestión pertenece a una semana ya cerrada y no se puede eliminar (regla 4).');
    return null;
  }
};

module.exports = { reglas, eliminar, perteneceA };
