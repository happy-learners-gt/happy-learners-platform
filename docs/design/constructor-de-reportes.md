# Diseño del constructor de reportes (1.5.x)

Cómo una institución diseña sus documentos oficiales (boleta, constancia, acta de tribunal, reporte de avance) con su
membrete y los genera con datos reales, firmados cuando corresponde. Fecha: 30 de octubre de 2026. Lo implementa Claude
Code (sin Cursor).

## Hoy

- El escritor de PDF del dominio (`packages/domain/src/pdf.ts`, 114 líneas) solo escribe texto: título, encabezado,
  pie, bloques con negrita, tamaño, sangría y columnas. Lo usan la **boleta** (`gradebook.ts`, una página por
  estudiante con un formato fijo) y el **PDF de entrega** (`delivery.ts`).
- No hay logotipo ni imágenes, tablas con bordes, plantillas, versiones ni vista previa; cambiar la boleta es cambiar
  código.
- Las firmas electrónicas existen para términos y contratos (ST-153, DEC-046: huella del documento, firma con nombre y
  contraseña, constancia verificable). El tribunal de una evaluación (1.3.1) registra quién calificó y qué, sin acta.

## Principios

- **Una plantilla es datos, no código:** bloques ordenados con su configuración y campos con nombre
  (`{{estudiante.nombre}}`). Cambiar la boleta es editar su plantilla.
- **Vista previa con datos reales** siempre a la vista mientras se diseña: lo que se ve es lo que sale.
- **Versionada:** publicar crea una versión; un documento generado guarda la versión con la que salió y su huella
  SHA-256, así que puede volver a generarse idéntico y verificarse.
- **Firmas con el mecanismo que ya existe** (ST-153): cada integrante de un tribunal firma el acta con su nombre y su
  contraseña; el acta queda cerrada cuando firman todos.
- **La IA ayuda a redactar y a mapear campos, nunca inventa datos:** los datos salen de la plataforma.

## Entregas

| Versión | Contenido |
| --- | --- |
| 1.5.0 | Motor de PDF con imágenes y tablas, plantillas versionadas, diseñador, boleta y constancia configurables |
| 1.5.1 | Acta de tribunal firmada por cada integrante, Redactar con IA en los textos del diseñador |
| 1.5.2 | Reporte de avance de una sección, «Sugerir campos» con IA |

## 1. Motor de PDF (1.5.0)

Ampliación de `pdf.ts`, sin dependencias nuevas y probada byte a byte como hoy:

- **Página:** carta u oficio, vertical u horizontal, márgenes en milímetros.
- **Imágenes JPEG y PNG** (logotipo, sello, firma escaneada): JPEG con `DCTDecode`; PNG sin entrelazado con
  `FlateDecode` y canal alfa como máscara. Ancho y alto en milímetros, proporción conservada.
- **Tablas:** columnas con ancho relativo, encabezado repetido en cada página, bordes y sombreado de encabezado, celdas
  alineadas a izquierda, centro o derecha, ajuste de líneas dentro de la celda.
- **Texto:** alineación, tamaño, negrita y cursiva (Helvetica y Helvetica-Oblique), color de un tema.
- **Encabezado y pie por página**, con número de página («Página 2 de 5»).

## 2. Plantillas (1.5.0)

`Organización › Documentos` (administración; coordinación en su programa):

```
Documentos                                                                       [ Nueva plantilla ]
Boleta de calificaciones · Publicada v3 · Usa: todas las secciones          ⋯ (Editar · Duplicar · Historial)
Boleta de calificaciones — Bachillerato · Publicada v1 · Usa: programa Bachillerato
Constancia de inscripción · Borrador
```

- **Tipos:** boleta (por estudiante y ciclo), constancia (por estudiante: inscripción o finalización), acta de tribunal
  (1.5.1) y reporte de avance de una sección (1.5.2). Cada tipo define sus **campos** y **conjuntos de datos** (por
  ejemplo, la boleta tiene `estudiante.*`, `sección.*`, `ciclo.*` y la tabla `notas` con una fila por curso y periodo).
- **Alcance:** la plantilla de la organización o la de un programa (la del programa gana para sus secciones), como los
  demás ajustes (DEC-041).
- **Versiones:** borrador editable; «Publicar» crea una versión inmutable. Las boletas se generan con la versión
  publicada vigente; el historial muestra cada versión y permite restaurarla como borrador.
- **Semilla:** la boleta y la constancia por omisión reproducen el formato actual para que nada cambie hasta que alguien
  las edite.

## 3. Diseñador (1.5.0)

```
Boleta de calificaciones · Borrador (basada en v3)                [ Vista previa ▾ 3.º A · Ana López ] [ Publicar ]
┌ Bloques ────────────┐ ┌ Hoja (carta, vertical) ───────────────────────────┐ ┌ Propiedades ──────────────┐
│ ＋ Membrete          │ │ [logo] Colegio Horizonte                           │ │ Tabla «Notas»             │
│ ＋ Título            │ │        Ciclo 2026 · Boleta de calificaciones       │ │ Columnas: Curso · B1 · B2 │
│ ＋ Texto             │ │ Estudiante: Ana López        Sección: 3.º A        │ │  · B3 · B4 · Final        │
│ ＋ Campos            │ │ ┌──────────┬────┬────┬────┬────┬──────┐           │ │ Encabezado sombreado [x]  │
│ ＋ Tabla de datos    │ │ │ Curso    │ B1 │ B2 │ B3 │ B4 │ Final│           │ │ Bordes [x]                │
│ ＋ Imagen            │ │ │ Matemát. │ 85 │ 90 │ …                          │ │ Alinear números: derecha  │
│ ＋ Firmas            │ │ └──────────┴────┴────┴────┴────┴──────┘           │ │                           │
│ ＋ Salto de página   │ │ Comentario: {{comentario}}                         │ │                           │
└─────────────────────┘ │ ______________      ______________                 │ └───────────────────────────┘
                        │ Dirección           Coordinación                   │
                        └────────────────────────────────────────────────────┘
```

- Tres paneles en escritorio (bloques, hoja, propiedades); en móvil, la hoja con un panel inferior. Los bloques se
  ordenan con las mismas manijas y teclas que las actividades de una lección.
- **Bloques:** membrete (logo, nombre, datos de la institución), título, texto enriquecido con campos (`{{…}}` insertados
  desde una lista, nunca escritos a mano), par de campos (etiqueta: valor) en una o dos columnas, tabla de datos
  (elige un conjunto y sus columnas), imagen, firmas (una a cuatro líneas con nombre y cargo, o firmas electrónicas en
  el acta) y salto de página.
- **Vista previa** con datos reales: se elige una sección y un estudiante; el PDF real se genera en el Worker y se
  muestra a la derecha (en móvil, en una pestaña). Un campo sin dato se muestra resaltado en la vista previa.
- **Validación al publicar:** campos que no existen, tablas sin columnas, imágenes de más de 1 MB o que no son JPEG/PNG.

## 4. Documentos que usan las plantillas

- **Boleta (1.5.0):** Sección › Notas › Boleta usa la plantilla vigente; el resultado no cambia hasta que la plantilla
  cambia (la semilla reproduce el formato actual).
- **Constancia (1.5.0):** en Estudiantes de una sección, «Constancia» por estudiante (inscripción o finalización).
- **Acta de tribunal (1.5.1):** al cerrarse la calificación de una evaluación con tribunal, se genera el acta (estudiante,
  evaluación, notas o dictámenes de cada integrante y resultado). Cada integrante la ve en **Mis tribunales** y la firma
  con su nombre y contraseña (ST-153: huella del documento, firma registrada); quien preside la firma al final. Firmada
  por todos, queda cerrada y verificable con su constancia.
- **Reporte de avance (1.5.2):** de una sección, desde Notas: clases dadas de las programadas, cobertura del plan por
  unidad, asistencia (presentes y tardanzas sobre las marcas no justificadas) y lecturas obligatorias por estudiante.
- Cada documento generado guarda versión de plantilla, datos usados (resumen) y huella; la actividad registra quién lo
  generó.

## 5. Ayuda de IA (1.5.1–1.5.2)

- En un bloque de texto, «Redactar con IA» (la tarea `write` de 1.4.1) con el tipo de documento como contexto.
- «Sugerir campos» (1.5.2): dado un texto escrito por la persona («la estudiante X del grado Y obtuvo…»), se propone
  reemplazar las partes por los campos que existen; se aceptan uno por uno. Las partes iguales a un dato real de la
  sección de la vista previa se reconocen sin IA (y sin enviar nombres de estudiantes al modelo); la IA agrega el resto.

## Pantallas para capturar (1440 y 390)

1.5.0: Documentos; diseñador con la boleta y la vista previa; propiedades de una tabla; historial de versiones; una
boleta generada con membrete y logo; una constancia. 1.5.1: un acta pendiente de firmas en Mis tribunales; el acta
firmada; el reporte de avance.
