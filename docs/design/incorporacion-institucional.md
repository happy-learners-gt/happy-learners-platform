# Incorporación institucional de un educador (PPL-01)

Programa de transformación, flujo F1 (`docs/transformacion/flujos.md`). Hoy, «Incorporación» en Educadores es solo la
bienvenida que la persona completa por su cuenta. Lo que hace administración para que alguien pueda dar clases
(aprobar su perfil, el contrato, el equipo del curso, las secciones) vive en cuatro páginas y nadie ve qué le falta a
cada persona.

## Lugar y momento

- **Dónde:** Educadores › detalle de la persona (el diálogo que ya abre «Perfil y expediente»), pestaña nueva
  **«Incorporación»**. La abren la columna «Incorporación» de la tabla (ahora un botón) y la pestaña Incorporación de
  Educadores; el nombre y «Perfil y expediente» siguen abriendo el perfil (lo que la persona eligió no cambia).
- **Cuándo:** desde que se invita a alguien hasta que imparte su primera sección.

## La lista (en orden)

| # | Paso | Hecho cuando | Acción si falta |
| --- | --- | --- | --- |
| 1 | Bienvenida | la persona completó su incorporación (contraseña, términos, perfil) | Ninguna de administración: «Esperando a la persona» con lo que le falta |
| 2 | Perfil revisado | no tiene una versión del perfil esperando aprobación | «Revisar perfil» → Revisión de perfiles |
| 3 | Contrato | tiene un contrato vigente o firmado que empieza después | «Crear contrato» → Contratos y políticas › Nuevo contrato con la persona elegida; si está pendiente de firma, «Esperando su firma» |
| 4 | Equipo de un curso | está en el equipo de al menos un curso | «Ver cursos» → Cursos (el equipo se edita en cada curso) |
| 5 | Secciones | imparte al menos una sección | «Ver cursos» (se asignan en Curso › Secciones) |

Administración no tiene contrato ni secciones: para su rol la lista son los pasos 1 y 2. Un paso que no aplica
(por ejemplo, la organización no exige contrato) no aparece.

## Pantalla (texto)

```text
Ana López                                    Perfil  Expediente  [Incorporación]
3 de 5 pasos · le falta: contrato, secciones
 ✓ Bienvenida                     completa el 12 oct
 ✓ Perfil revisado
 ○ Contrato                       sin contrato              [Crear contrato]
 ✓ Equipo de un curso             responsable de 2 cursos
 ○ Secciones                      no imparte secciones      [Ver cursos]
```

## Reglas

- Se calcula en el navegador con lo que Educadores ya carga (miembros con carga y contrato, incorporación de cada
  persona) más la lista de perfiles por revisar: sin rutas nuevas ni lecturas por persona.
- «Crear contrato» abre el diálogo de siempre con la persona ya elegida (`/contratos?persona=<id>#contratos`).
- Accesible: lista con el estado en texto (no solo el ícono), botones con nombre propio («Crear contrato para Ana
  López»).

## Agregar a un curso (PPL-02, 1.6.5)

El paso «Equipo de un curso» abre «Agregar a <persona> a un curso»: curso activo donde aún no está y rol (responsable si
el curso no tiene; si lo tiene y se elige responsable, la anterior pasa a colaborar). Lee el curso y envía su equipo con
la persona agregada y la versión del curso, como Configuración › Equipo docente. Las secciones se asignan en el curso:
ahí se resuelven los choques de horario, que piden un motivo.
