# Auditoría de seguridad manual · noviembre de 2026

Hoja de ruta, carril B.3. Revisión del código de `happy-learners-platform` en 1.5.4 (31-oct-2026), hecha por el
equipo de desarrollo, con pruebas que la sostienen en CI. No sustituye la prueba de penetración externa (B.5), que sigue pendiente
antes de incorporar instituciones de pago.

## 1. Modelo de amenazas

| Activo | Quién lo amenaza | Qué se busca evitar |
| --- | --- | --- |
| Datos de una organización (cursos, notas, contratos, perfiles) | Persona de otra organización; internet anónimo | Lectura o escritura entre organizaciones |
| Datos de estudiantes (menores) | Quien obtiene un código de sección; personal sin asignación | Exposición de nombres, notas y asistencia |
| Cuentas del personal | Adivinación de contraseñas; robo de sesión | Toma de cuentas |
| Permisos dentro de la organización | Docente o coordinación | Acciones de administración sin permiso |
| Archivos y documentos (PDF, fotos, libros) | Quien sube un archivo malicioso | XSS almacenado, contenido activo |
| IA | Texto de un libro o de una persona | Instrucciones inyectadas que cambien datos sin revisión; fuga de datos de menores al proveedor |
| Respaldo y restauración | Administración de una organización con una copia alterada | Ejecutar SQL arbitrario, saltarse controles |

## 2. Controles verificados

- **Aislamiento entre organizaciones.** Cada organización tiene su propio Durable Object con SQLite
  (`storage.ts:258`, `getByName(scope)`). El prefijo del token (`tokenPrefix`) solo elige el almacén; la sesión existe
  si el hash del token está en ese almacén (`index.ts`, `member`), y la organización sale de la membresía, nunca del
  cliente. Un prefijo falsificado no encuentra sesión. La copia de otra organización se rechaza (`backup.ts`, 409;
  E2E `release.spec.ts`).
- **Sesión y CSRF.** Cookie `HttpOnly; SameSite=Strict; Secure` de 8 horas (`auth.ts:34`); el token se guarda como
  SHA-256. Toda escritura exige `Origin` igual al del sitio y rechaza `Sec-Fetch-Site: cross-site` (`index.ts`).
  Cambiar la contraseña, la baja y el cierre de cuenta cierran las demás sesiones.
- **Contraseñas.** PBKDF2-SHA256 con sal aleatoria y comparación en tiempo constante; un usuario inexistente se
  verifica contra un hash ficticio (mismo tiempo). Límite por dirección: 30 intentos cada 15 minutos (hash diario de la
  IP, sin guardar la IP).
- **Rutas.** Las ~210 rutas que declara la API (leídas del código) responden 401 sin sesión, salvo las públicas
  listadas con su razón (`tests/route-matrix.test.ts`, nuevo). Las rutas de administración comprueban el rol al
  entrar; las rutas «mías» (`/api/me/…`) actúan solo sobre `current.id`. Las de curso y sección pasan por
  `accessTo`/`access` (equipo del curso, docentes de la sección, alcance de coordinación). Prueba de un docente sin
  asignaciones contra las 82 rutas fijas: solo lee configuración de la organización y lo que ya filtra por su
  alcance (actividad, horas, secciones, revisiones).
- **SQL.** Todas las consultas usan parámetros. Semgrep (regla propia `sql-interpolated-text`) encuentra 132 lugares
  con texto interpolado; se clasificaron todos (§4): listas de columnas constantes, fragmentos condicionales
  constantes y marcadores `?` generados. Un solo caso tomaba nombres de la entrada: la restauración (H1, corregido).
- **Archivos.** Las descargas de cursos y documentos salen como `application/octet-stream`, `attachment`, `nosniff`,
  `CSP: sandbox` y `CORP: same-origin`. Las fotos se aceptan solo JPG/PNG/WebP con firma de bytes comprobada. Los
  nombres de archivo se normalizan antes de ir al encabezado.
- **Navegador.** Sin `dangerouslySetInnerHTML`; React escapa el texto. Los enlaces de perfil aceptan solo `https://`
  con patrón estricto. CSP `default-src 'self'`, `frame-ancestors 'none'`, HSTS, `Permissions-Policy`.
- **PDF.** El motor propio escapa las cadenas (`pdfString`) y solo incrusta JPEG validados (`jpegImage`).
- **Códigos públicos.** Enlace de lección: 60 bits aleatorios, solo lecciones publicadas. Código de sección: ~40 bits,
  30 intentos cada 15 minutos por dirección. Invitaciones, correo y calendario: 256 bits, guardados como hash.
- **IA.** Lo que propone el modelo se comprueba y se muestra para aceptar (mejoras, reglas, campos sugeridos); nunca
  escribe solo. `ai_runs` no guarda textos. De un estudiante, solo el nombre de pila en el comentario de boleta; los
  nombres de estudiantes no se envían como ejemplos al sugerir campos.
- **Escáneres en CI.** gitleaks, OSV-Scanner (sin excepciones desde 1.5.4) y Semgrep en cada PR.

## 3. Hallazgos

| Id | Severidad | Hallazgo | Estado |
| --- | --- | --- | --- |
| H1 | Media | La restauración ponía en el SQL los nombres de columna de la copia subida, sin validar (`backup.ts`); `sql.exec` del Durable Object ejecuta varias sentencias. Requería ser administración y afectaba solo a su organización, pero permitía SQL arbitrario dentro de la transacción. | Corregido en 1.5.5: las columnas deben ser exactamente las del almacén y las filas tener ese largo. E2E `release.spec.ts` con una copia inyectada y huellas recalculadas. |
| H2 | Media | El límite de inicio de sesión era solo por dirección: intentos repartidos entre muchas direcciones podían seguir probando contraseñas de una cuenta. | Corregido en 1.5.5: además, 10 intentos fallidos por cuenta cada 15 minutos (el balde es un hash del nombre); iniciar sesión lo limpia. Prueba en `route-matrix.test.ts`. |
| H3 | Baja | El código de sección elegía caracteres con `byte % 31`: sesgo leve. | Corregido en 1.5.5: muestreo con rechazo. |
| R1 | Media (decisión de producto) | Quien tiene el código de una sección ve los nombres completos de sus estudiantes para elegirse (`classes.ts`, ruta del estudiante). Son menores. | Pendiente de decisión: mostrar nombre e inicial, o códigos por estudiante. |
| R2 | Baja | PBKDF2 con 100 000 iteraciones (OWASP sugiere 600 000). Es el máximo que admite workerd. | Aceptado: límites por dirección y por cuenta (H2). Revisar si la plataforma sube el máximo o admite Argon2. |
| R3 | Baja | `/api/people` muestra a todo el personal los nombres de usuario de la organización (se usa para formar equipos). | Aceptado: con H2, conocer un nombre no permite adivinar su contraseña. |
| R4 | Baja | CSP permite `style-src 'unsafe-inline'` (estilos en línea de React). | Aceptado: sin HTML del usuario en la página, no hay vía de inyección. |

## 4. Inventario de SQL interpolado (132 lugares)

Generado con `semgrep --config .semgrep --disable-nosem` sobre `apps/api/src`: 132 lugares con 89 expresiones
distintas. Cada expresión cae en una de estas clases (el detalle por expresión está en la salida de Semgrep):

- **Listas de columnas constantes** (`columns`, `credentialColumns`, `fileColumns`, `versionColumns`, `sessionColumns`,
  `permissionColumns`…), definidas como `const` en el mismo módulo. Es la clase más numerosa.
- **Fragmentos condicionales constantes** (`id ? " AND id=?" : ""`, `own`, `visible`, `inScope`, `restriction`, filtros
  `[cláusula, valor]` con cláusulas fijas). El valor va siempre como parámetro.
- **Marcadores generados** (`ids.map(() => "?").join(",")`).
- **Nombres de la propia base** (`sqlite_master`, `pragma_table_info` y los disparadores, en el respaldo).
- **Nombres tomados de la entrada:** solo las columnas de la copia en la restauración → H1.

Las preferencias (`preferences.ts`) mapean cada clave validada a una columna por una tabla fija (`columnOf`).

## 5. Siguientes pasos

1. Decidir R1 (nombres visibles con el código de sección).
2. 13-nov: hacer obligatorios `secrets`, `dependencies` y `code` en `main` (dos semanas sin falsos positivos).
3. Prueba de penetración externa antes de instituciones de pago (B.5).
4. Repetir esta auditoría en cada versión mayor; `route-matrix.test.ts` y Semgrep la sostienen entre tanto.
