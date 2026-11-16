-- ─────────────────────────────────────────────────────────────────────────────
-- Matriz SGR: períodos, metas por cargo, gestiones, tubo, felicitaciones/reclamos y ausencias.
-- NO borra nada: solo crea tablas nuevas (IF NOT EXISTS). Es seguro repetirlo.
-- Ejecutar con el usuario administrador de MySQL (no con el de la aplicación):
--     mysql -u root -p sgr_laserena_db < database/03_matriz.sql
-- Después cargar cargos, ítems, metas y períodos:  node scripts/preparar-matriz.js --aplicar
-- ─────────────────────────────────────────────────────────────────────────────
SET NAMES utf8mb4;

-- Período de evaluación (trimestre) y sus parámetros: topes, mínimo, máximo diario y día de cierre semanal.
CREATE TABLE IF NOT EXISTS `periodos` (
  `id_periodo` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fecha_inicio` date NOT NULL,
  `fecha_fin` date NOT NULL,
  `tope_item` decimal(4,2) NOT NULL DEFAULT '1.20',            -- regla 7: el puntaje de un ítem no pasa de 120 %
  `tope_total` decimal(4,2) NOT NULL DEFAULT '1.50',           -- sobrecumplimiento máximo por colaborador
  `minimo_cumplimiento` decimal(4,2) NOT NULL DEFAULT '0.80',
  `max_gestiones_dia` int NOT NULL DEFAULT '7',                -- regla 3
  `cierre_dia_semana` tinyint NOT NULL DEFAULT '2',            -- regla 4: 1 = lunes … 7 = domingo (2 = martes)
  `estado` enum('Activo','Inactivo') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Activo',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_periodo`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ítems, ponderadores y metas de cada cargo (rol) en un período.
CREATE TABLE IF NOT EXISTS `metas_cargo` (
  `id_meta` int NOT NULL AUTO_INCREMENT,
  `id_periodo` int NOT NULL,
  `id_rol` int NOT NULL,
  `id_item` int NOT NULL,
  `ponderador` decimal(5,3) NOT NULL,
  `meta` decimal(10,2) NOT NULL DEFAULT '0',
  `calculo` enum('conteo','emergencia','tubo','felicitacion','reclamo') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'conteo',
  `requiere_contacto` tinyint(1) NOT NULL DEFAULT '0',         -- regla 2: exige nombre y teléfono del usuario
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_meta`),
  UNIQUE KEY `uq_meta` (`id_periodo`,`id_rol`,`id_item`),
  KEY `fk_meta_rol` (`id_rol`),
  KEY `fk_meta_item` (`id_item`),
  CONSTRAINT `fk_meta_periodo` FOREIGN KEY (`id_periodo`) REFERENCES `periodos` (`id_periodo`) ON UPDATE CASCADE,
  CONSTRAINT `fk_meta_rol` FOREIGN KEY (`id_rol`) REFERENCES `roles` (`id_rol`) ON UPDATE CASCADE,
  CONSTRAINT `fk_meta_item` FOREIGN KEY (`id_item`) REFERENCES `items_metas` (`id_item`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cada gestión que registra un funcionario (una fila de las hojas de la matriz).
CREATE TABLE IF NOT EXISTS `gestiones` (
  `id_gestion` int NOT NULL AUTO_INCREMENT,
  `codigo` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,    -- GES-00001
  `fecha_gestion` date NOT NULL,
  `actividad` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `detalle` text COLLATE utf8mb4_unicode_ci,
  `id_item` int NOT NULL,
  `contacto_nombre` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contacto_telefono` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `usuario_es_delegado` tinyint(1) NOT NULL DEFAULT '0',       -- regla 1
  `es_coordinacion` tinyint(1) NOT NULL DEFAULT '0',           -- regla 5
  `ingreso_tubo` tinyint(1) NOT NULL DEFAULT '0',
  `puntua` tinyint(1) NOT NULL DEFAULT '1',                    -- lo calcula el servidor (reglas 1, 2 y 5)
  `motivo_no_puntua` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `unidades` int NOT NULL DEFAULT '1',
  `id_delegacion` int NOT NULL,
  `id_responsable` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_gestion`),
  UNIQUE KEY `codigo` (`codigo`),
  KEY `idx_gestion_resp_fecha` (`id_responsable`,`fecha_gestion`),
  KEY `fk_ges_item` (`id_item`),
  KEY `fk_ges_delegacion` (`id_delegacion`),
  CONSTRAINT `fk_ges_item` FOREIGN KEY (`id_item`) REFERENCES `items_metas` (`id_item`) ON UPDATE CASCADE,
  CONSTRAINT `fk_ges_delegacion` FOREIGN KEY (`id_delegacion`) REFERENCES `delegaciones` (`id_delegacion`) ON UPDATE CASCADE,
  CONSTRAINT `fk_ges_responsable` FOREIGN KEY (`id_responsable`) REFERENCES `usuarios` (`id_usuario`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tubo de trabajo: Ingresado → Pendiente → En proceso → Realizado.
CREATE TABLE IF NOT EXISTS `tubo` (
  `id_tubo` int NOT NULL AUTO_INCREMENT,
  `codigo` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,    -- TUB-00001
  `id_gestion` int DEFAULT NULL,
  `titulo` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `solicitante` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ambito` enum('INT','EXT') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'INT',
  `area_apoyo` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `estado` enum('Ingresado','Pendiente','En proceso','Realizado') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Ingresado',
  `fecha_solicitud` date NOT NULL,
  `fecha_compromiso` date DEFAULT NULL,
  `fecha_realizado` date DEFAULT NULL,
  `avance` text COLLATE utf8mb4_unicode_ci,
  `id_delegacion` int NOT NULL,
  `id_responsable` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_tubo`),
  UNIQUE KEY `codigo` (`codigo`),
  KEY `idx_tubo_delegacion_estado` (`id_delegacion`,`estado`),
  KEY `fk_tubo_gestion` (`id_gestion`),
  KEY `fk_tubo_responsable` (`id_responsable`),
  CONSTRAINT `fk_tubo_gestion` FOREIGN KEY (`id_gestion`) REFERENCES `gestiones` (`id_gestion`) ON UPDATE CASCADE,
  CONSTRAINT `fk_tubo_delegacion` FOREIGN KEY (`id_delegacion`) REFERENCES `delegaciones` (`id_delegacion`) ON UPDATE CASCADE,
  CONSTRAINT `fk_tubo_responsable` FOREIGN KEY (`id_responsable`) REFERENCES `usuarios` (`id_usuario`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Felicitaciones (+10 %, máx. 3) y reclamos. Regla 8: las registra el delegado, con respaldo formal.
CREATE TABLE IF NOT EXISTS `valoraciones` (
  `id_valoracion` int NOT NULL AUTO_INCREMENT,
  `tipo` enum('Felicitación','Reclamo') COLLATE utf8mb4_unicode_ci NOT NULL,
  `id_funcionario` int NOT NULL,
  `fecha` date NOT NULL,
  `medio` enum('Correo al delegado','WhatsApp al delegado','Libro de observaciones','Carta') COLLATE utf8mb4_unicode_ci NOT NULL,
  `detalle` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `respaldo` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `id_periodo` int NOT NULL,
  `id_delegacion` int NOT NULL,
  `registrado_por` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_valoracion`),
  KEY `idx_val_func_periodo` (`id_funcionario`,`id_periodo`),
  KEY `fk_val_periodo` (`id_periodo`),
  KEY `fk_val_delegacion` (`id_delegacion`),
  KEY `fk_val_registrador` (`registrado_por`),
  CONSTRAINT `fk_val_funcionario` FOREIGN KEY (`id_funcionario`) REFERENCES `usuarios` (`id_usuario`) ON UPDATE CASCADE,
  CONSTRAINT `fk_val_periodo` FOREIGN KEY (`id_periodo`) REFERENCES `periodos` (`id_periodo`) ON UPDATE CASCADE,
  CONSTRAINT `fk_val_delegacion` FOREIGN KEY (`id_delegacion`) REFERENCES `delegaciones` (`id_delegacion`) ON UPDATE CASCADE,
  CONSTRAINT `fk_val_registrador` FOREIGN KEY (`registrado_por`) REFERENCES `usuarios` (`id_usuario`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Licencias, vacaciones, días administrativos y compensatorios (regla 9: los ingresa el delegado; ajustan el objetivo del semáforo).
CREATE TABLE IF NOT EXISTS `ausencias` (
  `id_ausencia` int NOT NULL AUTO_INCREMENT,
  `id_usuario` int NOT NULL,
  `tipo` enum('Licencia','Vacaciones','Día administrativo','Compensatorio','Emergencia') COLLATE utf8mb4_unicode_ci NOT NULL,
  `fecha_desde` date NOT NULL,
  `fecha_hasta` date NOT NULL,
  `observacion` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `id_delegacion` int NOT NULL,
  `registrado_por` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_ausencia`),
  KEY `idx_aus_usuario` (`id_usuario`,`fecha_desde`),
  KEY `fk_aus_delegacion` (`id_delegacion`),
  KEY `fk_aus_registrador` (`registrado_por`),
  CONSTRAINT `fk_aus_usuario` FOREIGN KEY (`id_usuario`) REFERENCES `usuarios` (`id_usuario`) ON UPDATE CASCADE,
  CONSTRAINT `fk_aus_delegacion` FOREIGN KEY (`id_delegacion`) REFERENCES `delegaciones` (`id_delegacion`) ON UPDATE CASCADE,
  CONSTRAINT `fk_aus_registrador` FOREIGN KEY (`registrado_por`) REFERENCES `usuarios` (`id_usuario`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
