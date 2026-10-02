# v0.5.0 · Modelo académico

HL-44 · ST-041 · REL-003. Primera entrega del rediseño de la configuración. La v0.6.0 agregará perfil de egreso por programa, cobertura entre cursos y biblioteca compartida; la v0.7.0, vocabularios como recurso para idiomas.

## Por qué

La configuración anterior era una lista de etiquetas que nada usaba. Además, el "perfil" mezclaba nivel (Preescolar, Universitario), formato (Taller) y componente (Laboratorio), y nombres como "Unidades", "Experiencias" o "Prácticas" se elegían sin regla. Una plataforma que debe servir para cualquier tipo de enseñanza necesita describir los cursos con un vocabulario estándar y que esa descripción cambie lo que hace el producto.

## Qué cambia

- **Dimensiones estándar (UNESCO):**
  - Tipo de educación (formal o no formal) y nivel CINE 2011: desarrollo de la primera infancia (nursery), preprimaria, primaria, secundaria baja (middle school), secundaria alta (high school), postsecundaria, terciaria de ciclo corto, grado, maestría y doctorado.
  - Área de conocimiento CINE-F 2013: 11 campos amplios y 29 específicos.
  - Formato, modalidad y ritmo.
- **Programas:** reúnen cursos con configuración común. Sus cursos heredan tipo, nivel, modalidad y ritmo; el programa da valores a los ajustes y puede fijarlos.
- **Comportamiento con procedencia:**
  - Cinco ajustes con efecto real: nombre de las partes del curso, secuencia didáctica de las lecciones nuevas, grupos y asistencia, publicar exige resultados de aprendizaje y publicar exige comprobar lo aprendido.
  - El valor sale de un orden fijo: lo fijado por el programa, luego el valor del curso, luego el del programa y, por último, lo que implica el tipo de curso. La pantalla lo indica en cada ajuste.
  - El servidor aplica las mismas reglas que la interfaz, que salen de `packages/domain`.
- **Nomenclatura:**
  - "Módulo" es el término canónico; un curso o programa puede usar otra etiqueta de una lista cerrada.
  - Las frases concuerdan en género y número ("Nuevo módulo", "Nueva unidad", "esta sesión").
- **Descubrir:**
  - Plantillas de inicio al crear un curso.
  - Filtros con conteos en Cursos y en Biblioteca; las etiquetas libres quedan para los recursos.
  - Los cursos muestran su programa, formato, nivel y área.

## Datos

Migración `0013_academic_model.sql`:

- Agrega `study_programs` y, en `courses`, dimensiones y ajustes con restricciones de valores y JSON válido.
- Agrega disparadores que impiden asignar un programa de otra organización.
- Traduce cada perfil anterior:

| Perfil anterior | Configuración nueva |
|---|---|
| Libre | No formal · Curso libre · En línea · A tu ritmo |
| Preescolar | Formal · Preprimaria · Presencial |
| Educación media | Formal · Secundaria baja · Presencial |
| Universitario | Formal · Grado · Híbrida |
| Taller | No formal · Taller · Presencial |
| Laboratorio | Formal · Secundaria alta · Laboratorio |

- Conserva el comportamiento actual de cada curso:
  - Los cursos formales migrados no pasan a exigir resultados ni comprobación para publicar.
  - Los cursos con grupos mantienen la asistencia.
  - La etiqueta "Semanas" se conserva.
- "Disciplina" pasa al área CINE-F.
- Exploradores queda como curso libre de Idiomas (023) con asistencia.
- No toca lecciones.

## Validación

- Pruebas de dominio: entradas, coherencia formal/nivel, derivación y resolución de ajustes con procedencia, ajustes fijados y concordancia de género.
- Prueba de migración 0013: traducción de perfiles, comportamiento conservado y disparador de organización.
- E2E de API: programas y permisos, herencia, rechazo entre organizaciones, asistencia desactivada y publicación bloqueada por requisito.
- E2E de interfaz: programa y etiquetas en administración, curso creado desde plantilla con procedencia de ajustes y nomenclatura de sesiones.
- Resto de la suite con axe WCAG 2.2 A/AA (incluidas la configuración académica y el diálogo de programa) y el detector de CSP.
