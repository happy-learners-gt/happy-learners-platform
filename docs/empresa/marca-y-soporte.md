# Marca, empresa y soporte (carril D)

Hoja de ruta, carril D. Las decisiones son del usuario: este documento reúne lo que Claude Code puede preparar
(opciones, brief y estructura) para que cada paso con terceros (notario, contador, diseñador, registro) empiece con
material listo. Nada aquí está verificado legalmente.

## 1. Posicionamiento

Happy Learners ya no es solo escolar: sirve a instituciones de todo tipo (colegios, universidades, academias, talleres)
que planifican, enseñan y evalúan con ayuda de IA verificada.

> **Propuesta:** la plataforma donde una institución planifica sus cursos, da sus clases y emite sus documentos
> oficiales, con una IA que propone y el equipo que decide.

Diferenciadores ya construidos: IA como propuesta revisable (nunca escribe sola), horarios con reglas y aulas,
documentos oficiales diseñables con firmas, una base de datos aislada por institución, accesibilidad WCAG 2.2 AA.

## 2. Nombre: criterios y candidatos

Criterios: corto (2–3 sílabas), pronunciable en español e inglés, sin «escuela» ni «kids» (el producto ya no es solo
escolar), dominio `.com` o `.app` disponible, sin marcas parecidas en educación (clase 41) ni software (clase 42).

| Candidato | Idea | Riesgo a revisar |
| --- | --- | --- |
| **Aulaviva** | el aula como algo vivo y planificado | marcas con «aula» en educación |
| **Planea** | planificar + «idea»; verbo en español | término común; difícil de registrar solo |
| **Cátedra** | libertad de cátedra, institucional | palabra genérica; usar con complemento |
| **Lumen Aula** | luz + aula | «Lumen» usado en software educativo |
| **Tejido** | el plan curricular como un tejido de resultados | poco evidente para el público |
| **Happy Learners** (mantener) | continuidad con el piloto | asocia a niños; inglés |

**Antes de decidir (usuario):** búsqueda fonética y gráfica en el Registro de la Propiedad Intelectual de Guatemala
(clases 41 y 42), disponibilidad del dominio y de los usuarios en redes, y una prueba rápida con 5 personas del
público (¿qué creen que hace el producto?).

## 3. Constitución de la empresa (usuario, con notario y contador)

Lista para la primera reunión: empresa individual o sociedad anónima (socios, capital, responsabilidad); inscripción
en el Registro Mercantil; RTU y régimen ante la SAT y facturación electrónica; IGSS si hay empleados; registro de la
marca; contrato tipo con instituciones (servicio, niveles de servicio con el SLO de `docs/operations/slo.md`,
tratamiento de datos de menores, propiedad del contenido, salida de datos con el respaldo); política de privacidad ya
publicada en la plataforma como base.

## 4. Brief creativo (para el diseñador)

- **Qué:** logotipo (símbolo + logotipo, versión monocroma y favicon de 16 px) y una mascota opcional para estados
  vacíos y la bienvenida.
- **Para quién:** directores, coordinadores y docentes de instituciones de todo tipo; también estudiantes y familias.
- **Tono:** confiable e institucional, cálido sin ser infantil; la IA como ayudante, no como protagonista.
- **Restricciones del producto:** la interfaz sigue Fluent 2 con la marca violeta `#5b45e0` (`--brand-80`); el logo
  debe funcionar sobre blanco, sobre la marca y en modo oscuro; contraste AA; sin degradados que dependan del color
  para leerse.
- **Entregables:** SVG y PNG, guía corta de uso (márgenes, tamaños mínimos, usos incorrectos), archivos editables.
- **No:** birretes, bombillas, robots ni manzanas (clichés de educación y de IA).

## 5. Base de conocimientos y mesa de ayuda

**Mesa de ayuda:** usar un servicio existente con plan gratuito o de bajo costo (Freshdesk o Zendesk; Jira Service
Management si se retoma Jira), enlazado desde «Ayuda y soporte» en la app. No se construye una propia.

**Artículos:** la Ayuda de la app (`apps/web/src/pages/Help.tsx`) ya cubre 27 temas; se convierten en artículos
agrupados por rol, cada uno con pasos, una captura y «qué hacer si no funciona».

| Rol | Artículos (secciones de la Ayuda) |
| --- | --- |
| Administración | Configuración académica; Cuentas del equipo; Roles y accesos; Documentos: boleta y constancia; Horarios con reglas; Uso de IA; Datos y privacidad; Términos y consentimiento |
| Coordinación | Quién hace qué; Revisar la calidad de una lección; Secciones, horario y clases; Reporte de avance y campos sugeridos |
| Docentes | Cómo se organiza un curso; Preparar y publicar una lección; Mejorar y redactar con IA; Cronograma propuesto; Horas efectivas; Grupos de trabajo; Actas de tribunal |
| Todas las personas | Bienvenida; Tu perfil y tu expediente; Tu cuenta; Preferencias; Avisos; Si algo no responde |

Orden sugerido: primero «Si algo no responde», «Tu cuenta» y «Preparar y publicar una lección» (lo que toda persona
necesita el primer día), luego el resto por rol; las preguntas reales de la mesa de ayuda reordenan la lista.
