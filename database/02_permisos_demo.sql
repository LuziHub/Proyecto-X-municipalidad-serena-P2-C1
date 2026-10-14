-- Roles y permisos (equivale a: node scripts/preparar-demo.js --aplicar). No contiene contraseñas ni usuarios.
-- Seguro de repetir: crea solo los roles que faltan y escribe permisos solo donde estén vacíos.
-- Los usuarios de demostración se crean con el script (necesitan contraseña cifrada con bcrypt).

INSERT INTO roles (codigo, nombre, descripcion, alcance, permisos, estado)
SELECT 'SUPERADM', 'Superadministrador', 'Control total del sistema en todas las delegaciones.', 'Global', '{"atenciones":["ver","crear","editar","eliminar","exportar"],"delegaciones":["ver","crear","editar","eliminar","exportar"],"roles":["ver","crear","editar","eliminar","exportar"],"usuarios":["ver","crear","editar","eliminar","exportar"],"items-metas":["ver","crear","editar","eliminar","exportar"],"tipos-atencion":["ver","crear","editar","eliminar","exportar"],"sub-atenciones":["ver","crear","editar","eliminar","exportar"],"vecinos":["ver"],"tipos-gestion":["ver"],"verificacion":["ver"],"alertas":["ver"],"reportes":["ver"]}', 'Activo' FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM roles WHERE nombre = 'Superadministrador' OR codigo = 'SUPERADM');
UPDATE roles SET permisos = '{"atenciones":["ver","crear","editar","eliminar","exportar"],"delegaciones":["ver","crear","editar","eliminar","exportar"],"roles":["ver","crear","editar","eliminar","exportar"],"usuarios":["ver","crear","editar","eliminar","exportar"],"items-metas":["ver","crear","editar","eliminar","exportar"],"tipos-atencion":["ver","crear","editar","eliminar","exportar"],"sub-atenciones":["ver","crear","editar","eliminar","exportar"],"vecinos":["ver"],"tipos-gestion":["ver"],"verificacion":["ver"],"alertas":["ver"],"reportes":["ver"]}' WHERE nombre = 'Superadministrador' AND (permisos IS NULL OR JSON_LENGTH(permisos) = 0);

INSERT INTO roles (codigo, nombre, descripcion, alcance, permisos, estado)
SELECT 'COORD', 'Coordinador', 'Coordina el sistema: administra catálogos y consulta todo lo operativo; no gestiona roles.', 'Autorizado', '{"atenciones":["ver","crear","exportar"],"delegaciones":["ver","exportar"],"usuarios":["ver","exportar"],"items-metas":["ver","crear","editar","exportar"],"tipos-atencion":["ver","crear","editar","exportar"],"sub-atenciones":["ver","crear","editar","exportar"],"vecinos":["ver"],"tipos-gestion":["ver"],"verificacion":["ver"],"alertas":["ver"],"reportes":["ver"]}', 'Activo' FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM roles WHERE nombre = 'Coordinador' OR codigo = 'COORD');
UPDATE roles SET permisos = '{"atenciones":["ver","crear","exportar"],"delegaciones":["ver","exportar"],"usuarios":["ver","exportar"],"items-metas":["ver","crear","editar","exportar"],"tipos-atencion":["ver","crear","editar","exportar"],"sub-atenciones":["ver","crear","editar","exportar"],"vecinos":["ver"],"tipos-gestion":["ver"],"verificacion":["ver"],"alertas":["ver"],"reportes":["ver"]}' WHERE nombre = 'Coordinador' AND (permisos IS NULL OR JSON_LENGTH(permisos) = 0);

INSERT INTO roles (codigo, nombre, descripcion, alcance, permisos, estado)
SELECT 'DELEGADO', 'Delegado municipal', 'Jefatura de una delegación: gestiona atenciones y usuarios de su delegación.', 'Delegación', '{"atenciones":["ver","crear","editar","exportar"],"usuarios":["ver","crear","editar"],"delegaciones":["ver"],"items-metas":["ver"],"tipos-atencion":["ver"],"sub-atenciones":["ver"],"vecinos":["ver"],"verificacion":["ver"],"alertas":["ver"],"reportes":["ver"]}', 'Activo' FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM roles WHERE nombre = 'Delegado municipal' OR codigo = 'DELEGADO');
UPDATE roles SET permisos = '{"atenciones":["ver","crear","editar","exportar"],"usuarios":["ver","crear","editar"],"delegaciones":["ver"],"items-metas":["ver"],"tipos-atencion":["ver"],"sub-atenciones":["ver"],"vecinos":["ver"],"verificacion":["ver"],"alertas":["ver"],"reportes":["ver"]}' WHERE nombre = 'Delegado municipal' AND (permisos IS NULL OR JSON_LENGTH(permisos) = 0);

INSERT INTO roles (codigo, nombre, descripcion, alcance, permisos, estado)
SELECT 'FUNC', 'Funcionario', 'Registra y consulta atenciones de su delegación.', 'Delegación', '{"atenciones":["ver","crear"],"vecinos":["ver"]}', 'Activo' FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM roles WHERE nombre = 'Funcionario' OR codigo = 'FUNC');
UPDATE roles SET permisos = '{"atenciones":["ver","crear"],"vecinos":["ver"]}' WHERE nombre = 'Funcionario' AND (permisos IS NULL OR JSON_LENGTH(permisos) = 0);

INSERT INTO roles (codigo, nombre, descripcion, alcance, permisos, estado)
SELECT 'ROL01', 'Administrador', 'Control total en las delegaciones que tiene autorizadas.', 'Autorizado', '{"atenciones":["ver","crear","editar","eliminar","exportar"],"delegaciones":["ver","crear","editar","eliminar","exportar"],"roles":["ver","crear","editar","eliminar","exportar"],"usuarios":["ver","crear","editar","eliminar","exportar"],"items-metas":["ver","crear","editar","eliminar","exportar"],"tipos-atencion":["ver","crear","editar","eliminar","exportar"],"sub-atenciones":["ver","crear","editar","eliminar","exportar"],"vecinos":["ver"],"tipos-gestion":["ver"],"verificacion":["ver"],"alertas":["ver"],"reportes":["ver"]}', 'Activo' FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM roles WHERE nombre = 'Administrador' OR codigo = 'ROL01');
UPDATE roles SET permisos = '{"atenciones":["ver","crear","editar","eliminar","exportar"],"delegaciones":["ver","crear","editar","eliminar","exportar"],"roles":["ver","crear","editar","eliminar","exportar"],"usuarios":["ver","crear","editar","eliminar","exportar"],"items-metas":["ver","crear","editar","eliminar","exportar"],"tipos-atencion":["ver","crear","editar","eliminar","exportar"],"sub-atenciones":["ver","crear","editar","eliminar","exportar"],"vecinos":["ver"],"tipos-gestion":["ver"],"verificacion":["ver"],"alertas":["ver"],"reportes":["ver"]}' WHERE nombre = 'Administrador' AND (permisos IS NULL OR JSON_LENGTH(permisos) = 0);

INSERT INTO roles (codigo, nombre, descripcion, alcance, permisos, estado)
SELECT 'ROL02', 'Operador', 'Registro diario de atenciones.', 'Delegación', '{"atenciones":["ver","crear"]}', 'Activo' FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM roles WHERE nombre = 'Operador' OR codigo = 'ROL02');
UPDATE roles SET permisos = '{"atenciones":["ver","crear"]}' WHERE nombre = 'Operador' AND (permisos IS NULL OR JSON_LENGTH(permisos) = 0);

INSERT INTO roles (codigo, nombre, descripcion, alcance, permisos, estado)
SELECT 'ROL03', 'Consultor', 'Solo consulta y exportación.', 'Lectura', '{"atenciones":["ver","exportar"],"delegaciones":["ver","exportar"],"items-metas":["ver","exportar"],"tipos-atencion":["ver","exportar"],"sub-atenciones":["ver","exportar"],"reportes":["ver"]}', 'Activo' FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM roles WHERE nombre = 'Consultor' OR codigo = 'ROL03');
UPDATE roles SET permisos = '{"atenciones":["ver","exportar"],"delegaciones":["ver","exportar"],"items-metas":["ver","exportar"],"tipos-atencion":["ver","exportar"],"sub-atenciones":["ver","exportar"],"reportes":["ver"]}' WHERE nombre = 'Consultor' AND (permisos IS NULL OR JSON_LENGTH(permisos) = 0);

-- Administrador y Coordinador quedan autorizados en todas las delegaciones activas.
INSERT IGNORE INTO usuario_delegaciones (id_usuario, id_delegacion)
SELECT u.id_usuario, d.id_delegacion
  FROM usuarios u JOIN roles r ON r.id_rol = u.id_rol CROSS JOIN delegaciones d
 WHERE r.nombre IN ('Administrador', 'Coordinador') AND d.estado = 'Activa';
