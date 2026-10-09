# Sistema de Gestión y Registro (SGR) - Municipalidad de La Serena
Proyecto Integrado | Ingeniería en Informática - INACAP La Serena

## Integrantes
- Luciano Marcelo Balbontín Saavedra

## Descripción del Proyecto
Plataforma web institucional para la gestión de atenciones ciudadanas, control de delegaciones municipales, mantenedores de catálogos y validación de evidencias con trazabilidad y alertas institucionales (SweetAlert2).

## Estructura del Proyecto
- `src/app.js`: Servidor principal con Node.js y Express.
- `src/routes/api.js`: Endpoints REST para autenticación y los 6 mantenedores exigidos.
- `src/public/`: Interfaz de usuario (Frontend SPA basado en normas gráficas institucionales).
- `database/`: Script SQL de la base de datos relacional (`sgr_laserena_db`).

## Configuración y Despliegue en AWS (Placeholders)
1. Configurar las variables de entorno en el archivo `.env` tomando como base `.env.example`.
2. Apuntar el `DB_HOST` al Endpoint de AWS RDS cuando esté disponible.
3. Ejecutar `npm install` para instalar dependencias y `npm start` para iniciar el servidor en producción o en una instancia EC2 de AWS.