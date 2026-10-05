# Changelog

## 0.8.3 — 2026-10-04

Parche de REL-004 (DEC-020): nombres del aula alineados con el uso del equipo docente.

- ST-027 / HL-48: la página que programa qué lección publicada usa cada grupo y en qué fechas se llama Cronograma (`/cursos/:id/cronograma`). Los enlaces anteriores a Asignaciones redirigen. Inicio muestra «Tu cronograma vigente» y el espacio del grupo, «Lecciones del cronograma».
- Asignación significa ahora la inscripción de un estudiante en el curso: se asigna al agregarlo a la lista de un grupo. La Ayuda y la página Grupos lo explican.
- Sin cambios de datos, permisos ni API.

## 0.8.2 — 2026-10-04

Parche de REL-004 (DEC-019): el ciclo de una clase queda completo y el grupo la sigue con su código.

- ST-035 / HL-61 y ST-097: planificar una clase con grupo, fecha, hora, duración, lección publicada, hasta 20 recursos de la biblioteca y notas; comenzarla, pasar lista, finalizarla con la lista completa, cancelarla y reprogramarla. Solo el equipo del curso lo hace (ST-096 se conserva).
- ST-036 / HL-62 y ST-071: próximas clases con hora y estado en Inicio y en el curso; historial con asistencia, quién impartió y la publicación usada; indicadores de clases impartidas, asistencia promedio y clases sin registrar.
- ST-070: nombres de grupos y participantes editables.
- ST-098: cada grupo tiene un código. Sin cuenta ni datos personales, el estudiante ve su próxima clase, abre sus recursos y las lecciones asignadas; el código se rota o desactiva.
- Biblioteca general: agregar y editar recursos de cualquier curso activo, como antes de v0.2.3.
- La sección Asistencia se integra en Clases; los enlaces anteriores redirigen.
- Pruebas E2E del ciclo completo de la clase, del ciclo de vida del grupo, del espacio del grupo y de la biblioteca general, en escritorio y móvil.

## 0.8.1 — 2026-10-04

Parche de seguridad de REL-004 (DEC-018): dos defectos HIGH de autorización, corregidos en el servidor con denegación por defecto.

- ST-072 / HL-115: solo administración cambia el equipo docente de un curso. La persona responsable y los educadores lo ven en modo lectura; cada cambio queda en la actividad del curso.
- ST-096 / HL-140: solo el equipo docente del curso consulta y administra sus grupos, participantes, clases, asignaciones y asistencia. Un educador ajeno al equipo y administración reciben 403, y la interfaz no les ofrece esas secciones.
- Entrega: un commit solo de documentación ya no redespliega el Worker, y la verificación horaria compara producción con el último despliegue exitoso (HL-15 / ST-049).

## 0.8.0

El educador asigna y prepara contenido de principio a fin; el estudiante recibe la publicación vigente.

- ST-027 / HL-48: Asignar contenido publicado
- ST-032 / HL-41: Identificar la siguiente lección
- ST-016 / HL-45: Duplicar una lección
- ST-069 / HL-112: Insertar tablas en una lección
- ST-029 / HL-50: Resolver la publicación efectiva

Manifest: MNF-0ae9e87bc9028667bd8e

## 0.7.1 — 2026-10-02

- Corrección: al responder bien una pregunta, el mensaje «¡Correcto!» se mostraba en vertical. Heredaba la regla `.correct` del editor (el control de 44 px que marca la opción correcta). La regla queda limitada a ese control y una prueba E2E comprueba que el mensaje ocupa el ancho de la tarjeta.

## 0.7.0 — 2026-10-02

Organización de demostración completa, equipos docentes e historial de actividad (HL-44 / ST-041).

- **Equipo docente:** cada curso tiene una persona responsable y colaboradores. Se ve en las tarjetas y el resumen del curso, se gestiona en **Configuración → Equipo docente** y se filtra en **Cursos** por responsable. Quien crea un curso queda como responsable.
- **Historial de actividad:** se registra quién creó o actualizó cursos, programas, módulos, competencias, resultados, recursos y lecciones; quién planificó, publicó, archivó o subió archivos; y quién registró clases y pasó lista. Aparece con autor en Inicio (*Actividad en mis cursos*), en el resumen del curso y en Educadores.
- **Avance:** *Mis cursos* en Inicio muestra lecciones publicadas, resultados evaluados y asistencia de los cursos en que participas. **Educadores** muestra, por persona, cursos, lecciones creadas, publicaciones, clases registradas y última actividad, junto al avance de cada curso.
- **Nombres visibles** de las personas en la barra superior, los equipos y la actividad.
- **Seed de demostración** (`0015_demo_organization.sql`, generado por `scripts/seed/build.mjs`):
  - Colegio Horizonte con 6 personas (1 coordinación y 5 educadores) y 3 programas.
  - 6 cursos con plan curricular, módulos, 32 lecciones con actividades compuestas y notas docentes, y 15 recursos etiquetados.
  - 7 grupos con 102 participantes ficticios, 76 clases con 884 registros de asistencia, 447 finalizaciones y 224 eventos de historial.
  - Incluye estados variados: borradores, cambios sin publicar, un hueco curricular y un curso archivado.
  - Guía en `docs/demo/organizacion-demo.md`.
- **Migraciones:** `0014_course_teams_activity.sql` (nombres, `course_members` con un único responsable, `activity_events`). Las migraciones grandes se ejecutan por partes para respetar el límite de longitud SQL de Durable Objects.
- **Correcciones móviles:** las cuadrículas, pilas y paneles ya no desbordan en pantallas de 390 px.

## 0.6.0 — 2026-10-01

Rediseño con Fluent Design de Microsoft (HL-44 / ST-041). Sin cambios de API ni de datos.

- **Tokens oficiales de Fluent 2** (`@fluentui/tokens`) generados en `fluent/tokens.css` con la rampa de marca violeta. `theme.css` traduce cada token de la app a uno de Fluent: neutros, paletas, estados, rampa de sombras, radios, duraciones, curvas y tipografía.
- **Luz:** las tarjetas y los paneles se iluminan bajo el puntero, y el foco usa el indicador de Fluent.
- **Profundidad:** rampa de sombras 2/4/8/16/28/64 según la jerarquía.
- **Movimiento:** entradas que desaceleran, salidas que aceleran y cambios de estado suaves, sin rebotes. Respeta el movimiento reducido.
- **Material:** acrílico en la barra superior, los menús, el cajón móvil y el inicio de sesión; mica en la capa base. Se vuelve sólido sin soporte de desenfoque o con transparencia reducida.
- **Escala:** Segoe UI Variable con la fuente del sistema como respaldo, rampa tipográfica de Fluent, controles de 36 px (44 px táctiles) y esquinas de 4, 8 y 12 px. Se retiran las fuentes Inter y Plus Jakarta Sans.
- **Componentes Fluent:**
  - Botones: principal, secundario, sutil y peligro.
  - Campos con subrayado de marca al enfocar y pestañas segmentadas con indicador.
  - Menús y toasts como flyouts.
  - Diálogos con sombra 64.
  - Navegación con indicador de selección e icono relleno.
  - Insignias, barra de progreso, tarjetas y paneles.
- **Iconos:** Fluent System Icons (`@fluentui/react-icons`).
- **Guía de estilo** en la aplicación (`/guia-de-estilo`) y documentación en `docs/design/fluent.md`.
- **Pruebas nuevas:** los tokens generados no se desvían del paquete, cada token semántico apunta a uno de Fluent y los componentes no tienen colores literales. La guía de estilo entra en la auditoría axe.
- **Correcciones:** el menú de un módulo ya no se recorta dentro de su tarjeta y el diálogo queda centrado en móvil.

## 0.5.0 — 2026-10-01

Modelo académico (HL-44 / ST-041). La configuración del curso pasa de etiquetas libres a dimensiones estándar con consecuencias reales.

- **Dimensiones estándar:** tipo de educación y nivel según la CINE 2011 de la UNESCO (de primera infancia a doctorado; "Sin nivel" solo en no formal), área de conocimiento CINE-F 2013, formato (Asignatura, Curso libre, Taller, Laboratorio, Seminario), modalidad y ritmo. Sustituyen al "perfil" y a la clasificación "Disciplina" de los cursos.
- **Programas:** conjuntos de cursos que comparten tipo, nivel, modalidad y ritmo, dan valores a sus ajustes y pueden fijarlos. Los administra la organización en **Configuración académica**.
- **Comportamiento configurable con herencia:** nombre de las partes del curso, secuencia didáctica inicial, grupos y asistencia, y requisitos para publicar (resultados de aprendizaje y comprobación). Cada valor viene del tipo de curso, del programa o del propio curso, y la pantalla dice de dónde. El servidor aplica los requisitos al publicar y desactiva el registro de asistencia cuando corresponde.
- **Nomenclatura:** "Módulo" es el nombre estándar de las partes de un curso; cada curso o programa puede usar Unidades, Semanas, Sesiones, Temas o Bloques, con concordancia de género en toda la interfaz.
- **Plantillas de inicio** al crear un curso, filtros con conteos en **Cursos** (programa, nivel, formato, área, modalidad) y en **Biblioteca** (etiqueta, área).
- **Clasificaciones** se convierte en **Configuración académica**: programas, etiquetas de la biblioteca y estándares de referencia. La dirección anterior redirige.
- Migración `0013_academic_model.sql`: tabla `study_programs`, dimensiones y ajustes en `courses`, disparadores que impiden mezclar organizaciones y traducción de cada perfil anterior. Conserva el comportamiento de los cursos existentes; las columnas antiguas quedan como historial.

## 0.4.0 — 2026-10-01

Marco curricular (HL-44 / ST-041). Segunda fase del rediseño curricular.

- **Plan curricular** del curso: competencias, resultados de aprendizaje con nivel de pensamiento y evidencia, códigos RA1, RA2… en orden y archivado sin perder historial.
- **Mapa de cobertura:** resultados por unidad (planificado, trabajado en lecciones, evaluado), lo pendiente en cada unidad y una acción para cada hueco: crear una lección ya alineada o agregar evaluación donde ya se trabaja.
- **Alineación en el editor:** resultados de la lección (marcando los planificados en su unidad) y de cada actividad; recursos sugeridos por los resultados; recomendaciones antes de publicar con confirmación si quedan pendientes.
- **Estudiantes:** "Lo que aprenderás" muestra lo que podrán hacer al terminar, con el texto vigente al publicar.
- Resumen del curso con el estado del plan; duplicar un curso copia también su plan.
- Migración `0012_curricular_framework.sql`: tablas `course_competencies`, `course_outcomes` y `unit_outcomes`, limitadas al curso y su organización, y un plan de ejemplo para el curso de demostración (2 competencias y 3 resultados). No modifica lecciones.

## 0.3.0 — 2026-10-01

Secuencia didáctica y actividades compuestas (HL-44 / ST-041). Primera de dos fases del rediseño curricular.

- Cada lección sigue una secuencia didáctica: Inicio · Desarrollo · Cierre, 5E, Presentación · Práctica · Producción, Demostración · Práctica guiada · Práctica independiente o Libre. Las lecciones nuevas toman la del perfil del curso; las existentes quedan en Libre hasta que se elija otra. Al cambiar de secuencia las actividades conservan su orden.
- El editor agrupa las actividades por momento, con su intención, número de actividades y minutos; cada momento termina con un botón para agregar ahí. Subir y bajar cruzan de un momento al siguiente; el menú mueve a cualquier momento.
- Una actividad tiene propósito (explicar, explorar, practicar, evaluar, reflexionar), organización (individual, parejas, equipos, toda la clase), minutos y hasta 12 bloques ordenados: texto, recurso, pregunta o nota para el docente.
- Las notas para el docente nunca se publican: se quitan de la versión publicada y de la vista previa.
- El estudiante ve los momentos de la lección al empezar, el momento de cada actividad, su propósito y organización, y todos los bloques en orden.
- Compatibilidad: las actividades anteriores se leen como un bloque que conserva su ID, su texto colaborativo y su recurso; no hay migración de datos.

## 0.2.7 — 2026-10-01

- Seguridad: las páginas HTML reciben la misma Content-Security-Policy y cabeceras de seguridad que la API (`apps/web/public/_headers`). Antes, Workers Static Assets servía las páginas sin CSP porque solo `/api/*` pasa por el Worker.
- `font-src 'self' data:` permite las subfuentes que el build incrusta.
- Las pruebas E2E fallan si el navegador bloquea algo por CSP, y una prueba del paquete exige que la política de páginas y API sea idéntica.

## 0.2.6 — 2026-10-01

- Editor de lección como lienzo continuo: todas las actividades una tras otra, con puntos para insertar contenido, recurso o pregunta en cualquier posición y una sola barra de formato fija. El autoguardado indica "Borrador guardado"; los estudiantes ven la versión publicada hasta que publiques.
- Visor de archivos que ocupa todo el espacio disponible, con paginado y pantalla completa; las presentaciones se muestran diapositiva a diapositiva.
- Nuevos formatos: PDF (hasta 25 MB) y video MP4/WebM (hasta 100 MB). Se suben en streaming y R2 verifica su huella SHA-256; la firma de cada formato se valida. Migración `0011_pdf_video_files.sql`.
- Diseño estándar de página: el contenido empieza junto al menú lateral con un margen compacto.

## 0.2.5 — 2026-10-01

- Migración `0010_remove_legacy_e2e_records.sql`: elimina de la demo pública los registros de una ejecución E2E antigua (2 unidades, 2 lecciones con sus 2 finalizaciones, 2 niveles, 2 módulos y 2 recursos con sufijo `desktop-1790700257067` / `mobile-1790700278802`). Borrado autorizado el 2026-10-01; la copia previa se adjunta a la release.

## 0.2.4 — 2026-09-30

Tema visual moderno (HL-44 / ST-041). Sin cambios de API ni datos.

- Tema completo en `theme.css`: neutros fríos, violeta de marca y seis tonos (cielo, turquesa, rosa, coral, ámbar, verde) con variantes de texto, tinte y relleno, degradado de marca, tipografía, espaciado, radios, sombras y motion.
- Color con sentido: cada sección, curso, unidad, tipo de actividad y tipo de recurso tiene su tono estable.
- Tipografías autoalojadas: Inter y Plus Jakarta Sans.
- Inicio con encabezado que resume el día y contadores de colores; tarjetas de curso con portada; espaciado más compacto.
- Editor de texto tipo Docs: barra de iconos agrupada, enlace en línea, hoja con ancho de lectura, marcador de posición y contador de palabras.

## 0.2.3 — 2026-09-30

Reconstrucción de la experiencia de producto (HL-44 / ST-041). La API, los contratos y los datos no cambian.

- Un solo sistema de navegación: barra superior (marca, organización, búsqueda, ayuda, perfil) y un sidebar que cambia de contexto al entrar en un curso; en móvil se abre como panel.
- Inicio útil: continuar trabajando, cursos recientes, próximas clases, estado de las lecciones, acciones rápidas y actividad reciente.
- Cursos con tarjetas compactas, progreso de publicación, búsqueda y menú para editar, duplicar o archivar.
- Contenido unificado: unidades y lecciones en un outline con expandir, crear, renombrar en línea, reordenar con teclado y archivar.
- Editor de lección con autosave visible, outline de actividades, vista previa y una acción principal por estado.
- Biblioteca del curso y biblioteca global con búsqueda, filtros, uso en lecciones y vista previa; grupos → clases → asistencia con confirmación inmediata.
- Lección del estudiante móvil primero: una actividad a la vez, avance y cierre claro.
- Sesión expirada sin perder el trabajo en pantalla; errores que explican cómo recuperarse.
- Corrección: las actividades antiguas sin ID ya no se vacían al guardar una lección colaborativa.
- Sistema visual con tokens y primitivas propias; auditoría axe WCAG 2.2 AA en las pruebas E2E.

## 0.2.0 — 2026-09-29

Primera versión utilizable para organizar materiales y preparar una clase.

- Biblioteca persistente de recursos con título, descripción, nivel, habilidad, tema, etiquetas y contenido.
- Creación de lecciones en borrador y publicación con código de acceso.
- Consulta desde teléfono sin pedir datos personales al estudiante.
- Registro únicamente agregado de finalizaciones.
- Migración reversible `0002_catalog.sql`, aislamiento por organización y smoke test en producción.

## 0.1.0 — 2026-09-28

Primer espacio funcional de Happy Learners para preparar una lección publicada desde escritorio o móvil.

- HL-9 / ST-001: acceso con cuentas sintéticas autorizadas, sesiones opacas y revocación al salir.
- HL-10 / ST-004: organización inicial persistente, zona horaria y permisos de administración.
- HL-11 / ST-031: lección publicada de solo lectura con objetivo, actividades, materiales e impresión.
- HL-12 / ST-042: comprobación automática de los flujos críticos tras desplegar y cada hora.
- HL-13 / ST-043: el artefacto verificado se despliega automáticamente desde main, con SHA y hashes de contenido.
- HL-14 / ST-045: sin perfiles de niños, datos sintéticos, sesiones temporales y registros sin cuerpos de solicitudes.
- HL-15 / ST-049: trazabilidad y operación existentes conservadas; no se amplía el harness.

Persistencia: SQLite en un Durable Object por organización, dentro del plan gratuito. D1 no se creó porque la credencial existente carece de acceso; la decisión está documentada en ops.

Demo: https://happy-learners-demo.lfmendoza-alvarez.workers.dev

Cuentas públicas de demostración: `admin-demo`, `instructor-demo`; contraseña sintética `Aprender-2026!`. No introducir información personal. Las cuentas reales, invitaciones, edición/publicación de contenido y trabajo sin conexión quedan fuera de esta release.

Evidencia histórica: EXE-1c48bd9d391baa5d45ec y MNF-53e11fe0b6a1a0dac88d. Alcance actualizado por la directiva P0 del 28 de septiembre de 2026.
# v0.2.1

Roles Administrador/Educador, currículo Nivel–Unidad–Lección, edición persistente, revisiones publicadas, actividades ordenables y recursos vinculados. Migración acumulativa con seed sintético. [Detalle](docs/sprint-2/release-notes-v0.2.1.md).
