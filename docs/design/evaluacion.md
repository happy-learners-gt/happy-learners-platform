# Diseño de la evaluación (1.3.3)

Rediseño de cómo se diseña, se asigna a grupos y se califica la evaluación. Reemplaza la interfaz de 1.3.1–1.3.2, que
tenía buenas capacidades y una mala experiencia. Fecha: 29 de octubre de 2026.

## Diagnóstico de 1.3.1–1.3.2

1. **Lugar equivocado.** El plan de evaluación es del **curso** (lo comparten todas sus secciones), pero se edita desde
   la libreta de **una sección**, en un diálogo por periodo. Quien diseña la evaluación no tiene un lugar propio y quien
   solo califica ve un botón para cambiar algo de todas las secciones.
2. **Sin recorrido.** El esquema se elige en Configuración del curso, los esquemas se crean en Configuración académica,
   el plan en Notas, y rúbricas, tribunal y grupos dentro de una fila de una tabla de 7 columnas en un diálogo. Nada dice
   cómo se calcula la nota.
3. **Interacción.** Subformularios anidados en filas; categorías y pesos del esquema invisibles al armar el plan; el
   campo «Descriptor» de la rúbrica guarda el nombre del nivel (error).
4. **Arquitectura.** Una actividad del curso apunta a un conjunto de grupos de **una** sección: las demás secciones no
   pueden calificarla en grupos.
5. **Dos sistemas de grupos** sin conexión: los grupos de la sección (para actividades de lecciones) y los conjuntos
   (para calificar).

## Principios

- **Cada cosa en su lugar y en su momento.** Se **diseña** en el curso (antes y durante el periodo, por quien dirige el
  curso); se **organiza** en la sección (sus grupos); se **califica** en la sección (Notas). Nunca se diseña desde Notas.
- **Siempre se ve cómo se calcula la nota**, en lenguaje natural, donde se diseña y donde se califica.
- **Una acción principal por pantalla; los detalles en un panel lateral**, nunca en filas con subformularios.
- **Lo que ya tiene notas se protege con explicación**, no desaparece ni falla en silencio.

## 1. Curso › Evaluación (`/cursos/:id/evaluacion`, nueva, en `coursePages` después de «Plan curricular»)

```
Evaluación                                                     [ Agregar actividad ]
Cómo se evalúa este curso en todas sus secciones.

┌ Cómo se calcula la nota ─────────────────────────────────────────────────────────┐
│ Universidad: categorías y GPA                                       Cambiar esquema │
│ La nota de cada periodo es Tareas 30 % + Proyectos 30 % + Examen final 40 %.        │
│ Se descarta la tarea más baja · Examen final mínimo 60 · Se muestra como GPA (4,0)  │
│ El ciclo promedia sus periodos según su peso · Aprueba con 60                       │
└─────────────────────────────────────────────────────────────────────────────────────┘
[ Primer bimestre ✓ ] [ Segundo bimestre · faltan 20 pts ] [ Tercer… ] [ Cuarto… ]   ⋯ (Usar plantilla · Copiar de otro periodo)

┌ Tareas · 30 % ────────────────────────── 3 actividades ─────── [ + Agregar ] ┐
│ ▣ Tarea 1 · Fracciones     10 pts  · 14 feb  · Puntos                    ⋯    │
│ ▣ Tarea 2 · Decimales      10 pts  · 28 feb  · Rúbrica (3 criterios)     ⋯    │
│ ▣ Investigación grupal     10 pts  · 7 mar   · Rúbrica · En grupos  🔒   ⋯    │
└───────────────────────────────────────────────────────────────────────────────┘
┌ Examen final · 40 % · mínimo 60 ────────── 1 actividad ──────── [ + Agregar ] ┐
│ ▣ Examen del bimestre      40 pts  · 20 mar  · Tribunal (3, preside L. Herrera)│
└───────────────────────────────────────────────────────────────────────────────┘
```

- Con el método «puntos acumulados» las categorías se ven igual y la barra del periodo dice «80 de 100 puntos».
- El estado de cada periodo (completo, faltan puntos, pesos que no suman) se ve en su pestaña y arriba de las categorías.
- 🔒 = tiene notas: el menú explica qué se puede cambiar (nombre, fecha) y qué no (forma de calificar, puntos por debajo
  de una nota dada).
- **Quién:** edita el responsable del curso y su equipo con permiso de edición, y administración; el resto lee.
- **Cambiar esquema** abre un diálogo con los esquemas activos y la explicación de cada uno; quien administra tiene
  «Administrar esquemas» que lleva a Configuración académica.

### Panel de actividad (Drawer, al agregar o editar)

```
Nueva actividad en Proyectos                                                    ✕
1  Qué es
   Nombre [______________]  Tipo [Proyecto ▾]  Categoría [Proyectos ▾]
   Puntos [20]  Fecha [__/__/____] (opcional)
2  Cómo se califica
   ( Puntos ) ( Rúbrica ) ( Aprobado o no ) ( Nivel ) ( Tribunal )      ← tarjetas seleccionables
   [ editor según la elección; la rúbrica es una matriz criterios × niveles con su
     descriptor y puntos, con «Agregar criterio» y «Agregar nivel» ]
3  Quién la hace
   ( Cada estudiante )  ( En grupos )  → cada sección elige con qué grupos en su página de Grupos
   Coevaluación entre integrantes [ ] · factor entre [0,5] y [1,5]
4  Opciones
   [ ] Puntos extra    Reposición de [ ninguna ▾ ]
──────────────────────────────────────────────────────────────────────────────────
Vale 20 de 30 % en Proyectos · se califica con rúbrica de 3 criterios · en grupos     [ Guardar ]
```

## 2. Sección › Grupos (un solo sistema)

- La página lista **conjuntos de grupos**. Los grupos de siempre son el conjunto **«Grupos de la sección»** (migración
  sin pérdida). Acción principal: «Formar grupos» (el asistente de 1.3.2).
- Cada conjunto en una tarjeta: sus grupos, **«Se usa en»** (actividades de lecciones y evaluaciones) y su menú.
- **Actividades en parejas o equipos de las lecciones** y **evaluaciones en grupos**: una sola lista «Actividades en
  grupos» donde cada una elige su conjunto (y, para una actividad de lección, qué grupos de él la hacen).
- La asignación es **de la sección**: tabla nueva `section_activity_sets(group_id, activity_id, kind 'lesson'|'assessment',
  set_id)`; `assessment_activities.work_group_set_id` se migra a ella para la sección de ese conjunto y deja de leerse.

## 3. Sección › Notas (solo calificar)

- Arriba, la misma explicación de **cómo se calcula la nota** (una línea, con «Ver la evaluación del curso»).
- Sin «Editar el plan». Si el periodo no tiene actividades: estado vacío que lleva a Evaluación (o explica a quién
  pedirlo si no tiene permiso).
- Una evaluación en grupos sin conjunto elegido en esta sección muestra «Elige los grupos» que lleva a Grupos.
- La cuadrícula, la revisión de cierre, la boleta y el CSV no cambian.

## 4. Configuración

- Configuración del curso conserva el selector de esquema con un enlace «Ver cómo se calcula» a Evaluación.
- Configuración académica › Esquemas conserva el editor, con la misma explicación en lenguaje natural como vista
  previa (función de dominio `schemeExplanation(scheme)`, la misma en todas partes).
