# v0.2.3 · Un espacio de trabajo predecible

HL-44 · ST-041 · REL-003. Reconstrucción de la experiencia de producto sobre la misma API, contratos y datos de v0.2.2.

## Qué cambia para el equipo docente

- **Una sola navegación.** La barra superior tiene marca, organización, búsqueda (`/`), ayuda y perfil. El menú lateral muestra Inicio, Cursos, Biblioteca y Ayuda; al entrar en un curso cambia a Todos los cursos, Resumen, Contenido, Biblioteca del curso, Grupos, Asistencia y Configuración. Ya no hay pestañas horizontales.
- **Nombres fijos.** Curso → Unidades → Lecciones → Actividades → Recursos. Desaparecen “agrupación”, “Preparar”, “Materiales” y “Editar lecciones”.
- **Inicio** muestra qué continuar, cursos recientes, próximas clases, estado de las lecciones, acciones rápidas y actividad reciente, con una sola acción principal: Crear curso.
- **Cursos**: tarjetas compactas con progreso de publicación, unidades y lecciones, fecha en formato humano y menú para editar, duplicar o archivar.
- **Contenido**: unidades y lecciones en un outline con expandir/contraer, crear, renombrar en línea, mover con el teclado y archivar/restaurar.
- **Editor de lección**: breadcrumb, título editable, detalles, outline de actividades, autosave con estado visible (Guardado, Guardando, qué falta, error con reintento), vista previa y una acción principal por estado (Publicar, Publicar cambios, Copiar enlace, Restaurar).
- **Biblioteca** del curso y global con búsqueda, tipo, lista o cuadrícula, uso en lecciones, vista previa y archivo.
- **Grupos y asistencia** como un flujo: grupo → registrar clase → marcar asistencia, con resumen al guardar.
- **Estudiante**: móvil primero, una actividad a la vez, avance visible, Anterior/Siguiente y cierre claro, sin datos personales ni elementos administrativos.
- **Sesión expirada**: un aviso permite volver a entrar sin perder lo que está en pantalla; después se guarda lo pendiente.

## Correcciones

- Guardar una lección colaborativa creada antes de que las actividades tuvieran ID vaciaba las actividades no abiertas y el guardado fallaba. Ahora el editor completa esos campos colaborativos con el texto guardado antes de editar.
- Las confirmaciones destructivas empiezan en “Cancelar”; los diálogos enfocan su primer campo.

## Calidad

- Tokens de color, tipografía, espaciado, radios, sombras, estados, motion y breakpoints; primitivas propias sin bibliotecas de UI.
- Contraste de texto ≥ 4.5:1 y de controles ≥ 3:1 en todos los pares de tokens.
- E2E en escritorio y móvil sobre una base local nueva: los siete flujos requeridos, coedición, documentos Office, sesión expirada, administración, autorización de API, auditoría axe WCAG 2.2 A/AA de las rutas principales y navegación por teclado. Todo lo creado por las pruebas empieza por `E2E ·`.
- Revisión visual de cada ruta principal a 1440×900, 1024×768 y 390×844 (`scripts/screenshots.mjs`).
- Cada PR del repositorio se despliega en una preview aislada (`happy-learners-demo-preview`, con sus propios Durable Objects y bucket R2) y se comprueba con el smoke de solo lectura.

## Límites conocidos

- La demo pública conserva registros de una ejecución E2E antigua (sufijos `desktop-1790700257067` y `mobile-1790700278802`). Eliminarlos cambia datos compartidos de producción y queda pendiente de una decisión explícita.
- El curso Exploradores contiene “Un mundo de colores” (lección sembrada) además de la lección manual “Colores en clase”; unificar la demostración curada forma parte de esa misma limpieza.
- Duplicar un curso usa la API pública paso a paso; si una llamada falla, la copia queda parcial y el aviso lo indica.
