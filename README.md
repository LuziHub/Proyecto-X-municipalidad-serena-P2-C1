# Sistema de Gestión y Registro (SGR) — Municipalidad de La Serena
Proyecto Integrado · Ingeniería en Informática · INACAP La Serena · Segunda evaluación

## Integrantes
- Luciano Marcelo Balbontín Saavedra
- _(agregar a los demás integrantes del equipo)_

## Descripción
Plataforma web institucional para la gestión de atenciones ciudadanas por delegación municipal: acceso con roles y permisos, mantenedores de catálogos, ingreso de atenciones y exportación a Excel. Las alertas y confirmaciones usan SweetAlert2.

## Tecnología y requisitos
- Node.js 22 o superior (las pruebas usan `node:test` y `node:sqlite`) · Express · MySQL 8 · PM2 (despliegue)
- Dependencias: `express`, `cors`, `dotenv`, `mysql2`, `jsonwebtoken`, `bcryptjs`, `nodemailer`
- Interfaz: HTML + Tailwind (CDN) + SweetAlert2 + Font Awesome

## Estado de cada módulo
| Módulo | Estado |
|---|---|
| Login (correo o RUT), cierre de sesión | Operativo |
| Recuperación de contraseña (correo → código → nueva clave) | Operativo (el envío de correo requiere `SMTP_*` en `.env`) |
| CRUD Delegaciones, Roles, Usuarios, Ítems y metas, Tipo de Atención, Sub Atención | Operativo |
| Ingreso de atención (tipo → sub atención, delegación y responsable desde la sesión) | Operativo |
| Roles y permisos, delegación activa, exportación a Excel | Operativo |
| Vecinos, Tipo de Gestión, Verificación de evidencias, Alertas, Reportes | **Simulado**: plantilla de interfaz con datos ilustrativos, sin persistencia |

Detalle completo y pendientes: `docs/Plan_y_registro_de_pruebas_SGR.xlsx` (hoja «Resumen»).

## Roles de demostración
| Rol | Alcance | Qué puede hacer |
|---|---|---|
| Superadministrador | Global | Todo, en todas las delegaciones activas |
| Coordinador | Autorizado | Ver/exportar atenciones, delegaciones y usuarios; crear y editar catálogos; sin Roles |
| Delegado municipal | Delegación | Atenciones y usuarios de su delegación; solo asigna roles de igual o menor permiso |
| Funcionario | Delegación | Registrar y consultar atenciones |
| Consultor | Lectura | Solo consulta y exportación |
| Administrador, Operador | (ya existentes en la base) | Control total en sus delegaciones / registro de atenciones |

Los permisos viven en `roles.permisos` (JSON) y se editan desde el mantenedor de Roles. El servidor los valida en **cada** solicitud (lo no otorgado queda denegado) y nadie puede otorgar más permisos, roles o delegaciones de los que tiene. La pantalla **Inicio** muestra la matriz de permisos del rol con que se ingresó.

Usuarios de demostración (los crea `scripts/preparar-demo.js`): `superadmin@`, `coordinador@`, `delegado@`, `funcionario@`, `consultor@` + `demo.sgr.cl`. La contraseña **no** se publica en el repositorio: se entrega al docente por separado.

## Estructura
- `src/app.js` servidor · `src/routes/` (`auth.js`, `crud.js`) · `src/middleware/auth.js` · `src/config/` (`permisos.js`, `modulos.js`, `db.js`) · `src/utils/`
- `src/public/` interfaz (`index.html`, `recovery.html`, `dashboard.html`, `sgr.css`, `sgr.js`)
- `database/01_schema.sql` esquema · `database/02_permisos_demo.sql` roles y permisos (sin contraseñas)
- `scripts/preparar-demo.js` prepara la base · `scripts/prueba-estres.js` pruebas de estrés
- `tests/` pruebas automáticas · `docs/` planilla de pruebas funcionales, estrés y defectos

## Instalación y configuración
```bash
npm install
cp .env.example .env     # completar DB_*, JWT_SECRET (openssl rand -hex 32) y SMTP_*
mysql -u <usuario> -p < database/01_schema.sql    # SOLO en una base nueva (contiene DROP TABLE)
node scripts/preparar-demo.js                      # simulación: muestra qué cambiaría
node scripts/preparar-demo.js --aplicar --clave-demo='<clave de demostración>'
npm start
```
`.env.example` no contiene secretos. El archivo `.env` está excluido del repositorio.

## Despliegue en AWS
- **Servicios:** EC2 (Ubuntu) con Node.js y PM2, MySQL en la misma instancia, Security Group con puertos 3000 (aplicación) y 22 (SSH, restringido a IP del equipo). _(completar: tipo de instancia, región, IP elástica, dominio si existe)_
- **Actualizar la versión:**
```bash
cd /var/www/Proyecto-X-municipalidad-serena-P2-C1
git pull && npm install
pm2 restart sgr-api --update-env
```
- **Verificar:** `GET /api/status` responde y el login funciona; el commit/tag desplegado debe coincidir con el entregado (`git describe --tags`).

## Pruebas
- **Automáticas:** `npm test` (76 pruebas: permisos por rol, delegaciones, login, recuperación, CRUD, exportación, anti-escalamiento). Usan una base SQLite con la misma estructura y no reemplazan la validación en AWS.
- **Funcionales manuales:** `docs/Plan_y_registro_de_pruebas_SGR.xlsx` (hoja «Pruebas funcionales»: requisito, módulo, precondiciones, pasos, esperado, obtenido, estado, evidencia, responsable, fecha) y hoja «Defectos».
- **Estrés:** `node scripts/prueba-estres.js --url=http://<IP>:3000 --correo=<usuario con permiso de exportar> --clave=... --niveles=5,10,20,40,80`. Registra los resultados en la hoja «Pruebas de estrés». `--escritura` crea datos de prueba.
