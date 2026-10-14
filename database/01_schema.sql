-- SGR - esquema de sgr_laserena_db (MySQL 8). Obtenido con: mysqldump --no-data --skip-comments sgr_laserena_db
-- ATENCION: contiene DROP TABLE. Úsalo solo en una base nueva o de pruebas.
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
DROP TABLE IF EXISTS `atenciones_ciudadanas`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `atenciones_ciudadanas` (
  `id_atencion` int NOT NULL AUTO_INCREMENT,
  `identificador_atencion` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `solicitante` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `id_tipo` int NOT NULL,
  `id_sub_atencion` int NOT NULL,
  `descripcion` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `id_delegacion` int NOT NULL,
  `id_responsable` int NOT NULL,
  `fecha_registro` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_atencion`),
  UNIQUE KEY `identificador_atencion` (`identificador_atencion`),
  KEY `fk_atc_tipo` (`id_tipo`),
  KEY `fk_atc_sub` (`id_sub_atencion`),
  KEY `fk_atc_delegacion` (`id_delegacion`),
  KEY `fk_atc_responsable` (`id_responsable`),
  CONSTRAINT `fk_atc_delegacion` FOREIGN KEY (`id_delegacion`) REFERENCES `delegaciones` (`id_delegacion`) ON UPDATE CASCADE,
  CONSTRAINT `fk_atc_responsable` FOREIGN KEY (`id_responsable`) REFERENCES `usuarios` (`id_usuario`) ON UPDATE CASCADE,
  CONSTRAINT `fk_atc_sub` FOREIGN KEY (`id_sub_atencion`) REFERENCES `sub_atenciones` (`id_sub_atencion`) ON UPDATE CASCADE,
  CONSTRAINT `fk_atc_tipo` FOREIGN KEY (`id_tipo`) REFERENCES `tipos_atencion` (`id_tipo`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `delegaciones`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `delegaciones` (
  `id_delegacion` int NOT NULL AUTO_INCREMENT,
  `codigo` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombre` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `direccion` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `comuna` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'La Serena',
  `estado` enum('Activa','Inactiva') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Activa',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_delegacion`),
  UNIQUE KEY `codigo` (`codigo`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `items_metas`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `items_metas` (
  `id_item` int NOT NULL AUTO_INCREMENT,
  `codigo` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombre` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `descripcion` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `estado` enum('Activo','Inactivo') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Activo',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_item`),
  UNIQUE KEY `codigo` (`codigo`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `password_resets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `password_resets` (
  `id_reset` int NOT NULL AUTO_INCREMENT,
  `correo` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `codigo` varchar(6) COLLATE utf8mb4_unicode_ci NOT NULL,
  `intentos_fallidos` tinyint NOT NULL DEFAULT '0',
  `usado` tinyint(1) NOT NULL DEFAULT '0',
  `expira_en` datetime NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_reset`),
  KEY `idx_correo_codigo` (`correo`,`codigo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `roles` (
  `id_rol` int NOT NULL AUTO_INCREMENT,
  `codigo` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombre` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `descripcion` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `alcance` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Delegación',
  `permisos` json DEFAULT NULL,
  `estado` enum('Activo','Inactivo') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Activo',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_rol`),
  UNIQUE KEY `codigo` (`codigo`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `sub_atenciones`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sub_atenciones` (
  `id_sub_atencion` int NOT NULL AUTO_INCREMENT,
  `codigo` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombre` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `id_tipo` int NOT NULL,
  `estado` enum('Activa','Inactiva') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Activa',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_sub_atencion`),
  UNIQUE KEY `codigo` (`codigo`),
  KEY `fk_sub_tipo` (`id_tipo`),
  CONSTRAINT `fk_sub_tipo` FOREIGN KEY (`id_tipo`) REFERENCES `tipos_atencion` (`id_tipo`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `tipos_atencion`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tipos_atencion` (
  `id_tipo` int NOT NULL AUTO_INCREMENT,
  `codigo` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombre` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `descripcion` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `estado` enum('Activo','Inactivo') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Activo',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_tipo`),
  UNIQUE KEY `codigo` (`codigo`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `usuario_delegaciones`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuario_delegaciones` (
  `id_usuario` int NOT NULL,
  `id_delegacion` int NOT NULL,
  PRIMARY KEY (`id_usuario`,`id_delegacion`),
  KEY `fk_ud_delegacion` (`id_delegacion`),
  CONSTRAINT `fk_ud_delegacion` FOREIGN KEY (`id_delegacion`) REFERENCES `delegaciones` (`id_delegacion`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_ud_usuario` FOREIGN KEY (`id_usuario`) REFERENCES `usuarios` (`id_usuario`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `usuarios`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuarios` (
  `id_usuario` int NOT NULL AUTO_INCREMENT,
  `rut` varchar(12) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nombre` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `correo` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `id_rol` int NOT NULL,
  `id_delegacion_activa` int NOT NULL,
  `estado` enum('Activo','Inactivo') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Activo',
  `ultimo_ingreso` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_usuario`),
  UNIQUE KEY `correo` (`correo`),
  KEY `fk_usuario_rol` (`id_rol`),
  KEY `fk_usuario_delegacion_activa` (`id_delegacion_activa`),
  CONSTRAINT `fk_usuario_delegacion_activa` FOREIGN KEY (`id_delegacion_activa`) REFERENCES `delegaciones` (`id_delegacion`) ON UPDATE CASCADE,
  CONSTRAINT `fk_usuario_rol` FOREIGN KEY (`id_rol`) REFERENCES `roles` (`id_rol`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;
