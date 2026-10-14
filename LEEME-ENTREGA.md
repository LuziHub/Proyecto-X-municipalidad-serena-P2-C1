# Cómo instalar este paquete en tu proyecto

Reemplaza el código del parche anterior. Está escrito contra tu esquema real (`sgr_laserena_db`).
El zip trae todo dentro de la carpeta `sgr-v2`: copia **su contenido** sobre tu proyecto.

## Orden recomendado (en el servidor EC2)
1. **Guardar lo que tengas**: `cd /var/www/Proyecto-X-municipalidad-serena-P2-C1 && git status` → commit de lo pendiente.
2. **Respaldo de la base**: `sudo mysqldump sgr_laserena_db > ~/respaldo_sgr_$(date +%F).sql` (en la terminal normal, no dentro de `mysql>`).
3. Copiar el contenido del zip encima del proyecto. Se reemplazan `src/app.js`, `src/routes/*`, `src/middleware/auth.js`, `src/public/*`, `src/config/permisos.js`, `src/config/modulos.js`. **No** toca `src/config/db.js` ni tu `.env`.
4. Borrar lo obsoleto si existe: `scripts/migrar-delegaciones.js` y la carpeta `controllers/` si está vacía.
5. `npm install && npm install bcryptjs nodemailer`. En `package.json` agrega: `"test": "node --test tests/"` y `"estres": "node scripts/prueba-estres.js"`.
6. Agregar al `.env` (ver `.env.example`): `JWT_SECRET` (obligatorio, `openssl rand -hex 32`) y los `SMTP_*`.
7. Revisar que `.gitignore` incluya `node_modules/`, `.env` y `resultados-estres-*.csv`.
8. `node scripts/preparar-demo.js` (simulación) → revisar → `node scripts/preparar-demo.js --aplicar --clave-demo='TuClaveDeDemostracion1'`. Crea los roles nuevos, escribe permisos y crea un usuario por rol. Anota la clave y entrégala al docente por separado.
9. `pm2 restart sgr-api --update-env` y probar en el navegador con cada usuario de demostración.
10. `npm test` (Node 22 o superior; si el servidor tiene una versión menor, córrelo en tu PC).
11. Subir a GitHub y crear la etiqueta de la entrega:
```bash
git add -A && git commit -m "Segunda evaluación: roles, permisos, CRUD, recuperación, plantillas"
git push
git tag -a entrega-2 -m "Segunda evaluación" && git push origin entrega-2
```

## Lo que SÍ se verificó
- 76 pruebas automáticas pasan. Se comprobó cambiando el código a propósito (quitar el cierre de sesión, el RUT con puntos, permisos de un rol) que las pruebas fallan cuando algo se rompe.
- Las pantallas se probaron en un navegador real (Chromium) contra la API real del proyecto con una base de prueba, iniciando sesión con los 5 roles: menús por rol, Inicio con matriz, plantillas, Ver, Cancelar, ingreso de atención, creación de usuario por un delegado, cambio de delegación, cierre de sesión (el token deja de valer) y sin errores de JavaScript.

## Lo que NO se pudo verificar (pruébalo tú)
- Las pruebas usan SQLite con la misma estructura y versiones simuladas de Express, jsonwebtoken, bcryptjs, nodemailer y SweetAlert2. **No se ejecutó contra tu MySQL real ni con las librerías reales, ni se envió un correo real.** Es lo primero que debes probar en AWS.
- El script de estrés se probó solo contra un servidor local simulado (sirve para validar el script, no el rendimiento). Los resultados reales hay que obtenerlos contra AWS.
- Normas gráficas: la página oficial no entrega el contenido. El rojo `#DB0032` y el negro `#1D1D1B` se tomaron de los archivos de logo oficiales. **La tipografía y las reglas de uso del escudo no están confirmadas.**
- La matriz de permisos es una propuesta; debe ser decisión del equipo. Se edita desde el mantenedor de Roles.

## Limitaciones conocidas
- El cierre de sesión se guarda en la memoria del proceso: si reinicias PM2, los tokens cerrados vuelven a valer hasta que venzan (8 horas).
- El solicitante de una atención es texto libre; el módulo Vecinos es solo plantilla. Si el modelo del curso define otro dato para identificar al solicitante, hay que cambiar tabla y formulario.
- `src/config/db.js` trae una IP escrita como valor por defecto; conviene quitarla y usar solo `.env`.
- Los usuarios con id 9 y 10 tienen la contraseña sin cifrar: `--clave-demo` las reemplaza.

## Pendiente de tu lado para la entrega
Completar integrantes y datos de AWS en el README · ejecutar los casos de la planilla en AWS con evidencias · definir umbrales con el docente y correr el estrés · IP elástica · cerrar el puerto SSH abierto a todo internet · tipografía y escudo según las normas gráficas oficiales.
