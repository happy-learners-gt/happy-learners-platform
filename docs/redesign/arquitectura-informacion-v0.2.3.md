# Arquitectura de información · v0.2.3

30 de septiembre de 2026 · HL-44 · ST-041 · REL-003

Sustituye la navegación de v0.2.2 (sidebar global + pestañas del curso). La API, los contratos y los datos se conservan; solo cambia la presentación.

## Principio

En cada pantalla debe ser evidente dónde está la persona, qué puede hacer, cuál es la acción principal, qué ocurrió después de actuar, cómo volver y qué está publicado o en borrador.

## Modelo mental

```
Curso
└── Unidades
    └── Lecciones
        └── Actividades
            └── Recursos
```

Estos cinco nombres se usan en todo el producto. “Agrupación”, “Materiales”, “Preparar” y “Editar lecciones” dejan de existir en la interfaz. El campo técnico `unitLabel` se conserva en la API pero no se muestra.

## Un solo sistema de navegación

| Zona | Contenido |
| --- | --- |
| Barra superior | Marca, organización, búsqueda, ayuda, perfil (con cierre de sesión). No navega entre secciones. |
| Sidebar global | Inicio · Cursos · Biblioteca · Ayuda. Administración añade Organización, Educadores y Clasificaciones. |
| Sidebar del curso | ← Todos los cursos · Resumen · Contenido · Biblioteca del curso · Grupos · Asistencia · Configuración |
| Móvil y tableta (< 1024 px) | El mismo sidebar se abre como panel desde el botón “Menú”. |
| Estudiante | Sin sidebar ni barra administrativa. |

## Rutas

| Ruta | Pantalla | Acción principal |
| --- | --- | --- |
| `/inicio` | Inicio: continuar, cursos recientes, próximas clases, borradores, actividad | Crear curso |
| `/cursos` | Listado compacto con búsqueda, filtro y menú contextual | Crear curso |
| `/cursos/nuevo` | Crear curso | Crear curso |
| `/cursos/:id` | Resumen del curso | Continuar con el contenido |
| `/cursos/:id/contenido` | Outline de unidades y lecciones | Crear unidad |
| `/cursos/:id/lecciones/:leccion` | Editor de lección con autosave | Publicar (o Publicar cambios) |
| `/cursos/:id/biblioteca` | Recursos del curso | Agregar recurso |
| `/cursos/:id/grupos` | Grupos y participantes | Crear grupo |
| `/cursos/:id/asistencia` | Clases por fecha y hoja de asistencia | Registrar clase |
| `/cursos/:id/configuracion` | Datos y estado del curso | Guardar cambios |
| `/biblioteca` | Recursos de todos los cursos | — |
| `/buscar?q=` | Resultados por cursos, lecciones y recursos | — |
| `/ayuda` | Ayuda y privacidad | — |
| `/aprender/:codigo` | Lección del estudiante, una actividad a la vez | Siguiente |

Rutas anteriores redirigen: `/contenido/*` y `/biblioteca?…` antiguos → `/cursos`; `/cursos/:id/materiales` → biblioteca del curso; `/cursos/:id/lecciones?editar=X` → editor; `/cursos/:id/lecciones` → contenido; `/?code=X` sigue abriendo la lección.

## Estados de publicación

| Estado | Etiqueta | Acción principal en el editor |
| --- | --- | --- |
| Sin revisión pública | Borrador | Publicar |
| Publicada, sin cambios | Publicada | Copiar enlace |
| Publicada con borrador más reciente | Cambios sin publicar | Publicar cambios |
| Archivada | Archivada | Restaurar |

El editor guarda automáticamente el borrador (1 s después del último cambio) y muestra Guardando…, Guardado hace… o un error con la forma de recuperarse. Publicar primero guarda lo pendiente.

## Retroalimentación

- Toast con `aria-live` tras cada acción; los errores explican cómo recuperarse y permanecen hasta cerrarlos.
- Confirmación modal (`dialog`) antes de archivar.
- Sesión expirada: el contenido se sustituye por el inicio de sesión sin perder la ruta; al entrar se vuelve al mismo lugar.
- Skeletons durante la carga; empty states con la acción siguiente.

## Sistema visual

Tokens en `apps/web/src/style.css` (`--color-*`, `--text-*`, `--space-*`, `--radius-*`, `--shadow-*`, `--motion-*`) y breakpoints 640 / 1024 / 1280 px. Superficies claras, acento verde azulado, acento cálido solo para foco y resaltado. Contraste de texto ≥ 4.5:1, controles ≥ 3:1, objetivos táctiles ≥ 44 px, `prefers-reduced-motion` respetado.

Primitivas propias (sin biblioteca externa): AppShell, ContextSidebar, PageHeader, Breadcrumbs, PrimaryAction, EmptyState, StatusBadge, ResourceCard, CourseCard, LessonOutline, ConfirmDialog, Toast, Skeleton y Menu.

## Datos de demostración

Las pruebas E2E que escriben datos usan una base local nueva por ejecución y el prefijo `E2E ·` en todo lo que crean; una prueba comprueba que ningún registro visible tenga el patrón de la contaminación anterior (`desktop-` o `mobile-` seguido de un timestamp de 13 dígitos) y que lo creado por la suite lleve el prefijo limpiable.

**Resuelto en v0.2.5:** la migración `0010_remove_legacy_e2e_records.sql` eliminó de producción los registros de una ejecución E2E antigua (sufijo `desktop-1790700257067` / `mobile-1790700278802`), con autorización del 2026-10-01 y copia previa adjunta a la release.
