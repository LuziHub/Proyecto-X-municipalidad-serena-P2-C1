# Matriz SGR en el sistema (reemplaza la planilla Excel)

## Instalación (después de copiar el código)
1. Respaldo: `sudo mysqldump sgr_laserena_db > ~/respaldo_sgr_$(date +%F).sql`
2. Crear tablas (solo agrega, no borra; los dos son repetibles):
   `mysql -u root -p sgr_laserena_db < database/03_matriz.sql`
   `mysql -u root -p sgr_laserena_db < database/04_matriz_ampliacion.sql`
3. Cargar período, ítems, cargos y metas: `node scripts/preparar-matriz.js` (simulación) y luego `node scripts/preparar-matriz.js --aplicar`.
   Los roles que ya existen reciben los módulos nuevos sin perder los que tenían.
4. Solo para demostración: `node scripts/preparar-matriz.js --aplicar --clave-demo='...' --datos-demo` crea un usuario por cargo (`apoyo@demo.sgr.cl`, `organizaciones@…`, `social@…`, `planificacion@…`, `servicios@…`, `seguridad@…`, `compras@…`) con gestiones y tubo **ficticios**.
5. (Opcional) Cargar el catálogo de organizaciones desde tu planilla de JJVV, **desde tu computador o el servidor, sin subirla al repositorio**:
   `node scripts/importar-jjvv.js ruta/base_datos_JJVV.xlsx` (simulación) y luego con `--aplicar`.
   Informa organizaciones leídas, repetidas, sin domicilio y sin territorio. Con tu planilla da: 2.709 leídas, 2.708 a cargar, 1 repetida, 22 sin territorio.
6. `pm2 restart sgr-api --update-env`

## Reglas del correo y dónde están implementadas
| # | Regla | Cómo se aplica |
|---|---|---|
| 1 | Si el usuario atendido es el delegado, no puntúa | Casilla «el usuario es el delegado» y detección por nombre contra los delegados de la delegación. Se guarda como gestión, sin puntaje. |
| 2 | Sin nombre y teléfono del usuario, no puntúa | Solo en los ítems marcados «exige contacto» (Metas por cargo). Teléfono validado. |
| 3 | Máximo 7 gestiones por día | Por persona y día (parámetro del período). **Supuesto:** las emergencias no cuentan para el tope. |
| 4 | Cierre semanal | La semana anterior se puede ingresar hasta el martes siguiente (parámetro «día de cierre»). También rige para editar y eliminar. Fechas futuras no se aceptan. |
| 5 | Coordinación previa no puntúa | Casilla «es una coordinación previa». |
| 7 | Tope 120 % por ítem | Parámetro del período (`tope_item`). |
| 8 | Felicitaciones y reclamos solo por el delegado, con respaldo formal | Módulo propio; exige medio formal y respaldo; no a sí mismo. Felicitación +10 % (máx. 3); reclamo resta (−20 % o −30 % según cargo). |
| 9 | Licencias, vacaciones y ausencias las ingresa el delegado | Módulo propio; los días ausentes bajan el objetivo del semáforo. |

(Los puntos 6 y 10 del correo son criterios de evaluación, no reglas técnicas, y por eso no se programaron.)

## Puntaje y semáforo
- Ítem: avance ÷ meta, con tope 120 %, por su ponderador. Emergencia: 100 % si hubo al menos una. Tubo: % de gestiones realizadas ÷ meta (80 %).
- Total = suma de ítems + felicitaciones (tope 150 % por colaborador) − reclamos.
- Objetivo de hoy = (días transcurridos − días de ausencia) ÷ días del período. Verde: total ≥ objetivo; Naranjo: ≥ 60 % del objetivo; Rojo: menos. **Supuesto:** días corridos.

## Tubo
Ingresado → Pendiente → En proceso → Realizado, solo hacia adelante. Se crea desde una gestión («ingresar al tubo») o directamente. Es compartido por toda la delegación; solo el responsable (o quien vea al equipo) avanza el estado.

## Cargos y permisos
Apoyo Administrativo, Organizaciones Comunitarias, Gestor Social, Gestión y Planificación, Coordinador de Servicios Comunitarios, Seguridad y Compras. Cada cargo registra y ve lo suyo; «Gestión y Planificación», el Delegado y el Consultor ven al equipo. Metas y períodos los administra la Coordinación desde «Metas por cargo» y «Períodos» (no hay que tocar código).

## Puntos que hay que decidir o revisar con la municipalidad
- **Planilla:** la primera fila de cada hoja trae un 100 % fijo escrito a mano; aquí el avance se calcula de las gestiones registradas.
- **Conflicto 120 % / 150 %:** el correo habla de 120 % y la planilla de 150 %. Se aplicó 120 % por ítem y 150 % como tope total por colaborador (ambos configurables). Con los ponderadores actuales el máximo real es 149 %.
- **Gestión y Planificación:** sus ponderadores suman 85 %, no 100 %. Se respetó la planilla y el sistema muestra una advertencia.
- **Compras:** la planilla no trae metas; no puede registrar gestiones hasta que se carguen.
- **Gestor Social:** en la planilla las columnas de las gestiones 3 a 5 están desplazadas; se tomaron los valores por su encabezado.
- Los ítems marcados «exige contacto» son una propuesta; se ajustan en «Metas por cargo».

## Ampliación (segunda parte)
- **Código de la matriz:** cada gestión recibe `ÁREA + mes + día + número` (ej. `APA711`), donde el número es correlativo del funcionario en el período. Las gestiones del Gestor Social llevan `SOC-00001` en vez de `GES-00001`, y el tubo muestra ese enlace.
- **Foto e imagen verificada:** la gestión guarda el código de la foto; solo la jefatura (quien registra felicitaciones y reclamos) marca la imagen como verificada, nunca el propio funcionario. **Decisión:** la planilla no explica qué significa el «100» de «Imagen verificada = SI», así que por defecto la verificación es una marca que no cambia el puntaje. Si la municipalidad quiere que solo cuenten las verificadas, se activa en el período («Solo cuentan las gestiones con imagen verificada») sin tocar código.
- **Tubo de cartas (Oficina de Partes):** módulo con código `CAR-00001`, estados En proceso / Aprobada / Finalizada / No aplica, pronunciamiento, derivación y resumen por estado (el total no cuenta «No aplica», como en la planilla). Lo registra la jefatura; los cargos lo ven.
- **Catálogo de organizaciones:** juntas de vecinos, clubes y centros de madres, con importador. El tubo permite buscar la organización al escribir; completa el solicitante y el territorio. No se puede borrar una organización que está en uso.
- **Cargo Delegado:** el descriptor lo incluye, pero la matriz no trae metas para él, así que no se inventaron: se cargan desde «Metas por cargo» cuando la municipalidad las defina.

## Pendiente
- Los puntos 6 y 10 del correo son criterios de evaluación, no reglas técnicas, y no se programaron.
- Las cartas no puntúan en la matriz (la planilla no las pondera).
- **Datos personales:** la planilla real trae nombres y teléfonos; no deben subirse al repositorio.
