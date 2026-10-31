# Decisiones del programa

Decisiones de implementación y arquitectura que toma Claude Code dentro de su autorización. Las que cambian el
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

## TD-004 · Un PR por hito y nada se fusiona sin autorización (31-oct-2026)

- Fusionar a `main` despliega producción. Cada hito llega como un PR coherente, con `main` integrado antes del último
  push para que `main` reutilice la verificación. Las pruebas que cambian por diseño se actualizan con la razón en el
  commit; ninguna se debilita.
