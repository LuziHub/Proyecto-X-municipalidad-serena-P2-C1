'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Matriz SGR: cargos, ítems y metas por cargo.
// Valores tomados de las hojas por cargo de la planilla "MATRIZ SGR 3.er trimestre 2026".
// Son datos iniciales: se cargan con scripts/preparar-matriz.js y después se administran
// desde los módulos «Metas por cargo» y «Períodos» (no hace falta tocar este archivo).
//
// calculo:
//   conteo        cuenta gestiones que puntúan
//   emergencia    100 % si hubo al menos una
//   tubo          % de gestiones del tubo realizadas (meta típica 0,8)
//   felicitacion  suma por cada una, hasta "meta" (máx. 3)
//   reclamo       resta por cada una
// contacto: el ítem exige nombre y teléfono del usuario para puntuar (regla 2).
// ─────────────────────────────────────────────────────────────────────────────

const ITEMS = {
  'ATN-USU':   { nombre: 'Atención de usuario teléfono y presencial', descripcion: 'Atención de usuarios por teléfono o de forma presencial.' },
  'LLAM-PREV': { nombre: 'Llamadas preventivas a usuarios', descripcion: 'Llamadas preventivas a usuarios atendidos.' },
  'INF-INV':   { nombre: 'Informe de inventarios', descripcion: 'Inventario trimestral de la delegación.' },
  'INF-COM':   { nombre: 'Informe a comunicaciones', descripcion: 'Envío de la agenda o informes a Comunicaciones.' },
  'EMERG':     { nombre: 'Emergencia', descripcion: 'Gestiones realizadas en una emergencia.' },
  'VIS-ORG':   { nombre: 'Visitas y reuniones con organizaciones', descripcion: 'Visitas y reuniones con organizaciones comunitarias.' },
  'CONF-ORG':  { nombre: 'Conformación de organizaciones', descripcion: 'Conformación de directivas y organizaciones nuevas.' },
  'TALLER':    { nombre: 'Gestión de talleres y actividades', descripcion: 'Talleres y actividades realizados con las organizaciones.' },
  'TUBO-SOL':  { nombre: 'Soluciones de ingresos al tubo', descripcion: 'Porcentaje de gestiones del tubo que quedan realizadas.' },
  'INF-PERS':  { nombre: 'Informes de personal', descripcion: 'Informes del personal de cuadrillas (para pago).' },
  'INF-TRAB':  { nombre: 'Informe de trabajo', descripcion: 'Informe semanal de trabajo.' },
  'OP-DELEG':  { nombre: 'Operativo delegación', descripcion: 'Operativos realizados por la delegación.' },
  'OP-DISER':  { nombre: 'Operativo Diserco', descripcion: 'Operativos realizados junto a Diserco.' },
  'TALLERES':  { nombre: 'Talleres', descripcion: 'Talleres de reciclaje, compostaje y medio ambiente.' },
  'TERRENO':   { nombre: 'Terreno', descripcion: 'Salidas a terreno.' },
  'ATN-REQ':   { nombre: 'Atención de requerimiento de usuario', descripcion: 'Requerimientos de usuarios atendidos.' },
  'ATN-SOC':   { nombre: 'Atención social a usuario presencial', descripcion: 'Atención social presencial.' },
  'VIS-TERR':  { nombre: 'Visita social en terreno', descripcion: 'Visitas sociales en terreno.' },
  'ENT-INF':   { nombre: 'Entrega de informe', descripcion: 'Informes sociales entregados.' },
  'ENT-BEN':   { nombre: 'Entrega de beneficio', descripcion: 'Beneficios entregados.' },
  'REUN-SEM':  { nombre: 'Reunión semanal con el equipo', descripcion: 'Reunión semanal de coordinación con el equipo.' },
  'SOL-PROB':  { nombre: 'Solución de problemas a usuarios particulares', descripcion: 'Problemas de usuarios particulares resueltos.' },
  'COM-SEG':   { nombre: 'Formación de comités de seguridad', descripcion: 'Comités de seguridad formados.' },
  'INCIVIL':   { nombre: 'Levantamiento de incivilidades', descripcion: 'Incivilidades levantadas en terreno.' },
  'MEDIAC':    { nombre: 'Gestión de mediación', descripcion: 'Mediaciones realizadas.' },
  'REC-ESP':   { nombre: 'Recuperación de espacios públicos', descripcion: 'Espacios públicos recuperados.' },
  'INFRAC':    { nombre: 'Infracciones varias', descripcion: 'Infracciones cursadas o derivadas.' },
  'SAL-TERR':  { nombre: 'Salidas a terreno', descripcion: 'Salidas a terreno del gestor de seguridad.' },
  'FELICIT':   { nombre: 'Felicitaciones', descripcion: 'Felicitaciones formales (cada una suma 10 %, máximo 3).' },
  'RECLAMO':   { nombre: 'Reclamos', descripcion: 'Reclamos por escrito por mala atención (restan).' }
};

// [codigoItem, ponderador, meta, calculo, exigeContacto]
const m = (item, ponderador, meta, calculo = 'conteo', contacto = false) => ({ item, ponderador, meta, calculo, contacto });
const felicitacion = () => m('FELICIT', 0.1, 3, 'felicitacion');
const reclamo = pond => m('RECLAMO', pond, 0, 'reclamo');

const CARGOS = [
  { codigo: 'APA', nombre: 'Apoyo Administrativo', alcance: 'Delegación',
    descripcion: 'Atención de público, agenda, registro de atenciones, inventario e informes de la delegación.',
    extra: ['atenciones'],
    metas: [m('ATN-USU', 0.20, 240, 'conteo', true), m('LLAM-PREV', 0.30, 90, 'conteo', true), m('INF-INV', 0.25, 1), m('INF-COM', 0.20, 12),
      m('EMERG', 0.05, 0, 'emergencia'), felicitacion(), reclamo(-0.3)] },
  { codigo: 'OROC', nombre: 'Organizaciones Comunitarias', alcance: 'Delegación',
    descripcion: 'Registro de organizaciones (OROC), asesoría, visitas, talleres y convocatorias.',
    extra: ['atenciones'],
    metas: [m('ATN-USU', 0.15, 60, 'conteo', true), m('VIS-ORG', 0.15, 24, 'conteo', true), m('CONF-ORG', 0.25, 1, 'conteo', true),
      m('TALLER', 0.15, 6), m('EMERG', 0.05, 0, 'emergencia'), m('TUBO-SOL', 0.25, 0.8, 'tubo'), felicitacion(), reclamo(-0.3)] },
  { codigo: 'GSOC', nombre: 'Gestor Social', alcance: 'Delegación',
    descripcion: 'Atención de casos sociales, visitas en terreno, informes y entrega de beneficios.',
    extra: ['atenciones'],
    metas: [m('ATN-SOC', 0.20, 90, 'conteo', true), m('VIS-TERR', 0.20, 12, 'conteo', true), m('ENT-INF', 0.25, 40, 'conteo', true), m('ENT-BEN', 0.20, 8, 'conteo', true),
      m('EMERG', 0.05, 0, 'emergencia'), m('TUBO-SOL', 0.10, 0.8, 'tubo'), felicitacion(), reclamo(-0.2)] },
  { codigo: 'PYG', nombre: 'Gestión y Planificación', alcance: 'Delegación',
    descripcion: 'Apoyo al delegado: informes, seguimiento de la matriz SGR y coordinación interna.',
    equipo: true,
    // La planilla original suma 85 %; se respeta tal cual y el sistema lo advierte.
    metas: [m('REUN-SEM', 0.15, 12), m('SOL-PROB', 0.30, 8, 'conteo', true), m('EMERG', 0.05, 0, 'emergencia'), m('TUBO-SOL', 0.35, 0.8, 'tubo'),
      felicitacion(), reclamo(-0.3)] },
  { codigo: 'COS', nombre: 'Coordinador de Servicios Comunitarios', alcance: 'Delegación',
    descripcion: 'Aseo, ornato y medio ambiente: operativos, cuadrillas y atención de requerimientos.',
    metas: [m('INF-PERS', 0.10, 3), m('INF-TRAB', 0.10, 12), m('OP-DELEG', 0.15, 24), m('OP-DISER', 0.10, 12), m('TALLERES', 0.10, 12),
      m('TERRENO', 0.10, 24, 'conteo', true), m('ATN-REQ', 0.15, 24, 'conteo', true), m('EMERG', 0.05, 0, 'emergencia'), m('TUBO-SOL', 0.15, 0.8, 'tubo'),
      felicitacion(), reclamo(-0.2)] },
  { codigo: 'SEG', nombre: 'Gestor de Seguridad', alcance: 'Delegación',
    descripcion: 'Seguridad ciudadana: comités, incivilidades, mediación y recuperación de espacios.',
    metas: [m('COM-SEG', 0.20, 36, 'conteo', true), m('INCIVIL', 0.20, 40), m('MEDIAC', 0.10, 50, 'conteo', true), m('REC-ESP', 0.10, 50),
      m('INFRAC', 0.15, 45), m('SAL-TERR', 0.10, 45), m('TUBO-SOL', 0.15, 0.8, 'tubo'), felicitacion(), reclamo(-0.3)] },
  // Está en el descriptor de funciones pero la matriz no trae hoja ni metas para este cargo:
  // se crea el rol sin metas hasta que la Coordinación las defina (módulo «Metas por cargo»).
  { codigo: 'COMP', nombre: 'Gestor de Compras y Proyectos', alcance: 'Delegación',
    descripcion: 'Tramita requerimientos de compras y proyectos. Sin metas definidas en la matriz todavía.',
    metas: [] }
];

// Usuarios de demostración (datos ficticios, sin personas reales). Contraseña: la que se entregue por separado.
const USUARIOS_MATRIZ = [
  { nombre: 'Ana Apoyo Administrativo', correo: 'apoyo@demo.sgr.cl', cargo: 'APA' },
  { nombre: 'Omar Organizaciones', correo: 'organizaciones@demo.sgr.cl', cargo: 'OROC' },
  { nombre: 'Greta Gestora Social', correo: 'social@demo.sgr.cl', cargo: 'GSOC' },
  { nombre: 'Pablo Planificación', correo: 'planificacion@demo.sgr.cl', cargo: 'PYG' },
  { nombre: 'Carla Coordinadora Servicios', correo: 'servicios@demo.sgr.cl', cargo: 'COS' },
  { nombre: 'Sergio Seguridad', correo: 'seguridad@demo.sgr.cl', cargo: 'SEG' },
  { nombre: 'Cecilia Compras', correo: 'compras@demo.sgr.cl', cargo: 'COMP' }
];

module.exports = { ITEMS, CARGOS, USUARIOS_MATRIZ };
