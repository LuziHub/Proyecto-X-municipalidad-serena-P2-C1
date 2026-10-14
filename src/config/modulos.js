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
const ACTIVA = ['Activa', 'Inactiva'];

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
      { tabla: 'atenciones_ciudadanas', col: 'id_delegacion', texto: 'atenciones' }
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
    referencias: [{ tabla: 'usuarios', col: 'id_rol', texto: 'usuarios' }],
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
    referencias: [{ tabla: 'atenciones_ciudadanas', col: 'id_responsable', texto: 'atenciones registradas' }],
    exportar: [['rut', 'RUT'], ['nombre', 'Nombre'], ['correo', 'Correo'], ['rol', 'Rol'], ['delegacion_codigo', 'Delegación'], ['estado', 'Estado'], ['ultimo_ingreso', 'Último ingreso']]
  },

  'items-metas': {
    tabla: 'items_metas', pk: 'id_item', alias: 'i', etiqueta: 'Ítems y metas',
    from: 'items_metas i',
    select: 'i.id_item AS id, i.codigo, i.nombre, i.descripcion, i.estado, i.created_at',
    busqueda: ['i.codigo', 'i.nombre', 'i.descripcion'],
    estados: ACTIVO, orden: 'i.codigo ASC',
    campos: [codigo(10), nombre(100), descripcion(true), estado(ACTIVO, 'Activo')],
    referencias: [],
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
  }
};

module.exports = { MODULOS_API };
