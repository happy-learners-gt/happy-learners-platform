# Diseño de la biblioteca de recursos didácticos (1.3.7)

Cómo un curso cataloga, indexa y usa sus recursos (libros y todo lo demás) para planificar, enseñar y alimentar al
asistente de IA. Fecha: 30 de octubre de 2026. Ficha: `docs/handoff/cursor/lote-5-recursos-didacticos.md`.

## Hoy

- **Biblioteca del curso** (`/cursos/:id/biblioteca`): materiales (texto o enlace) y archivos (PDF, video, Office) en
  lista o cuadrícula, y debajo una sección **Bibliografía** que apunta a esos elementos con un rol (texto, apoyo, otro),
  una cita escrita a mano y un **libro principal**.
- Del libro principal se extrae el texto por página (`book_texts`, `book_pages`) y se arma el **mapa del libro**: para
  cada indicador del plan, las páginas candidatas y confirmadas con su evidencia (`book_maps`, léxico más IA). Las
  propuestas de lecciones de la IA citan esas páginas.
- Limitaciones: un solo recurso alimenta a la IA; no hay tipos ni metadatos (una partitura, una norma o un dataset son
  «un archivo»); la cita no sigue ninguna norma; no hay índice por capítulos; no hay lecturas asignadas a estudiantes.

## Principios

- **Un recurso es un elemento de la biblioteca con su ficha.** No hay dos listas (biblioteca y bibliografía): la
  bibliografía es una vista de los recursos que tienen un rol en el curso.
- **La ficha se adapta al tipo.** Solo se piden los datos que ese tipo de recurso tiene; la cita en APA 7 se arma sola.
- **Indexar es convertir un recurso en algo navegable y citable:** índice por capítulos y páginas, y mapa a los
  resultados del plan. Es lo que permite que la IA lo use y que una lección diga «lee el capítulo 3, págs. 41–58».
- **Todo lo que hoy hace el libro principal lo hace cualquier recurso indexado.** El libro principal sigue existiendo
  como el recurso de referencia del curso.

## 1. Curso › Recursos (`/cursos/:id/biblioteca`, el menú dice «Recursos»)

```
Recursos                                                  [ Bibliografía APA ] ⋯        [ Agregar recurso ]
24 recursos · 9 en la bibliografía · 5 indexados
[ Buscar…        ] [ Tipo ▾ ] [ Rol ▾ ] [ Estado ▾ ]                                          ☰ ▦
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 📘 Matemática 6 · Santillana, 2024 (3.ª ed.)        Libro   Texto principal ★   Indexado · 18 de 26   ⋯ │
│    López, A. y Pérez, M. (2024). Matemática 6 (3.ª ed.). Santillana.                                  │
│ 📄 Guía docente del CNB de Matemáticas              Guía docente   Apoyo        Índice listo          ⋯ │
│ 🎼 Sonatina en do mayor, Op. 36 n.º 1 · Clementi    Partitura      Obligatoria  Sin índice            ⋯ │
│ 🔗 Fracciones equivalentes (video)                  Video          —            —                     ⋯ │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Agregar recurso** abre el panel lateral (Drawer ancho) en dos pasos: 1) **qué es** (archivo, enlace, texto o
  «solo referencia» para un libro físico sin archivo) y 2) **su ficha** según el tipo. Si se sube un PDF con
  metadatos o un ISBN/DOI conocido, la ficha se rellena y la persona confirma.
- **Columna de estado:** «Sin índice», «Índice listo», «Indexado · N de M» (resultados del plan con páginas
  confirmadas). Solo los recursos indexados alimentan a la IA.
- **Rol en el curso** (opcional): Texto principal (uno por curso, ★), Obligatoria, Recomendada, Apoyo docente. Con rol,
  el recurso está en la bibliografía.
- **Bibliografía APA** abre un diálogo con la lista de la bibliografía en APA 7, agrupada por rol, con «Copiar» y
  «Descargar»; la misma lista puede incluirse en el PDF de entrega.
- La lista conserva búsqueda, vista de lista o cuadrícula y archivados de hoy. Las filas abren el recurso.

### Tipos y ficha

| Tipo | Datos además de título, autoría, año, idioma, licencia, nivel y área |
| --- | --- |
| Libro | Edición, editorial, lugar, ISBN, páginas |
| Capítulo de libro | Libro, editores, páginas del capítulo, editorial, ISBN |
| Artículo | Revista, volumen, número, páginas, DOI |
| Guía docente o manual técnico | Institución, edición o versión, URL |
| Norma o reglamento | Organismo, código, fecha de vigencia, URL |
| Partitura | Compositor, arreglista, instrumentación, editorial |
| Coreografía o video de referencia | Intérpretes, duración, plataforma, URL, marcas de tiempo en lugar de páginas |
| Dataset | Publicador, versión, formato, DOI o URL |
| Caso, plantilla de práctica o rúbrica | Autoría o institución, versión |
| Sitio web | Sitio, fecha de consulta, URL |
| Otro | Descripción |

- Autoría como lista de personas o una institución; la cita APA 7 sale de la función de dominio
  `citation(resource, "apa7")`. «Escribir la cita a mano» existe como excepción y se marca.
- Licencia (derechos reservados, CC BY, CC BY-SA, CC BY-NC, dominio público, uso interno) y una casilla «Se puede
  compartir con estudiantes».

## 2. El recurso (`/cursos/:id/biblioteca/:recursoId`)

```
Matemática 6                                                       [ Abrir ] ⋯ (Editar ficha · Archivar)
Libro · Texto principal ★ · Santillana, 2024 · Indexado · 18 de 26 resultados
[ Ficha ] [ Índice ] [ Mapa al plan ] [ Uso ]
```

- **Ficha:** los datos, la cita APA 7 con «Copiar», la licencia y el archivo o enlace.
- **Índice:** capítulos y secciones con páginas de inicio y fin (o marcas de tiempo en un video). Se **extrae** del
  esquema del PDF cuando lo tiene («Extraer del PDF»), se **propone** desde el texto por página (títulos detectados), o
  se escribe a mano (editor de árbol con sangría, igual al de contenido). Sin texto extraíble se ofrece solo el manual.
- **Mapa al plan:** el mapa del libro de hoy, ahora para cualquier recurso: por resultado de aprendizaje, capítulos o
  páginas candidatas y confirmadas con su evidencia. «Buscar de nuevo», «Confirmar con IA» y «Confirmar todo» como hoy.
  Un recurso sin texto (partitura impresa, libro físico) se mapea a mano por capítulos del índice.
- **Uso:** en qué lecciones y lecturas aparece, y su cobertura: «Cubre 18 de 26 resultados del plan».

## 3. Curso › Plan curricular: cobertura por recursos

En el plan curricular, por cada resultado, una columna **Recursos** con los recursos que lo cubren (chips con capítulo
o páginas) y un filtro «Sin recurso». Arriba: «22 de 26 resultados tienen al menos un recurso indexado».

## 4. Lecturas (lista por unidad y por sección)

- En **Contenido**, cada unidad tiene un bloque **Lecturas** («Agregar lectura»): recurso, capítulo o páginas del
  índice, obligatoria o recomendada, y una nota. En una lección, el editor puede insertar una referencia a un recurso
  con capítulo y páginas (sale como cita en la lección y en el PDF de entrega).
- Con la libertad de cátedra (1.3.6), una sección agrega lecturas propias en su **Plan de la sección** como lo demás
  propio (chip «Propia de la sección»).
- **Estudiantes:** en su espacio, cada unidad muestra sus lecturas (solo recursos que se pueden compartir) con
  «Marcar como leída». Es el **estado de lectura**.
- **Docente:** en Sección › Avance (o Resumen), «Lecturas obligatorias: 72 % leídas» con el detalle por estudiante.

## 5. La IA usa todos los recursos indexados

- **Planificar con IA** muestra **Fuentes** con los recursos indexados del curso, marcados por omisión (el texto
  principal primero); la persona puede desmarcar.
- Las propuestas citan recurso, capítulo y páginas; la verificación de citas de hoy se aplica a cada recurso (la página
  citada existe y contiene el texto). Una cita no verificable no se muestra como verificada.
- El registro de la propuesta guarda qué recursos se usaron.

## 6. Migración de lo que existe

- Cada elemento de la biblioteca (material o archivo) pasa a ser un recurso de tipo «Otro» (o «Libro» si está en la
  bibliografía con rol texto); la bibliografía se convierte en roles (texto → Texto principal u Obligatoria según
  `is_primary`, apoyo → Apoyo docente, otro → Recomendada) y su cita manual queda como «cita escrita a mano».
- El texto extraído y el mapa del libro principal se conservan sin cambios (ya están por archivo).

## 7. Pantallas para capturar (1440 y 390)

Recursos con filtros y estados; el panel «Agregar recurso» con la ficha de un libro y de una partitura; Bibliografía APA;
el recurso en Ficha, Índice (extraído y manual) y Mapa al plan; cobertura en Plan curricular; lecturas de una unidad;
lecturas en el espacio del estudiante; Fuentes en Planificar con IA.

## 8. Fuera de alcance

- Préstamo de ejemplares físicos (biblioteca escolar): es otro producto.
- Búsqueda en catálogos externos más allá de ISBN y DOI.
