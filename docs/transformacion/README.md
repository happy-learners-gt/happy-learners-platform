# Programa de transformación del producto

Programa largo y autónomo para llevar Happy Learners Studio de un conjunto de páginas administrativas a una plataforma
institucional coherente, segura y con IA integrada. Empezó el 31-oct-2026 sobre producción `6651930` (PR #102, 1.5.9).

Este directorio es la **fuente de verdad del programa**: una sesión nueva de Claude Code debe poder retomarlo sin la
conversación. Continúa la hoja de ruta anterior (`docs/roadmap/2026-10-29-hoja-de-ruta.md`, versiones 1.2–1.5.9), que
queda como historia; lo nuevo se registra aquí.

## Cómo retomar (cada sesión)

1. Leer [estado/CURRENT-STATE.md](estado/CURRENT-STATE.md) y [estado/NEXT-SESSION.md](estado/NEXT-SESSION.md).
2. Leer [estado/WORK-QUEUE.md](estado/WORK-QUEUE.md) y tomar la tarea `READY` de mayor prioridad.
3. `git status`, `git log --oneline -10`, `git fetch && git log --oneline -3 origin/main`: comprobar que el estado
   registrado coincide con el repositorio (rama, último commit, PR abierto).
4. Trabajar en incrementos pequeños; al cerrar cada uno, actualizar estado, cola y bitácora, y hacer commit.

No repetir el descubrimiento: la auditoría está en [auditoria.md](auditoria.md).

## Documentos

| Documento | Contenido |
| --- | --- |
| [auditoria.md](auditoria.md) | Línea base, matriz de calidad por módulo (puntajes), hallazgos transversales y por módulo |
| [arquitectura-de-informacion.md](arquitectura-de-informacion.md) | Árbol de navegación objetivo, reubicación de módulos y su migración por incrementos |
| [decisiones.md](decisiones.md) | Decisiones del programa (TD-###) con razón y alternativas |
| [aprobaciones.md](aprobaciones.md) | Lo que necesita al dueño del producto: recomendación, alternativas, qué bloquea |
| [flujos.md](flujos.md) | Flujos críticos de punta a punta (F1–F5) con fricción y oportunidad |
| [ia.md](ia.md) | IA como plataforma: capacidades actuales, brechas AIG-1..7 y arquitectura objetivo |
| [riesgos-y-presupuesto.md](riesgos-y-presupuesto.md) | Registro de riesgos; Cloudflare, GitHub Actions e IA: límites, consumo y reglas |
| [estado/](estado/) | `CURRENT-STATE`, `NEXT-SESSION`, `WORK-QUEUE`, `MILESTONES` |

Se reutilizan, sin duplicarlos: diseño (`docs/design/`), arquitectura (`docs/architecture/contextos.md`,
`patrones.md`), seguridad (`docs/security/auditoria-2026-11.md`), operación y SLO (`docs/operations/`), marca y empresa
(`docs/empresa/marca-y-soporte.md`). Las decisiones canónicas del producto (DEC-###) siguen en `happy-learners-ops`.

## Principios (resumen del mandato)

- **Coherencia:** un mismo lenguaje visual, terminología, navegación y manejo de estados en todos los módulos.
- **Flujos completos** antes que pantallas: nada de reingresar datos ni saltar entre páginas desconectadas.
- **Conservar lo que funciona:** Inicio y Cursos son la referencia; no se reescribe infraestructura sin evidencia.
- **Fundamentos primero:** navegación y patrones compartidos antes de rediseñar páginas sueltas; permisos y límites de
  datos antes que funciones de IA.
- **Costo:** plan gratuito de Cloudflare (5 M filas leídas de DO al día, compartidas con la vista previa), minutos de
  Actions limitados, sin gasto nuevo sin aprobación. Validar en local; un PR coherente por hito.

## Límites de autonomía

Sin aprobación: leer, documentar, ramas, refactor, UI/UX, pruebas, accesibilidad, rendimiento, correcciones de seguridad
según la política, commits y PR. **Con aprobación del usuario:** fusionar a `main` (despliega producción), decisiones de
privacidad o de política institucional (R1), marca y empresa, migraciones destructivas, gasto o servicios de pago,
credenciales, pentest externo, cambios de alcance. Ver [aprobaciones.md](aprobaciones.md).
