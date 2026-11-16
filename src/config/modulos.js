'use strict';

// Definición de los siete módulos sobre el esquema real de sgr_laserena_db.
//   from/select/busqueda  → consulta de listado y detalle (alias fijos por módulo)
//   campos                → lo que se puede crear/editar y cómo se valida
//   referencias           → tablas que impiden eliminar un registro (se sugiere desactivarlo)
//   exportar              → columnas del Excel (nunca contraseñas ni campos internos)

const { ALCANCES } = require('./permisos');

const TEXTO = /^[\p{L}\p{N} .,;:'"()\-_/&#°ºª+]+$/u;
const MSG_TEXTO = 'contiene caracteres no permitidos (no se admiten símbolos como < > { } $ %).';
const CODIGO = /^[A-Za-z0-9_-]+$/;
const MSG_CODIGO = 'solo admite letras, números, guion y guion bajo.';
const PERSONA = /^[\p{L} .'\-]+$/u;

const ACTIVO = ['Activo', 'Inactivo'];
const ESTADOS_TUBO = ['Ingresado', 'Pendiente', 'En proceso', 'Realizado'];
// Cada gestión del tubo avanza un paso a la vez; "Realizado" es final.
const TRANSICIONES_TUBO = { 'Ingresado': 'Pendiente', 'Pendiente': 'En proceso', 'En proceso': 'Realizado' };
const TIPOS_AUSENCIA = ['Licencia', 'Vacaciones', 'Día administrativo', 'Compensatorio', 'Emergencia'];
const CALCULOS = ['conteo', 'emergencia', 'tubo', 'felicitacion', 'reclamo'];
const ACTIVA = ['Activa', 'Inactiva'];
const ESTADOS_CARTA = ['En proceso', 'Aprobada', 'Finalizada', 'No aplica'];
const PRONUNCIAMIENTOS = ['Gabinete', 'Delegado', 'Alcaldesa', 'No aplica'];

const codigo = (max = 10) => ({ col: 'codigo', etiqueta: 'Código', tipo: 'texto', req: true, max, patron: CODIGO, mensajePatron: `El código ${MSG_CODIGO}`, unico: true });
const nombre = (max = 100) => ({ col: 'nombre', etiqueta: 'Nombre', tipo: 'texto', req: true, min: 2, max, patron: TEXTO, mensajePatron: `El nombre ${MSG_TEXTO}` });
const descripcion = (req) => ({ col: 'descripcion', etiqueta: 'Descripción', tipo: 'texto', req, max: 255, patron: TEXTO, mensajePatron: `La descripción ${MSG_TEXTO}` });
const estado = (opciones, defecto) => ({ col: 'estado', etiqueta: 'Estado', tipo: 'enum', opciones, defecto });

const MODULOS_API = {
  'delegaciones': {
    tabla: 'delegaciones', pk: 'id_delegacion', alias: 'd', etiqueta: 'Delegaciones',
    from: 'delegaciones d',
    select: 'd.id_delegacion AS id, d.codigo, d.nombre, d.direccion, d.comuna, d.estado, d.created_at',
    busqueda: ['d.codigo', 'd.nombre', 'd.direccion', 'd.comuna'],
    estados: ACTIVA, orden: 'd.codigo ASC',
    campos: [codigo(10), nombre(100),
      { col: 'direccion', etiqueta: 'Dirección', tipo: 'texto', req: true, max: 255, patron: TEXTO, mensajePatron: `La dirección ${MSG_TEXTO}` },
      { col: 'comuna', etiqueta: 'Comuna', tipo: 'texto', max: 100, defecto: 'La Serena', patron: TEXTO, mensajePatron: `La comuna ${MSG_TEXTO}` },
      estado(ACTIVA, 'Activa')],
    referencias: [
      { tabla: 'usuarios', col: 'id_delegacion_activa', texto: 'usuarios' },
      { tabla: 'usuario_delegaciones', col: 'id_delegacion', texto: 'usuarios autorizados' },
      { tabla: 'atenciones_ciudadanas', col: 'id_delegacion', texto: 'atenciones' },
      { tabla: 'gestiones', col: 'id_delegacion', texto: 'gestiones' },
      { tabla: 'tubo', col: 'id_delegacion', texto: 'gestiones del tubo' }
    ],
    exportar: [['codigo', 'Código'], ['nombre', 'Nombre'], ['direccion', 'Dirección'], ['comuna', 'Comuna'], ['estado', 'Estado']]
  },

  'roles': {
    tabla: 'roles', pk: 'id_rol', alias: 'r', etiqueta: 'Roles',
    from: 'roles r',
    select: 'r.id_rol AS id, r.codigo, r.nombre, r.descripcion, r.alcance, r.permisos, r.estado, r.created_at',
    busqueda: ['r.codigo', 'r.nombre', 'r.descripcion', 'r.alcance'],
    estados: ACTIVO, orden: 'r.id_rol ASC',
    campos: [codigo(10), { ...nombre(50), unico: true }, descripcion(false),
      { col: 'alcance', etiqueta: 'Alcance', tipo: 'enum', opciones: ALCANCES, defecto: 'Delegación' },
      { col: 'permisos', etiqueta: 'Permisos', tipo: 'json' },
      estado(ACTIVO, 'Activo')],
    referencias: [{ tabla: 'usuarios', col: 'id_rol', texto: 'usuarios' }, { tabla: 'metas_cargo', col: 'id_rol', texto: 'metas por cargo' }],
    exportar: [['codigo', 'Código'], ['nombre', 'Nombre'], ['descripcion', 'Descripción'], ['alcance', 'Alcance'], ['estado', 'Estado']]
  },

  'usuarios': {
    tabla: 'usuarios', pk: 'id_usuario', alias: 'u', etiqueta: 'Usuarios',
    from: 'usuarios u LEFT JOIN roles r ON r.id_rol = u.id_rol LEFT JOIN delegaciones d ON d.id_delegacion = u.id_delegacion_activa',
    select: 'u.id_usuario AS id, u.rut, u.nombre, u.correo, u.id_rol, r.nombre AS rol, u.id_delegacion_activa, d.codigo AS delegacion_codigo, d.nombre AS delegacion, u.estado, u.ultimo_ingreso, u.created_at',
    busqueda: ['u.nombre', 'u.correo', 'u.rut', 'r.nombre', 'd.nombre', 'd.codigo'],
    estados: ACTIVO, orden: 'u.id_usuario DESC',
    campos: [
      { col: 'nombre', etiqueta: 'Nombre', tipo: 'texto', req: true, min: 3, max: 150, patron: PERSONA, mensajePatron: 'El nombre solo admite letras, espacios, punto, apóstrofo y guion.' },
      { col: 'correo', etiqueta: 'Correo', tipo: 'email', req: true, max: 150, unico: true },
      { col: 'rut', etiqueta: 'RUT', tipo: 'rut', unico: true },
      { col: 'id_rol', etiqueta: 'Rol', tipo: 'entero', req: true, fk: { tabla: 'roles', pk: 'id_rol', activo: true, texto: 'El rol' } },
      { col: 'id_delegacion_activa', etiqueta: 'Delegación principal', tipo: 'entero', req: true },
      estado(ACTIVO, 'Activo')],
    referencias: [
      { tabla: 'atenciones_ciudadanas', col: 'id_responsable', texto: 'atenciones registradas' },
      { tabla: 'gestiones', col: 'id_responsable', texto: 'gestiones registradas' },
      { tabla: 'tubo', col: 'id_responsable', texto: 'gestiones del tubo' },
      { tabla: 'valoraciones', col: 'id_funcionario', texto: 'felicitaciones o reclamos' },
      { tabla: 'ausencias', col: 'id_usuario', texto: 'ausencias registradas' }
    ],
    exportar: [['rut', 'RUT'], ['nombre', 'Nombre'], ['correo', 'Correo'], ['rol', 'Rol'], ['delegacion_codigo', 'Delegación'], ['estado', 'Estado'], ['ultimo_ingreso', 'Último ingreso']]
  },

  'items-metas': {
    tabla: 'items_metas', pk: 'id_item', alias: 'i', etiqueta: 'Ítems y metas',
    from: 'items_metas i',
    select: 'i.id_item AS id, i.codigo, i.nombre, i.descripcion, i.estado, i.created_at',
    busqueda: ['i.codigo', 'i.nombre', 'i.descripcion'],
    estados: ACTIVO, orden: 'i.codigo ASC',
    campos: [codigo(10), nombre(100), descripcion(true), estado(ACTIVO, 'Activo')],
    referencias: [{ tabla: 'metas_cargo', col: 'id_item', texto: 'metas por cargo' }, { tabla: 'gestiones', col: 'id_item', texto: 'gestiones' }],
    exportar: [['codigo', 'Código'], ['nombre', 'Nombre'], ['descripcion', 'Descripción'], ['estado', 'Estado']]
  },

  'tipos-atencion': {
    tabla: 'tipos_atencion', pk: 'id_tipo', alias: 't', etiqueta: 'Tipo de Atención',
    from: 'tipos_atencion t',
    select: 't.id_tipo AS id, t.codigo, t.nombre, t.descripcion, t.estado, t.created_at',
    busqueda: ['t.codigo', 't.nombre', 't.descripcion'],
    estados: ACTIVO, orden: 't.codigo ASC',
    campos: [codigo(10), nombre(100), descripcion(true), estado(ACTIVO, 'Activo')],
    referencias: [
      { tabla: 'sub_atenciones', col: 'id_tipo', texto: 'sub atenciones asociadas' },
      { tabla: 'atenciones_ciudadanas', col: 'id_tipo', texto: 'atenciones' }
    ],
    exportar: [['codigo', 'Código'], ['nombre', 'Nombre'], ['descripcion', 'Descripción'], ['estado', 'Estado']]
  },

  'sub-atenciones': {
    tabla: 'sub_atenciones', pk: 'id_sub_atencion', alias: 's', etiqueta: 'Sub Atención',
    from: 'sub_atenciones s JOIN tipos_atencion t ON t.id_tipo = s.id_tipo',
    select: 's.id_sub_atencion AS id, s.codigo, s.nombre, s.id_tipo, t.nombre AS tipo, s.estado, s.created_at',
    busqueda: ['s.codigo', 's.nombre', 't.nombre'],
    estados: ACTIVA, orden: 's.codigo ASC',
    campos: [codigo(10), nombre(100),
      { col: 'id_tipo', etiqueta: 'Tipo de Atención', tipo: 'entero', req: true, fk: { tabla: 'tipos_atencion', pk: 'id_tipo', activo: true, texto: 'El tipo de atención' } },
      estado(ACTIVA, 'Activa')],
    referencias: [{ tabla: 'atenciones_ciudadanas', col: 'id_sub_atencion', texto: 'atenciones' }],
    exportar: [['codigo', 'Código'], ['nombre', 'Nombre'], ['tipo', 'Tipo de Atención'], ['estado', 'Estado']]
  },

  'atenciones': {
    tabla: 'atenciones_ciudadanas', pk: 'id_atencion', alias: 'a', etiqueta: 'Atenciones',
    from: `atenciones_ciudadanas a
      JOIN tipos_atencion t ON t.id_tipo = a.id_tipo
      JOIN sub_atenciones s ON s.id_sub_atencion = a.id_sub_atencion
      JOIN delegaciones d ON d.id_delegacion = a.id_delegacion
      JOIN usuarios u ON u.id_usuario = a.id_responsable`,
    select: `a.id_atencion AS id, a.identificador_atencion, a.solicitante, a.id_tipo, t.nombre AS tipo,
      a.id_sub_atencion, s.nombre AS sub_atencion, a.descripcion, a.id_delegacion, d.codigo AS delegacion_codigo,
      d.nombre AS delegacion, a.id_responsable, u.nombre AS responsable, a.fecha_registro`,
    busqueda: ['a.identificador_atencion', 'a.solicitante', 'a.descripcion', 't.nombre', 's.nombre', 'u.nombre'],
    estados: null, orden: 'a.id_atencion DESC',
    // delegación y responsable salen de la sesión, no del formulario
    campos: [
      { col: 'solicitante', etiqueta: 'Solicitante', tipo: 'texto', req: true, min: 3, max: 150, patron: PERSONA, mensajePatron: 'El solicitante solo admite letras, espacios, punto, apóstrofo y guion.' },
      { col: 'id_tipo', etiqueta: 'Tipo de Atención', tipo: 'entero', req: true },
      { col: 'id_sub_atencion', etiqueta: 'Sub Atención', tipo: 'entero', req: true },
      { col: 'descripcion', etiqueta: 'Descripción', tipo: 'texto', req: true, min: 5, max: 2000, patron: /^[^<>]+$/, mensajePatron: 'La descripción no puede contener los símbolos < o >.' }
    ],
    referencias: [],
    exportar: [['identificador_atencion', 'Identificador'], ['fecha_registro', 'Fecha de registro'], ['solicitante', 'Solicitante'], ['tipo', 'Tipo de Atención'], ['sub_atencion', 'Sub Atención'], ['descripcion', 'Descripción'], ['delegacion_codigo', 'Delegación'], ['responsable', 'Responsable']]
  },
  // ─── Matriz SGR ────────────────────────────────────────────────────────────
  'gestiones': {
    tabla: 'gestiones', pk: 'id_gestion', alias: 'g', etiqueta: 'Registro de gestiones',
    from: `gestiones g
      JOIN items_metas i ON i.id_item = g.id_item
      JOIN delegaciones d ON d.id_delegacion = g.id_delegacion
      JOIN usuarios u ON u.id_usuario = g.id_responsable
      LEFT JOIN usuarios vf ON vf.id_usuario = g.verificado_por`,
    select: `g.id_gestion AS id, g.codigo, g.codigo_area, g.codigo_foto, g.imagen_verificada, g.fecha_verificacion, vf.nombre AS verificador, g.fecha_gestion, g.actividad, g.detalle, g.id_item, i.nombre AS item,
      g.contacto_nombre, g.contacto_telefono, g.usuario_es_delegado, g.es_coordinacion, g.ingreso_tubo,
      g.puntua, g.motivo_no_puntua, g.unidades, g.id_delegacion, d.codigo AS delegacion_codigo,
      g.id_responsable, u.nombre AS responsable, g.created_at`,
    busqueda: ['g.codigo', 'g.actividad', 'g.contacto_nombre', 'i.nombre', 'u.nombre'],
    estados: null, orden: 'g.fecha_gestion DESC, g.id_gestion DESC',
    // delegación y responsable salen de la sesión; "puntúa" lo decide el servidor con las reglas de la matriz
    campos: [
      { col: 'fecha_gestion', etiqueta: 'Fecha de la gestión', tipo: 'fecha', req: true },
      { col: 'actividad', etiqueta: 'Actividad / solicitud', tipo: 'texto', req: true, min: 5, max: 255, patron: /^[^<>]+$/, mensajePatron: 'La actividad no puede contener los símbolos < o >.' },
      { col: 'detalle', etiqueta: 'Detalle', tipo: 'texto', max: 2000, patron: /^[^<>]+$/, mensajePatron: 'El detalle no puede contener los símbolos < o >.' },
      { col: 'id_item', etiqueta: 'Ítem de la matriz', tipo: 'entero', req: true },
      { col: 'contacto_nombre', etiqueta: 'Nombre del usuario', tipo: 'texto', max: 150, patron: TEXTO, mensajePatron: `El nombre del usuario ${MSG_TEXTO}` },
      { col: 'contacto_telefono', etiqueta: 'Teléfono del usuario', tipo: 'telefono' },
      { col: 'usuario_es_delegado', etiqueta: 'El usuario es el delegado', tipo: 'bool', defecto: 0 },
      { col: 'es_coordinacion', etiqueta: 'Es una coordinación previa', tipo: 'bool', defecto: 0 },
      { col: 'ingreso_tubo', etiqueta: 'Ingresar al tubo', tipo: 'bool', defecto: 0 },
      { col: 'codigo_foto', etiqueta: 'Código de la foto / evidencia', tipo: 'texto', max: 60, patron: /^[A-Za-z0-9._ \-]+$/, mensajePatron: 'El código de la foto solo admite letras, números, punto, guion y espacio.' }
    ],
    referencias: [{ tabla: 'tubo', col: 'id_gestion', texto: 'gestiones del tubo' }],
    exportar: [['codigo', 'Código'], ['codigo_area', 'Código matriz'], ['imagen_verificada', 'Imagen verificada'], ['fecha_gestion', 'Fecha'], ['actividad', 'Actividad'], ['item', 'Ítem'], ['contacto_nombre', 'Usuario'], ['contacto_telefono', 'Teléfono'],
      ['puntua', 'Puntúa'], ['motivo_no_puntua', 'Motivo'], ['responsable', 'Responsable'], ['delegacion_codigo', 'Delegación']]
  },

  'tubo': {
    tabla: 'tubo', pk: 'id_tubo', alias: 't', etiqueta: 'Tubo de trabajo',
    from: `tubo t
      JOIN delegaciones d ON d.id_delegacion = t.id_delegacion
      JOIN usuarios u ON u.id_usuario = t.id_responsable
      LEFT JOIN gestiones g ON g.id_gestion = t.id_gestion
      LEFT JOIN organizaciones o ON o.id_organizacion = t.id_organizacion`,
    select: `t.id_tubo AS id, t.codigo, t.id_gestion, g.codigo AS codigo_gestion, t.titulo, t.solicitante, t.id_organizacion, o.nombre AS organizacion, t.territorio, t.ambito, t.area_apoyo,
      t.estado, t.fecha_solicitud, t.fecha_compromiso, t.fecha_realizado, t.avance, t.id_delegacion, d.codigo AS delegacion_codigo,
      t.id_responsable, u.nombre AS responsable, t.created_at`,
    busqueda: ['t.codigo', 'g.codigo', 't.titulo', 't.solicitante', 't.area_apoyo', 'u.nombre'],
    estados: ESTADOS_TUBO, orden: 't.id_tubo DESC',
    // el estado solo cambia con PUT /tubo/:id/estado (Ingresado → Pendiente → En proceso → Realizado)
    campos: [
      { col: 'titulo', etiqueta: 'Actividad / solicitud', tipo: 'texto', req: true, min: 5, max: 255, patron: /^[^<>]+$/, mensajePatron: 'La actividad no puede contener los símbolos < o >.' },
      { col: 'solicitante', etiqueta: 'Solicitante', tipo: 'texto', req: true, min: 3, max: 150, patron: TEXTO, mensajePatron: `El solicitante ${MSG_TEXTO}` },
      { col: 'id_organizacion', etiqueta: 'Organización del catálogo', tipo: 'entero', fk: { tabla: 'organizaciones', pk: 'id_organizacion', activo: true, texto: 'La organización' } },
      { col: 'territorio', etiqueta: 'Territorio', tipo: 'texto', max: 60, patron: TEXTO, mensajePatron: `El territorio ${MSG_TEXTO}` },
      { col: 'ambito', etiqueta: 'Interno o externo', tipo: 'enum', opciones: ['INT', 'EXT'], defecto: 'INT' },
      { col: 'area_apoyo', etiqueta: 'Área o persona de apoyo', tipo: 'texto', max: 150, patron: TEXTO, mensajePatron: `El área de apoyo ${MSG_TEXTO}` },
      { col: 'fecha_compromiso', etiqueta: 'Fecha de compromiso', tipo: 'fecha' },
      { col: 'avance', etiqueta: 'Avance / observaciones', tipo: 'texto', max: 2000, patron: /^[^<>]+$/, mensajePatron: 'El avance no puede contener los símbolos < o >.' }
    ],
    referencias: [],
    exportar: [['codigo', 'Código'], ['codigo_gestion', 'Gestión'], ['titulo', 'Actividad'], ['solicitante', 'Solicitante'], ['territorio', 'Territorio'], ['ambito', 'Int/Ext'], ['area_apoyo', 'Apoyo'],
      ['estado', 'Estado'], ['fecha_solicitud', 'Fecha solicitud'], ['fecha_compromiso', 'Compromiso'], ['fecha_realizado', 'Realizado'], ['responsable', 'Responsable'], ['avance', 'Avance']]
  },

  'valoraciones': {
    tabla: 'valoraciones', pk: 'id_valoracion', alias: 'v', etiqueta: 'Felicitaciones y reclamos',
    from: `valoraciones v
      JOIN usuarios f ON f.id_usuario = v.id_funcionario
      JOIN usuarios r ON r.id_usuario = v.registrado_por
      JOIN delegaciones d ON d.id_delegacion = v.id_delegacion`,
    select: `v.id_valoracion AS id, v.tipo, v.id_funcionario, f.nombre AS funcionario, v.fecha, v.medio, v.detalle, v.respaldo,
      v.id_periodo, v.registrado_por, r.nombre AS registrado_por_nombre, v.id_delegacion, d.codigo AS delegacion_codigo, v.created_at`,
    busqueda: ['f.nombre', 'v.tipo', 'v.detalle', 'v.respaldo', 'v.medio'],
    estados: null, orden: 'v.fecha DESC, v.id_valoracion DESC',
    campos: [
      { col: 'tipo', etiqueta: 'Tipo', tipo: 'enum', opciones: ['Felicitación', 'Reclamo'], req: true },
      { col: 'id_funcionario', etiqueta: 'Funcionario', tipo: 'entero', req: true },
      { col: 'fecha', etiqueta: 'Fecha', tipo: 'fecha', req: true },
      { col: 'medio', etiqueta: 'Medio formal', tipo: 'enum', opciones: ['Correo al delegado', 'WhatsApp al delegado', 'Libro de observaciones', 'Carta'], req: true },
      { col: 'detalle', etiqueta: 'Detalle', tipo: 'texto', req: true, min: 5, max: 2000, patron: /^[^<>]+$/, mensajePatron: 'El detalle no puede contener los símbolos < o >.' },
      { col: 'respaldo', etiqueta: 'Respaldo formal (correo, folio del libro, etc.)', tipo: 'texto', req: true, min: 3, max: 255, patron: TEXTO, mensajePatron: `El respaldo ${MSG_TEXTO}` }
    ],
    referencias: [],
    exportar: [['fecha', 'Fecha'], ['tipo', 'Tipo'], ['funcionario', 'Funcionario'], ['medio', 'Medio'], ['detalle', 'Detalle'], ['respaldo', 'Respaldo'], ['registrado_por_nombre', 'Registrado por']]
  },

  'ausencias': {
    tabla: 'ausencias', pk: 'id_ausencia', alias: 'a', etiqueta: 'Licencias y ausencias',
    from: `ausencias a
      JOIN usuarios f ON f.id_usuario = a.id_usuario
      JOIN delegaciones d ON d.id_delegacion = a.id_delegacion`,
    select: `a.id_ausencia AS id, a.id_usuario, f.nombre AS funcionario, a.tipo, a.fecha_desde, a.fecha_hasta, a.observacion,
      a.id_delegacion, d.codigo AS delegacion_codigo, a.registrado_por, a.created_at`,
    busqueda: ['f.nombre', 'a.tipo', 'a.observacion'],
    estados: null, orden: 'a.fecha_desde DESC, a.id_ausencia DESC',
    campos: [
      { col: 'id_usuario', etiqueta: 'Funcionario', tipo: 'entero', req: true },
      { col: 'tipo', etiqueta: 'Tipo', tipo: 'enum', opciones: TIPOS_AUSENCIA, req: true },
      { col: 'fecha_desde', etiqueta: 'Desde', tipo: 'fecha', req: true },
      { col: 'fecha_hasta', etiqueta: 'Hasta', tipo: 'fecha', req: true },
      { col: 'observacion', etiqueta: 'Observación', tipo: 'texto', max: 255, patron: TEXTO, mensajePatron: `La observación ${MSG_TEXTO}` }
    ],
    referencias: [],
    exportar: [['funcionario', 'Funcionario'], ['tipo', 'Tipo'], ['fecha_desde', 'Desde'], ['fecha_hasta', 'Hasta'], ['observacion', 'Observación'], ['delegacion_codigo', 'Delegación']]
  },

  'metas-cargo': {
    tabla: 'metas_cargo', pk: 'id_meta', alias: 'm', etiqueta: 'Metas por cargo',
    from: `metas_cargo m
      JOIN periodos p ON p.id_periodo = m.id_periodo
      JOIN roles r ON r.id_rol = m.id_rol
      JOIN items_metas i ON i.id_item = m.id_item`,
    select: `m.id_meta AS id, m.id_periodo, p.nombre AS periodo, m.id_rol, r.nombre AS cargo, m.id_item, i.nombre AS item,
      m.ponderador, m.meta, m.calculo, m.requiere_contacto, m.created_at`,
    busqueda: ['p.nombre', 'r.nombre', 'i.nombre', 'm.calculo'],
    estados: null, orden: 'p.fecha_inicio DESC, r.nombre ASC, m.id_meta ASC',
    campos: [
      { col: 'id_periodo', etiqueta: 'Período', tipo: 'entero', req: true, fk: { tabla: 'periodos', pk: 'id_periodo', activo: true, texto: 'El período' } },
      { col: 'id_rol', etiqueta: 'Cargo (rol)', tipo: 'entero', req: true, fk: { tabla: 'roles', pk: 'id_rol', activo: true, texto: 'El cargo' } },
      { col: 'id_item', etiqueta: 'Ítem', tipo: 'entero', req: true, fk: { tabla: 'items_metas', pk: 'id_item', activo: true, texto: 'El ítem' } },
      { col: 'ponderador', etiqueta: 'Ponderador (0,25 = 25 %; reclamos van en negativo)', tipo: 'decimal', req: true, minimo: -1, maximo: 1 },
      { col: 'meta', etiqueta: 'Meta del período (para «tubo»: 0,8 = 80 %)', tipo: 'decimal', req: true, minimo: 0, maximo: 100000 },
      { col: 'calculo', etiqueta: 'Cómo se calcula', tipo: 'enum', opciones: CALCULOS, defecto: 'conteo' },
      { col: 'requiere_contacto', etiqueta: 'Exige nombre y teléfono del usuario', tipo: 'bool', defecto: 0 }
    ],
    referencias: [],
    exportar: [['periodo', 'Período'], ['cargo', 'Cargo'], ['item', 'Ítem'], ['ponderador', 'Ponderador'], ['meta', 'Meta'], ['calculo', 'Cálculo'], ['requiere_contacto', 'Exige contacto']]
  },

  'cartas': {
    tabla: 'cartas', pk: 'id_carta', alias: 'c', etiqueta: 'Tubo de cartas',
    from: `cartas c
      JOIN delegaciones d ON d.id_delegacion = c.id_delegacion
      JOIN usuarios u ON u.id_usuario = c.id_responsable`,
    select: `c.id_carta AS id, c.codigo, c.fecha, c.numero, c.para, c.remite, c.fono, c.tema, c.fecha_actividad, c.encargado, c.estado,
      c.pronunciamiento, c.derivada_a, c.observacion, c.id_delegacion, d.codigo AS delegacion_codigo, c.id_responsable, u.nombre AS responsable, c.created_at`,
    busqueda: ['c.codigo', 'c.numero', 'c.remite', 'c.tema', 'c.encargado', 'c.derivada_a'],
    estados: ESTADOS_CARTA, orden: 'c.fecha DESC, c.id_carta DESC',
    // delegación y responsable salen de la sesión
    campos: [
      { col: 'fecha', etiqueta: 'Fecha de la carta', tipo: 'fecha', req: true },
      { col: 'numero', etiqueta: 'Nº de ingreso', tipo: 'texto', max: 20, patron: CODIGO, mensajePatron: `El número ${MSG_CODIGO}` },
      { col: 'para', etiqueta: 'Para', tipo: 'enum', opciones: ['Alcaldesa', 'Delegado', 'Otro'], defecto: 'Alcaldesa' },
      { col: 'remite', etiqueta: 'Remite', tipo: 'texto', req: true, min: 3, max: 150, patron: TEXTO, mensajePatron: `El remitente ${MSG_TEXTO}` },
      { col: 'fono', etiqueta: 'Teléfono de contacto', tipo: 'telefono' },
      { col: 'tema', etiqueta: 'Actividad o tema', tipo: 'texto', req: true, min: 5, max: 255, patron: /^[^<>]+$/, mensajePatron: 'El tema no puede contener los símbolos < o >.' },
      { col: 'fecha_actividad', etiqueta: 'Fecha de la actividad', tipo: 'fecha' },
      { col: 'encargado', etiqueta: 'Encargado de seguimiento', tipo: 'texto', max: 150, patron: TEXTO, mensajePatron: `El encargado ${MSG_TEXTO}` },
      { col: 'estado', etiqueta: 'Estado', tipo: 'enum', opciones: ESTADOS_CARTA, defecto: 'En proceso' },
      { col: 'pronunciamiento', etiqueta: 'Pronunciamiento', tipo: 'enum', opciones: PRONUNCIAMIENTOS, defecto: 'No aplica' },
      { col: 'derivada_a', etiqueta: 'Derivada a', tipo: 'texto', max: 150, patron: TEXTO, mensajePatron: `El campo «derivada a» ${MSG_TEXTO}` },
      { col: 'observacion', etiqueta: 'Observación', tipo: 'texto', max: 2000, patron: /^[^<>]+$/, mensajePatron: 'La observación no puede contener los símbolos < o >.' }
    ],
    referencias: [],
    exportar: [['codigo', 'Código'], ['fecha', 'Fecha'], ['numero', 'Nº ingreso'], ['para', 'Para'], ['remite', 'Remite'], ['fono', 'Teléfono'], ['tema', 'Tema'], ['fecha_actividad', 'Fecha actividad'],
      ['encargado', 'Encargado'], ['estado', 'Estado'], ['pronunciamiento', 'Pronunciamiento'], ['derivada_a', 'Derivada a'], ['observacion', 'Observación'], ['responsable', 'Responsable']]
  },

  'organizaciones': {
    tabla: 'organizaciones', pk: 'id_organizacion', alias: 'o', etiqueta: 'Organizaciones',
    from: 'organizaciones o',
    select: `o.id_organizacion AS id, o.nombre, o.domicilio, o.territorio, o.socios_activos, o.fecha_constitucion, o.nro_registro_pj, o.fecha_inscripcion, o.reg_dir, o.estado, o.created_at`,
    busqueda: ['o.nombre', 'o.domicilio', 'o.territorio', 'o.nro_registro_pj'],
    estados: ACTIVO, orden: 'o.nombre',
    campos: [
      { col: 'nombre', etiqueta: 'Nombre de la organización', tipo: 'texto', req: true, min: 3, max: 255, patron: TEXTO, mensajePatron: `El nombre ${MSG_TEXTO}`, unico: true },
      { col: 'domicilio', etiqueta: 'Domicilio legal', tipo: 'texto', max: 255, patron: TEXTO, mensajePatron: `El domicilio ${MSG_TEXTO}` },
      { col: 'territorio', etiqueta: 'Territorio', tipo: 'texto', max: 60, patron: TEXTO, mensajePatron: `El territorio ${MSG_TEXTO}` },
      { col: 'socios_activos', etiqueta: 'Socios activos', tipo: 'entero', minimo: 0, maximo: 1000000 },
      { col: 'fecha_constitucion', etiqueta: 'Fecha de constitución', tipo: 'fecha' },
      { col: 'nro_registro_pj', etiqueta: 'Nº de registro de personalidad jurídica', tipo: 'texto', max: 20, patron: CODIGO, mensajePatron: `El número ${MSG_CODIGO}` },
      { col: 'fecha_inscripcion', etiqueta: 'Fecha de inscripción en el registro', tipo: 'fecha' },
      { col: 'reg_dir', etiqueta: 'Nº de registro de directiva', tipo: 'texto', max: 20, patron: CODIGO, mensajePatron: `El número ${MSG_CODIGO}` },
      estado(ACTIVO, 'Activo')
    ],
    referencias: [{ tabla: 'tubo', col: 'id_organizacion', texto: 'gestiones del tubo' }],
    exportar: [['nombre', 'Organización'], ['domicilio', 'Domicilio'], ['territorio', 'Territorio'], ['socios_activos', 'Socios activos'], ['fecha_constitucion', 'Constitución'], ['nro_registro_pj', 'Nº registro PJ'], ['estado', 'Estado']]
  },

  'periodos': {
    tabla: 'periodos', pk: 'id_periodo', alias: 'p', etiqueta: 'Períodos',
    from: 'periodos p',
    select: `p.id_periodo AS id, p.nombre, p.fecha_inicio, p.fecha_fin, p.tope_item, p.tope_total, p.minimo_cumplimiento,
      p.max_gestiones_dia, p.cierre_dia_semana, p.exigir_verificacion, p.estado, p.created_at`,
    busqueda: ['p.nombre'],
    estados: ACTIVO, orden: 'p.fecha_inicio DESC',
    campos: [
      { col: 'nombre', etiqueta: 'Nombre', tipo: 'texto', req: true, min: 3, max: 60, patron: TEXTO, mensajePatron: `El nombre ${MSG_TEXTO}`, unico: true },
      { col: 'fecha_inicio', etiqueta: 'Inicio', tipo: 'fecha', req: true },
      { col: 'fecha_fin', etiqueta: 'Término', tipo: 'fecha', req: true },
      { col: 'tope_item', etiqueta: 'Tope por ítem (1,2 = 120 %)', tipo: 'decimal', minimo: 1, maximo: 3, defecto: 1.2 },
      { col: 'tope_total', etiqueta: 'Tope total por colaborador (1,5 = 150 %)', tipo: 'decimal', minimo: 1, maximo: 3, defecto: 1.5 },
      { col: 'minimo_cumplimiento', etiqueta: 'Cumplimiento mínimo (0,8 = 80 %)', tipo: 'decimal', minimo: 0, maximo: 1, defecto: 0.8 },
      { col: 'max_gestiones_dia', etiqueta: 'Máximo de gestiones por día', tipo: 'entero', minimo: 1, maximo: 50, defecto: 7 },
      { col: 'cierre_dia_semana', etiqueta: 'Día de cierre de la semana anterior (1 = lunes … 7 = domingo)', tipo: 'entero', minimo: 1, maximo: 7, defecto: 2 },
      { col: 'exigir_verificacion', etiqueta: 'Solo cuentan las gestiones con imagen verificada', tipo: 'bool', defecto: 0 },
      estado(ACTIVO, 'Activo')
    ],
    referencias: [
      { tabla: 'metas_cargo', col: 'id_periodo', texto: 'metas por cargo' },
      { tabla: 'valoraciones', col: 'id_periodo', texto: 'felicitaciones o reclamos' }
    ],
    exportar: [['nombre', 'Período'], ['fecha_inicio', 'Inicio'], ['fecha_fin', 'Término'], ['tope_item', 'Tope por ítem'], ['tope_total', 'Tope total'], ['max_gestiones_dia', 'Máx. por día'], ['cierre_dia_semana', 'Día de cierre'], ['estado', 'Estado']]
  }
};

module.exports = { MODULOS_API, ESTADOS_CARTA, ESTADOS_TUBO, TRANSICIONES_TUBO, TIPOS_AUSENCIA, CALCULOS };
