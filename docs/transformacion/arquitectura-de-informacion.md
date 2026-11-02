# Arquitectura de información objetivo

Resuelve los hallazgos T1–T4 de [auditoria.md](auditoria.md). Se migra por incrementos: cada uno deja la aplicación
coherente y conserva las direcciones viejas con redirecciones (como ya hace `App.tsx`).

## 1. Modelo mental

Dos modos de trabajo, no once páginas:

- **Mi trabajo** (todas las personas): qué sigue, cuándo, qué enseño, con quién. Inicio, Agenda, Cursos, Biblioteca,
  Equipo, Mis horas, Mis tribunales.
- **Administrar la institución** (administración y, en su alcance, coordinación): agrupado por **qué se administra**,
  en el orden en que se configura una institución nueva.

## 2. Árbol objetivo

```text
Mi trabajo
├─ Inicio                      (resumen y excepciones por rol)
├─ Agenda                      (por rol: mis clases / la institución)
├─ Cursos                      (los 8 más relevantes + «Todos los cursos (n)»)
│  └─ Curso › Resumen, Contenido, Plan curricular, Evaluación, Planificar con IA, Recursos, Secciones › Sección…, Configuración
├─ Mis tribunales              (si integra alguno)
├─ Biblioteca
├─ Equipo
└─ Mis horas                   (docentes)

Administración
├─ Institución
│  ├─ Organización             (identidad, región, respaldo)
│  ├─ Calendario institucional (ciclos, periodos, jornadas, asuetos y eventos: una sola vista)
│  ├─ Horarios                 (horario vigente + generador)
│  └─ Documentos               (documentos oficiales: boleta, constancia, actas)
├─ Personas
│  ├─ Educadores               (personas, invitaciones, incorporación, perfiles por revisar, salidas)
│  ├─ Contratos y políticas    (plantillas de contrato, contratos, términos y privacidad)
│  ├─ Revisión de perfiles     → se integra a Educadores como bandeja contextual (AI-04)
│  └─ Horas efectivas          (vista de administración)
├─ Académico
│  └─ Configuración académica  (programas, esquemas de evaluación, etiquetas, referencias curriculares)
└─ Gobierno
   ├─ Roles y accesos
   ├─ Notificaciones
   └─ Uso de IA                → «Inteligencia artificial»: capacidades, permisos, uso y costo (AI-01)

Barra superior: búsqueda, avisos, Ayuda (?), menú de la persona (Mi cuenta, perfil público, cerrar sesión).
```

Ayuda hoy está en tres lugares (menú lateral, `?` de la barra y menú de la persona). Destino: `?` de la barra con ayuda
de la página actual, y la base de conocimientos externa (carril D). Se retira del menú lateral cuando exista la ayuda
contextual (IA-05), no antes.

## 3. Reglas de navegación

1. El menú lateral no crece con los datos: ninguna lista muestra más de 8 elementos sin un «Todos…» al final.
2. Relevancia de cursos: el curso abierto; después los abiertos hace poco por esta persona (en este navegador); después
   aquellos en cuyo equipo está; después los modificados más recientemente. Si los activos son 10 o menos, se muestran
   todos (ocultar uno o dos no ahorra nada).
3. Cada grupo de administración tiene un encabezado visible; los nombres de página no cambian en el mismo incremento
   que su posición (un cambio a la vez para quien ya usa la plataforma).
4. URL, migas y menú cuentan la misma jerarquía. `/organizacion/*` se conserva por compatibilidad; las migas dicen el
   grupo real («Institución › Horarios»).
5. Un concepto, un lugar: los contratos se gestionan en Contratos y políticas; Educadores muestra el estado del contrato
   de cada persona y enlaza allí.

## 4. Incrementos

| Id | Incremento | Estado |
| --- | --- | --- |
| IA-01 | Cursos con los 8 más relevantes y «Todos los cursos (n)»; Administración agrupada en Institución, Personas, Académico y Gobierno; Horas efectivas de administración pasa a Personas | Hecho (1.6.0, sin publicar) |
| IA-02 | Migas por grupo en las páginas de administración | Pendiente |
| IA-03 | Agenda por rol: administración abre en la vista de toda la institución | Hecho (1.6.0, sin publicar) |
| IA-04 | Revisión de perfiles como bandeja dentro de Educadores (la ruta `/perfiles` redirige) | Pendiente |
| IA-05 | Ayuda contextual desde `?`; Ayuda sale del menú lateral | Pendiente (depende de la base de conocimientos) |
| IA-06 | Calendario institucional unifica ciclos, jornadas y asuetos; Organización queda en identidad, región y respaldo | Pendiente (Fase 3) |
