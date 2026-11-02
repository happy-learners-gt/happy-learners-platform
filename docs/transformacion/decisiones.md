# Decisiones del programa

Decisiones de implementación y arquitectura que toma el equipo de desarrollo dentro de su autorización. Las que cambian el
producto de forma canónica se proponen también como DEC-### en `happy-learners-ops`. Formato: contexto, decisión,
alternativas, consecuencias.

## TD-001 · El programa vive en `docs/transformacion/` y continúa la hoja de ruta (31-oct-2026)

- **Contexto:** el mandato sugiere `docs/product-transformation/` con ~30 archivos; el repositorio ya documenta en
  español y tiene una hoja de ruta viva.
- **Decisión:** un directorio en español con 6 documentos y `estado/`. La hoja de ruta anterior queda como historia de
  1.2–1.5.9 y apunta aquí. Seguridad, diseño, arquitectura y operación siguen en sus directorios.
- **Alternativas:** la estructura completa sugerida (descartada: duplica documentos existentes y cuesta mantenerla).

## TD-002 · El primer fundamento es la navegación (31-oct-2026)

- **Contexto:** T1–T4 (menú que no escala, administración plana, conceptos repartidos) afectan a todos los módulos.
  Rediseñar páginas antes de ordenar dónde viven repetiría trabajo.
- **Decisión:** M1 = arquitectura de información (IA-01–IA-03) antes de cualquier rediseño de página.
- **Alternativas:** empezar por Agenda u Horas, peor puntuados (descartado: su lugar en el menú cambia con M1).

## TD-003 · La relevancia de los cursos del menú se calcula en el navegador (31-oct-2026)

- **Contexto:** el menú necesita «los cursos recientes» de cada persona.
- **Decisión:** los cursos abiertos hace poco se guardan en `localStorage` por persona (máximo 8 ids, sin datos
  personales); el resto del orden usa datos que el menú ya tiene (`team`, `updatedAt`). Sin API ni lecturas nuevas.
- **Alternativas:** una tabla de «último acceso» en el servidor (descartada por ahora: una escritura por navegación
  en el plan gratuito y otra migración; se reconsidera si se necesita la relevancia entre dispositivos).
- **Consecuencia:** en otro navegador el orden empieza por equipo y fecha de modificación.

## TD-005 · La Agenda elige el alcance por rol en el servidor (02-nov-2026)

- **Contexto:** administración abría una semana vacía (T6). El cliente no sabe si la persona imparte secciones.
- **Decisión:** si la petición no trae `scope`, la API elige: «Mis secciones» si imparte alguna; si no, «Toda la
  organización» o el primer programa de su alcance. La respuesta dice el alcance elegido y el selector lo muestra.
  Un `?ver=` explícito siempre manda.
- **Costo:** la vista de la organización leía 6 483 filas (7 semanas, demo); se bajó a 1 829 en el mismo cambio para
  que el nuevo valor por defecto no gaste cuota.

## TD-006 · Las migas muestran profundidad, no grupos (02-nov-2026)

- **Contexto:** Horarios, Documentos y Uso de IA mostraban «Organización ›», un padre que el menú no tiene.
- **Decisión:** las migas solo aparecen cuando una página vive dentro de otra (Documentos › plantilla; Cursos ›
  curso › …). Los grupos del menú (Institución, Personas, Académico, Gobierno) son encabezados sin página propia.
- **Alternativas:** migas con el grupo como elemento sin enlace (descartado: parece navegable y no lleva a nada).

## TD-007 · Sin marco de agentes por ahora (02-nov-2026)

- **Contexto:** el mandato pide evaluar agentes y orquestación multi-paso.
- **Decisión:** no se introduce. Las 7 tareas de IA son de un paso, con salida de esquema estricto, validación
  determinista y aceptación humana; ninguna mejora con un plan multi-paso o con herramientas que escriban. Se revisa
  cuando aparezca una tarea que necesite reunir datos de varios contextos y proponer una acción compuesta (candidata:
  asistente de configuración del ciclo, M4).

## TD-008 · Límite de IA por persona y hora (02-nov-2026)

- **Decisión:** 60 peticiones síncronas por persona y hora, con el balde de `login_limits` (sin tabla nueva). Es una
  guarda de seguridad, no un límite comercial: el tope por organización y plan queda para el dueño (AP-07).
- **Alternativas:** tope mensual por organización (decisión de negocio); límite dentro de `tracked()` (descartado:
  también cortaría trabajo en cola que la persona no está esperando).

## TD-004 · Un PR por hito y nada se fusiona sin autorización (31-oct-2026)

- Fusionar a `main` despliega producción. Cada hito llega como un PR coherente, con `main` integrado antes del último
  push para que `main` reutilice la verificación. Las pruebas que cambian por diseño se actualizan con la razón en el
  commit; ninguna se debilita.
