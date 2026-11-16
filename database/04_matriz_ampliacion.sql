-- ─────────────────────────────────────────────────────────────────────────────
-- Ampliación de la Matriz SGR: códigos por área, foto y verificación de gestiones,
-- tubo de cartas (Oficina de Partes) y catálogo de organizaciones (JJVV y similares).
-- Ejecutar DESPUÉS de 03_matriz.sql. Es idempotente: se puede repetir sin problema.
--     mysql -u root -p sgr_laserena_db < database/04_matriz_ampliacion.sql
-- ─────────────────────────────────────────────────────────────────────────────
SET NAMES utf8mb4;

-- Agrega una columna solo si todavía no existe (MySQL no tiene ADD COLUMN IF NOT EXISTS).
DROP PROCEDURE IF EXISTS sgr_agregar_columna;
DELIMITER $$
CREATE PROCEDURE sgr_agregar_columna(IN tabla VARCHAR(64), IN columna VARCHAR(64), IN definicion TEXT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tabla AND COLUMN_NAME = columna) THEN
    SET @sgr_sql = CONCAT('ALTER TABLE `', tabla, '` ADD COLUMN `', columna, '` ', definicion);
    PREPARE sgr_st FROM @sgr_sql; EXECUTE sgr_st; DEALLOCATE PREPARE sgr_st;
  END IF;
END$$
DELIMITER ;

-- Gestiones: código de la matriz (APA711 = área + mes + día + número), código de la foto y verificación del delegado
CALL sgr_agregar_columna('gestiones', 'codigo_area', "varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL");
CALL sgr_agregar_columna('gestiones', 'codigo_foto', "varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL");
CALL sgr_agregar_columna('gestiones', 'imagen_verificada', "tinyint(1) NOT NULL DEFAULT '0'");
CALL sgr_agregar_columna('gestiones', 'verificado_por', "int DEFAULT NULL");
CALL sgr_agregar_columna('gestiones', 'fecha_verificacion', "date DEFAULT NULL");
-- Períodos: si se exige verificación, solo cuentan las gestiones verificadas (apagado por defecto)
CALL sgr_agregar_columna('periodos', 'exigir_verificacion', "tinyint(1) NOT NULL DEFAULT '0'");
-- Tubo: solicitante tomado del catálogo de organizaciones y territorio
CALL sgr_agregar_columna('tubo', 'id_organizacion', "int DEFAULT NULL");
CALL sgr_agregar_columna('tubo', 'territorio', "varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL");
DROP PROCEDURE IF EXISTS sgr_agregar_columna;

-- Catálogo de organizaciones (juntas de vecinos, clubes, centros de madres, etc.). Se carga con scripts/importar-jjvv.js
CREATE TABLE IF NOT EXISTS `organizaciones` (
  `id_organizacion` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `domicilio` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `territorio` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `socios_activos` int DEFAULT NULL,
  `fecha_constitucion` date DEFAULT NULL,
  `nro_registro_pj` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fecha_inscripcion` date DEFAULT NULL,
  `reg_dir` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `estado` enum('Activo','Inactivo') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Activo',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_organizacion`),
  UNIQUE KEY `uq_organizacion_nombre` (`nombre`),
  KEY `idx_organizacion_territorio` (`territorio`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tubo de seguimiento de cartas de Oficina de Partes
CREATE TABLE IF NOT EXISTS `cartas` (
  `id_carta` int NOT NULL AUTO_INCREMENT,
  `codigo` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,      -- CAR-00001
  `fecha` date NOT NULL,
  `numero` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,   -- Nº de ingreso en Oficina de Partes
  `para` enum('Alcaldesa','Delegado','Otro') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Alcaldesa',
  `remite` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fono` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tema` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fecha_actividad` date DEFAULT NULL,
  `encargado` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `estado` enum('En proceso','Aprobada','Finalizada','No aplica') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'En proceso',
  `pronunciamiento` enum('Gabinete','Delegado','Alcaldesa','No aplica') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'No aplica',
  `derivada_a` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `observacion` text COLLATE utf8mb4_unicode_ci,
  `id_delegacion` int NOT NULL,
  `id_responsable` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_carta`),
  UNIQUE KEY `codigo` (`codigo`),
  KEY `idx_carta_delegacion_estado` (`id_delegacion`,`estado`),
  KEY `fk_carta_responsable` (`id_responsable`),
  CONSTRAINT `fk_carta_delegacion` FOREIGN KEY (`id_delegacion`) REFERENCES `delegaciones` (`id_delegacion`) ON UPDATE CASCADE,
  CONSTRAINT `fk_carta_responsable` FOREIGN KEY (`id_responsable`) REFERENCES `usuarios` (`id_usuario`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
