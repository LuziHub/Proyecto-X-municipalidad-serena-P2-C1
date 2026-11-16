'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Permisos del SGR.
//
// La fuente de verdad es la tabla `roles` de la base de datos:
//   roles.permisos → JSON  {"atenciones": ["ver","crear"], "usuarios": ["ver"], ...}
//   roles.alcance  → texto (ver ALCANCES)
// Así el mantenedor de Roles administra los permisos reales del sistema.
// Un rol sin permisos (NULL) o inactivo no puede hacer nada (denegar por defecto).
//
// PERMISOS_BASE solo se usa para cargar los permisos iniciales (scripts/preparar-demo.js).
// ─────────────────────────────────────────────────────────────────────────────

// Módulos con lógica real (mantenedores y atenciones).
const MODULOS_REALES = {
  'atenciones': 'Atenciones',
  'delegaciones': 'Delegaciones',
  'roles': 'Roles',
  'usuarios': 'Usuarios',
  'items-metas': 'Ítems y metas',
  'tipos-atencion': 'Tipo de Atención',
  'sub-atenciones': 'Sub Atención',
  // Matriz SGR
  'gestiones': 'Registro de gestiones',
  'tubo': 'Tubo de trabajo',
  'valoraciones': 'Felicitaciones y reclamos',
  'ausencias': 'Licencias y ausencias',
  'metas-cargo': 'Metas por cargo',
  'periodos': 'Períodos',
  'cartas': 'Tubo de cartas',
  'organizaciones': 'Organizaciones (JJVV y otras)'
};

// Pantallas de consulta con lógica real pero sin altas/bajas: solo tienen la acción "ver".
//   semaforo → el puntaje propio del usuario (cumplimiento y semáforo)
//   equipo   → ver a todo el equipo de la delegación (gestiones y puntajes de todos)
const MODULOS_VISTA = {
  'semaforo': 'Mi puntaje y semáforo',
  'equipo': 'Equipo de la delegación'
};

// Módulos del sistema que en esta entrega son solo plantilla (navegación y vista por rol, sin lógica).
// Solo tienen sentido con la acción "ver".
const MODULOS_PLANTILLA = {
  'vecinos': 'Vecinos',
  'tipos-gestion': 'Tipo de Gestión',
  'verificacion': 'Verificación de evidencias',
  'alertas': 'Alertas',
  'reportes': 'Reportes'
};

// Nombre exacto del rol de jefatura de delegación (lo usan las reglas de la matriz).
const ROL_DELEGADO = 'Delegado municipal';

const MODULOS = { ...MODULOS_REALES, ...MODULOS_VISTA, ...MODULOS_PLANTILLA };

const ACCIONES = ['ver', 'crear', 'editar', 'eliminar', 'exportar'];

// Alcance de un rol sobre las delegaciones:
//   Global      → todas las delegaciones activas
//   Autorizado  → las que tenga asignadas (usuario_delegaciones) + su delegación activa
//   Delegación  → solo su delegación activa
//   Lectura     → como Autorizado (el rol de solo lectura se logra con sus permisos)
const ALCANCES = ['Global', 'Autorizado', 'Delegación', 'Lectura'];

// ─── Roles de demostración (propuesta; el equipo puede ajustarla desde el mantenedor de Roles) ───
const TODAS = [...ACCIONES];
const real = (...modulos) => Object.fromEntries(modulos.map(m => [m, [...TODAS]]));
const plantillas = (...modulos) => Object.fromEntries(modulos.map(m => [m, ['ver']]));
const vistas = plantillas;   // las pantallas de consulta también solo tienen "ver"
const CATALOGOS = ['items-metas', 'tipos-atencion', 'sub-atenciones'];
const acc = (...a) => [...a];
const { CARGOS } = require('./matriz');
const MODULOS_CRUD = Object.keys(MODULOS_REALES);
const MODULOS_VISTAS = Object.keys(MODULOS_VISTA);

const ROLES_DEMO = [
  { codigo: 'SUPERADM', nombre: 'Superadministrador', alcance: 'Global',
    descripcion: 'Control total del sistema en todas las delegaciones.',
    permisos: { ...real(...MODULOS_CRUD), ...vistas(...MODULOS_VISTAS), ...plantillas(...Object.keys(MODULOS_PLANTILLA)) } },
  { codigo: 'COORD', nombre: 'Coordinador', alcance: 'Autorizado',
    descripcion: 'Coordina el sistema: administra catálogos y consulta todo lo operativo; no gestiona roles.',
    permisos: {
      'atenciones': acc('ver', 'crear', 'exportar'), 'delegaciones': acc('ver', 'exportar'), 'usuarios': acc('ver', 'exportar'),
      ...Object.fromEntries(CATALOGOS.map(m => [m, acc('ver', 'crear', 'editar', 'exportar')])),
      // Matriz: administra metas y períodos y consulta lo operativo de las delegaciones que tiene autorizadas
      'gestiones': acc('ver', 'exportar'), 'tubo': acc('ver', 'exportar'), 'valoraciones': acc('ver', 'exportar'), 'ausencias': acc('ver', 'exportar'),
      'metas-cargo': acc('ver', 'crear', 'editar', 'exportar'), 'periodos': acc('ver', 'crear', 'editar', 'exportar'),
      'cartas': acc('ver', 'exportar'), 'organizaciones': acc('ver', 'crear', 'editar', 'exportar'),
      ...vistas('semaforo', 'equipo'),
      ...plantillas('vecinos', 'tipos-gestion', 'verificacion', 'alertas', 'reportes') } },
  { codigo: 'DELEGADO', nombre: 'Delegado municipal', alcance: 'Delegación',
    descripcion: 'Jefatura de una delegación: gestiona atenciones y usuarios de su delegación.',
    permisos: {
      'atenciones': acc('ver', 'crear', 'editar', 'exportar'), 'usuarios': acc('ver', 'crear', 'editar'), 'delegaciones': acc('ver'),
      ...Object.fromEntries(CATALOGOS.map(m => [m, acc('ver')])),
      // Matriz: supervisa a su equipo, gestiona el tubo, registra felicitaciones/reclamos y ausencias (reglas 8 y 9)
      'gestiones': [...TODAS], 'tubo': [...TODAS], 'valoraciones': [...TODAS], 'ausencias': [...TODAS],
      'metas-cargo': acc('ver', 'exportar'), 'periodos': acc('ver'),
      'cartas': [...TODAS], 'organizaciones': acc('ver', 'crear', 'editar', 'exportar'),
      ...vistas('semaforo', 'equipo'),
      ...plantillas('vecinos', 'verificacion', 'alertas', 'reportes') } },
  { codigo: 'FUNC', nombre: 'Funcionario', alcance: 'Delegación',
    descripcion: 'Registra y consulta atenciones de su delegación.',
    permisos: { 'atenciones': acc('ver', 'crear'), ...plantillas('vecinos') } },
  // Roles que ya existen en la base del proyecto:
  { codigo: 'ROL01', nombre: 'Administrador', alcance: 'Autorizado',
    descripcion: 'Control total en las delegaciones que tiene autorizadas.',
    permisos: { ...real(...MODULOS_CRUD), ...vistas(...MODULOS_VISTAS), ...plantillas(...Object.keys(MODULOS_PLANTILLA)) } },
  { codigo: 'ROL02', nombre: 'Operador', alcance: 'Delegación',
    descripcion: 'Registro diario de atenciones.', permisos: { 'atenciones': acc('ver', 'crear') } },
  { codigo: 'ROL03', nombre: 'Consultor', alcance: 'Lectura',
    descripcion: 'Solo consulta y exportación.',
    permisos: {
      ...Object.fromEntries(['atenciones', 'delegaciones', ...CATALOGOS, 'gestiones', 'tubo'].map(m => [m, acc('ver', 'exportar')])),
      'metas-cargo': acc('ver'), 'periodos': acc('ver'), 'cartas': acc('ver', 'exportar'), 'organizaciones': acc('ver', 'exportar'),
      ...vistas('semaforo', 'equipo'),
      ...plantillas('reportes') } },
  // Cargos de las delegaciones (descriptor de funciones). Un funcionario registra y ve lo suyo;
  // el tubo es compartido por la delegación. Metas y puntaje salen de «Metas por cargo».
  ...CARGOS.map(c => ({
    codigo: c.codigo, nombre: c.nombre, alcance: c.alcance, descripcion: c.descripcion,
    permisos: {
      'gestiones': acc('ver', 'crear', 'editar', 'eliminar', 'exportar'), 'tubo': acc('ver', 'crear', 'editar', 'exportar'),
      'semaforo': acc('ver'), 'valoraciones': acc('ver'), 'ausencias': acc('ver'), 'cartas': acc('ver'), 'organizaciones': acc('ver'),
      ...(c.extra && c.extra.includes('atenciones') ? { 'atenciones': acc('ver', 'crear') } : {}),
      // Gestión y Planificación informa al delegado sobre el avance de cada colaborador
      ...(c.equipo ? { 'equipo': acc('ver'), 'metas-cargo': acc('ver') } : {}),
      ...plantillas('vecinos')
    }
  }))
];

const PERMISOS_BASE = Object.fromEntries(ROLES_DEMO.map(r => [r.nombre, r.permisos]));

// Módulos que se agregan con la matriz SGR. scripts/preparar-matriz.js los suma a los roles que ya
// existen en la base (sin quitar nada de lo que ya tengan).
const MODULOS_MATRIZ = ['gestiones', 'tubo', 'valoraciones', 'ausencias', 'metas-cargo', 'periodos', 'cartas', 'organizaciones', ...Object.keys(MODULOS_VISTA)];

const tienePropia = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Convierte lo que venga de la base (texto JSON, objeto o NULL) en { modulo: [acciones] }
// descartando módulos y acciones desconocidos.
function normalizarPermisos(valor) {
  let obj = valor;
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj); } catch (_) { return {}; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const salida = {};
  for (const modulo of Object.keys(MODULOS)) {
    if (!tienePropia(obj, modulo) || !Array.isArray(obj[modulo])) continue;
    const acciones = ACCIONES.filter(a => obj[modulo].includes(a));
    if (acciones.length) salida[modulo] = acciones;
  }
  return salida;
}

// Errores de un permisos recibido desde un formulario (vacío si es válido).
function validarPermisos(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return ['Los permisos deben ser un objeto módulo → acciones.'];
  const errores = [];
  for (const [modulo, acciones] of Object.entries(obj)) {
    if (!tienePropia(MODULOS, modulo)) { errores.push(`Módulo desconocido: ${modulo}.`); continue; }
    if (!Array.isArray(acciones) || acciones.some(a => !ACCIONES.includes(a))) {
      errores.push(`Acciones inválidas para ${modulo}.`);
    }
  }
  return errores;
}

// true si todo lo que permite `destino` también lo permite `origen`.
function esSubconjunto(destino, origen) {
  const d = normalizarPermisos(destino);
  const o = normalizarPermisos(origen);
  return Object.entries(d).every(([m, acciones]) => acciones.every(a => (o[m] || []).includes(a)));
}

function puede(permisos, modulo, accion) {
  return !!permisos && tienePropia(permisos, modulo) && permisos[modulo].includes(accion);
}

// 'global' | 'autorizado' | 'delegacion' | 'lectura'. Un alcance desconocido se trata como
// el más restrictivo ('delegacion').
function claveAlcance(texto) {
  const limpio = String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  return ['global', 'autorizado', 'delegacion', 'lectura'].includes(limpio) ? limpio : 'delegacion';
}

module.exports = {
  MODULOS, ROL_DELEGADO, MODULOS_REALES, MODULOS_VISTA, MODULOS_MATRIZ, MODULOS_PLANTILLA, ACCIONES, ALCANCES, PERMISOS_BASE, ROLES_DEMO,
  normalizarPermisos, validarPermisos, esSubconjunto, puede, claveAlcance
};
