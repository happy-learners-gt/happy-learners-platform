# Auditoría de diseño y consistencia (REL-010, 1.2.5)

Pedido el 28 de octubre de 2026: que todas las páginas usen el ancho disponible con un diseño acorde, que los menús de
tres puntos no salten de línea ni se salgan de la pantalla, que los textos largos, etiquetas y badges no rompan las
tarjetas, que la navegación de **Mi perfil** funcione y que en móvil no haya espacios vacíos ni controles perdidos.

## Método

1. **Auditoría automática** de 37 rutas (todas las páginas de la organización, de un curso y de una sección, Mi
   cuenta y el editor) en escritorio (1440 × 900) y móvil (390 × 844, táctil), con Playwright sobre el Worker local y
   los datos de demostración. Mide en cada página: desborde horizontal, paneles que no usan el ancho de la columna,
   elementos fuera de la pantalla, disparadores de menú que saltan de línea, menús abiertos que se salen de la
   pantalla, texto que desborda su caja y espacios verticales vacíos.
2. **Revisión visual** de las capturas de cada ruta en ambos tamaños.
3. **Causa raíz antes que parche:** cada hallazgo se corrige en el componente o la regla compartida que lo produce, no
   página por página.
4. **Guardia de regresión:** `tests/e2e/layout.spec.ts` comprueba las mismas invariantes en CI para las rutas
   principales, en escritorio y en móvil.

## Hallazgos (antes)

| # | Problema | Dónde | Causa raíz |
| --- | --- | --- | --- |
| 1 | En móvil, cientos de píxeles vacíos entre migas, título, descripción y acciones | Todas las páginas con `PageHeader` (Cronograma, Cursos, Configuración académica…) | `.page-header-text { flex: 1 1 320px }`: al pasar la fila a columna, la base de 320 px se vuelve altura y la cuadrícula reparte el sobrante entre filas. |
| 2 | Páginas que usan una fracción del ancho | Organización, Cuenta, Preferencias, Notificaciones, Configuración del curso, Crear curso, Ayuda, perfil público | Contenedores de página con `max-width` (`.form-sheet` 55 rem, `.reading` 44 rem). |
| 3 | El menú ⋯ salta a la línea siguiente | Tarjetas de cursos (24 de 24), programas de Configuración académica | Cabeceras de tarjeta con `flex-wrap`: el título largo empuja el menú. |
| 4 | Menús abiertos fuera de la pantalla (a la izquierda o bajo el borde) | Cursos, Educadores, Estudiantes, Biblioteca del curso, Configuración académica, Resumen de sección, Organización, Guía de estilo | `.menu-list` absoluto con `right: 0`, sin detección de colisión: si el disparador queda a la izquierda, el menú se abre fuera del viewport; tampoco se voltea hacia arriba. |
| 5 | Badges aplastados a 22 px | Plan curricular en móvil | Badges sin `white-space: nowrap` en celdas estrechas. |
| 6 | La navegación de Mi perfil regresa a la sección anterior | Mi cuenta › Perfil | `IntersectionObserver` con banda estrecha: durante el desplazamiento suave y al terminar marca otra sección; sin bloqueo durante el desplazamiento programado ni margen bajo la barra fija. |

Durante la revisión visual aparecieron además:

| # | Problema | Dónde | Causa raíz |
| --- | --- | --- | --- |
| 7 | El título de la unidad se parte letra por letra | Contenido en móvil | Título `flex: 1` (base 0) en una fila con `flex-wrap`: se aplasta antes de que la fila envuelva. |
| 8 | Un aviso con enlace se parte en tres columnas de palabras | Mi cuenta › Notificaciones y cualquier `.notice`/`.form-alert` con texto y enlace | Avisos `display: flex`: cada fragmento de texto y el enlace son columnas. |
| 9 | Tablas de lista recortadas y con desplazamiento lateral | Educadores, Mi cuenta, Horas, Contratos, Notificaciones, credenciales | Sin diseño de tabla para teléfono. |
| 10 | Filtros con anchos dispares | Cursos, Biblioteca, Cronograma | Filtros en `flex-wrap` con `min-width` distintos. |
| 11 | Plantillas de contrato que dejan media fila vacía | Contratos | Rejilla `auto-fill` con pocas tarjetas. |
| 12 | Dos componentes con la misma clase `.outcome-list` | Plan curricular y clase | La regla de la clase (rejilla de 28 px) ganaba en el Plan. |

## Resultado

La auditoría repetida (escritorio, tableta 820 × 1180 y móvil) no deja hallazgos fuera de los esperados: rejillas de
varias columnas que llenan su fila (Horas, Roles, Contratos) y la Guía de estilo, que muestra componentes sueltos.
La guardia de regresión encontró un error de la propia corrección (el menú en portal no recibía el foco y Escape no lo
cerraba) y quedó corregido antes de entregar.

## Estándar (documentado en `docs/design/fluent.md`, punto 9)

- **Ancho:** el contenido ocupa la columna completa (`--content-max`). Ninguna página limita su ancho; la medida de
  lectura se aplica al texto (párrafos y descripciones), no a los contenedores.
- **Diseño acorde al espacio:** los formularios usan `form-grid-12` con cada campo a la anchura de su contenido; las
  listas de tarjetas usan `card-grid` (rejilla automática); las páginas de configuración apilan paneles a todo lo ancho.
- **Cabecera de tarjeta y fila:** rejilla `[icono] [título 1fr] [acciones auto]`: el título se recorta a dos líneas
  con su texto completo en `title`, las acciones nunca saltan y las etiquetas van debajo, envolviendo.
- **Menús y superficies emergentes:** posicionamiento con detección de colisión (se alinean al disparador, se
  desplazan para quedar dentro del viewport con 8 px de margen y se voltean hacia arriba si no caben abajo), altura
  máxima con desplazamiento y cierre al desplazar o redimensionar.
- **Texto:** badges y chips sin salto (`nowrap`, con recorte si hace falta); textos de usuario con
  `overflow-wrap: anywhere` en tarjetas.
- **Móvil:** cabecera compacta (título, descripción y acciones apilados con el espaciado de la escala), sin desborde
  horizontal, controles táctiles de 44 px.
- **Navegación por secciones (scroll-spy):** sección activa = la última cuyo inicio pasó bajo la barra fija; al elegir
  una sección se bloquea la detección hasta terminar el desplazamiento; `scroll-margin-top` para no quedar bajo la barra.

## Entregable

Versión 1.2.5 con las correcciones, el estándar documentado, la guardia `layout.spec.ts`, la auditoría repetida sin
hallazgos y `./scripts/verify` completo.
