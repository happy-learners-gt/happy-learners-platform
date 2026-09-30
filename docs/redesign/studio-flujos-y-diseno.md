# Happy Learners Studio: flujos de trabajo

La interfaz organiza el trabajo por curso, no por tipo de registro aislado. El educador prepara la secuencia, redacta la clase, consulta sus materiales y toma asistencia en el mismo contexto.

## Mapa de navegación

```mermaid
flowchart LR
  H[Inicio] --> C[Cursos]
  C --> R[Resumen del curso]
  R --> K[Contenido: unidades y lecciones]
  K --> L[Editor de lección]
  L --> E[Actividades con texto enriquecido]
  E --> M[Biblioteca del curso]
  L --> V[Vista previa]
  V --> P[Publicar o publicar cambios]
  R --> G[Grupos]
  G --> A[Asistencia: clase por fecha]
```

Un solo sistema de navegación: el sidebar global (Inicio, Cursos, Biblioteca, Ayuda) cambia al entrar en un curso por Todos los cursos, Resumen, Contenido, Biblioteca del curso, Grupos, Asistencia y Configuración. Las rutas de v0.2.2 (Preparar, Materiales, Editar lecciones) redirigen a sus equivalentes. Detalle en la [arquitectura de información v0.2.3](arquitectura-informacion-v0.2.3.md).

## Publicación de una lección

El editor usa un documento estructurado de TipTap. El servidor limita los nodos y formatos permitidos; no acepta HTML libre. La publicación guarda una instantánea separada para que un borrador posterior no cambie lo que ya ve el estudiante.

```mermaid
stateDiagram-v2
  [*] --> Borrador
  Borrador --> Borrador: editar contenido
  Borrador --> Publicada: validar y publicar
  Publicada --> PublicadaConCambios: editar borrador
  PublicadaConCambios --> PublicadaConCambios: guardar edición
  PublicadaConCambios --> Publicada: republicar nueva revisión
  Borrador --> Archivada: archivar
  Publicada --> Archivada: archivar
  PublicadaConCambios --> Archivada: archivar
```

“Publicada con cambios” se deriva de las versiones del borrador y de la instantánea; no es una etiqueta editable. Publicar requiere título, objetivo, actividades válidas y materiales pertenecientes al curso. La vista pública solo recibe la instantánea publicada.

## Preparar una clase

```mermaid
flowchart TD
  C[Seleccionar curso] --> G[Crear o elegir grupo]
  G --> L[Agregar nombres o códigos mínimos a la lista]
  L --> D[Crear sesión con fecha]
  D --> Q{¿Lección vinculada?}
  Q -->|Sí| V[Elegir lección del curso]
  Q -->|No| T[Sesión sin lección]
  V --> A[Pasar lista]
  T --> A
  A --> X[Presente / tarde / ausente / justificada]
  X --> S[Guardar y revisar historial]
```

La hoja inicia en “Sin marcar”. Solo después de elegir un estado se guarda el registro. El educador puede corregirlo más tarde. La asistencia se limita al curso y sus educadores; no pide correo, teléfono, fecha de nacimiento, fotografías ni notas personales. Los registros de demostración usan cinco participantes ficticios.

## Sistema visual

Los tokens viven en `apps/web/src/style.css`: color, tipografía, espaciado, radios, sombras, estados, motion y breakpoints (640, 1024 y 1280 px).

| Token | Color | Uso |
| --- | --- | --- |
| `--color-ink` | `#1D2624` | Texto y títulos |
| `--color-muted` | `#5A6562` | Texto secundario (≥ 5.3:1) |
| `--color-primary` | `#0F5C4F` | Acción principal, enlaces, selección |
| `--color-primary-soft` | `#E4F0EC` | Selección y resaltado |
| `--color-accent` | `#A3441F` | Foco y acento cálido |
| `--color-canvas` | `#F7F5F0` | Fondo de trabajo |
| `--color-surface` | `#FFFFFF` | Tarjetas, paneles, formularios |
| `--color-border-strong` | `#858F8B` | Bordes de controles (≥ 3:1) |

Estados: éxito `#1D6A39`, advertencia `#874A0C`, información `#1C4F7C`, peligro `#A3261A`, cada uno sobre su fondo suave con contraste ≥ 5.7:1. Una acción principal por pantalla, controles de 44 px, ancho de lectura limitado a 46 rem y `prefers-reduced-motion` respetado. Las pruebas E2E auditan WCAG 2.2 A/AA con axe en todas las rutas principales.

## Archivos de clase y coedición

DOCX, PPTX y XLSX se guardan en R2 privado. Cada carga valida extensión, MIME, tamaño, firma ZIP, entradas, rutas y límites de expansión; calcula SHA-256 y se vincula con organización y curso en SQLite. Los binarios nunca usan una URL pública de bucket. La vista previa se genera en el navegador con parsers cargados bajo demanda y sanitización de HTML/SVG. Solo se publica un archivo si una actividad de una lección lo referencia.

Al abrir una lección guardada, cada actividad obtiene un documento Yjs compartido. Un Durable Object por lección sincroniza cambios y presencia sobre WebSocket, comprueba sesión, rol y curso en cada conexión y mensaje, limita tamaño y frecuencia, y persiste operaciones en SQLite con compactación periódica. La presencia expira al procesar mensajes o abrir una conexión; el servidor no mantiene intervalos que impidan la hibernación de una sala sin actividad. Al guardar, el Worker toma la instantánea colaborativa para evitar enviar una copia desactualizada.

La coedición cubre el texto enriquecido y los cursores de los educadores. Título, objetivo, orden y demás estructura de la lección se guardan con compare-and-write; si cambió en otra sesión, se pide recargar. No se fusionan en vivo formularios estructurales.

Antes de desplegar, el bucket R2 `happy-learners-demo-course-files` debe existir en la cuenta destino. La configuración declara el binding, pero no crea el recurso ni habilita facturación. Mantén la copia de seguridad de SQLite y los metadatos SHA-256; archivar un documento no borra el objeto ni invalida publicaciones existentes.

## Referencias de interacción

El editor de formato y la separación entre materiales del curso y contenido publicado siguen patrones reconocibles de LMS; la marca, el lenguaje y la paleta son propios de Happy Learners. Referencias: [Canvas Rich Content Editor](https://community.instructure.com/t5/Canvas-Basics-Guide/What-is-the-Rich-Content-Editor-RCE/ta-p/12), [Canvas Course Files](https://community.instructure.com/en/kb/articles/662754-what-are-files).
