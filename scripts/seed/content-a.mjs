// Demo organization content, part A: people, tags, programs, Matemáticas and Ciencias.
// Everything is fictional. Block helpers: T text, Q question, R resource, N teacher note (see build.mjs).
import { A, L, N, Q, R, T } from "./helpers.mjs";

export const people = [
  { id: "seed-user-marta", username: "marta.ruiz", name: "Marta Ruiz", role: "admin", title: "Coordinación académica" },
  { id: "seed-user-lucia", username: "lucia.herrera", name: "Lucía Herrera", role: "instructor", title: "Matemáticas · primaria" },
  { id: "seed-user-carlos", username: "carlos.mejia", name: "Carlos Mejía", role: "instructor", title: "Ciencias naturales" },
  { id: "seed-user-ana", username: "ana.lopez", name: "Ana López", role: "instructor", title: "Inglés" },
  { id: "seed-user-diego", username: "diego.ramirez", name: "Diego Ramírez", role: "instructor", title: "Tecnología y robótica" },
  { id: "seed-user-sofia", username: "sofia.castillo", name: "Sofía Castillo", role: "instructor", title: "Preprimaria y arte" },
];

/** Library tag groups (administration). Existing «Disciplina» terms are reused as they are. */
export const tagGroups = [
  { id: "seed-tags-skill", name: "Habilidad", terms: [["seed-tag-reading", "Lectura"], ["seed-tag-writing", "Escritura"], ["seed-tag-listening", "Escucha"], ["seed-tag-speaking", "Conversación"], ["seed-tag-logic", "Pensamiento lógico"], ["seed-tag-making", "Hacer y crear"]] },
  { id: "seed-tags-kind", name: "Tipo de recurso", terms: [["seed-tag-guide", "Guía docente"], ["seed-tag-worksheet", "Ficha de trabajo"], ["seed-tag-interactive", "Interactivo"], ["seed-tag-video", "Video"], ["seed-tag-song", "Canción"]] },
];

export const programs = [
  { id: "seed-program-primaria", name: "Primaria bilingüe", description: "Asignaturas de 1.º a 6.º primaria con enfoque por competencias. Toda lección publicada trabaja resultados de aprendizaje.", educationType: "formal", level: "primary", format: "subject", modality: "in-person", pacing: "scheduled", area: null, settings: { moduleLabel: "units", outcomesRequired: true, assessmentRequired: true }, locked: ["moduleLabel", "outcomesRequired"], by: "seed-user-marta", at: "2026-08-03T15:10:00.000Z" },
  { id: "seed-program-ingles", name: "Inglés para niños", description: "Ruta de inglés de 6 a 10 años en grupos híbridos de fin de semana, nivel A1 del MCER.", educationType: "non-formal", level: "unspecified", format: "open-course", modality: "hybrid", pacing: "scheduled", area: "023", settings: { defaultSequence: "ppp" }, locked: [], by: "seed-user-marta", at: "2026-08-03T15:40:00.000Z" },
  { id: "seed-program-tecnologia", name: "Formación tecnológica", description: "Talleres prácticos de programación y robótica para estudiantes de 9 a 12 años.", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "061", settings: { moduleLabel: "sessions", defaultSequence: "workshop" }, locked: ["moduleLabel"], by: "seed-user-marta", at: "2026-08-04T14:05:00.000Z" },
];

export const mathematics = {
  id: "seed-course-matematicas", title: "Matemáticas 3.º primaria", objective: "Resolver problemas cotidianos con números hasta 1000, las cuatro operaciones básicas, la medición y el tiempo.",
  program: "seed-program-primaria", educationType: "formal", level: "primary", format: "subject", modality: "in-person", pacing: "scheduled", area: "054", settings: {},
  lead: "seed-user-lucia", coTeachers: ["seed-user-carlos"], createdAt: "2026-08-10T14:00:00.000Z",
  competencies: [
    { id: "seed-comp-mat-numerico", name: "Pensamiento numérico", description: "Comprende el sistema de numeración decimal y opera con flexibilidad.", outcomes: [
      { id: "seed-out-mat-valor", statement: "Lee, escribe y compara números hasta 1000 usando el valor posicional.", level: "understand", evidence: "Representa un número con bloques base diez y lo ubica en la recta numérica." },
      { id: "seed-out-mat-operar", statement: "Suma y resta con reagrupación números de hasta tres cifras.", level: "apply", evidence: "Resuelve cinco operaciones explicando cada reagrupación." },
      { id: "seed-out-mat-multiplicar", statement: "Usa la multiplicación como suma repetida y organiza arreglos.", level: "apply", evidence: "Construye un arreglo rectangular para representar 4 × 6." },
    ] },
    { id: "seed-comp-mat-problemas", name: "Resolución de problemas", description: "Modela situaciones de su entorno y comunica sus estrategias.", outcomes: [
      { id: "seed-out-mat-medir", statement: "Mide longitudes y lee la hora en relojes analógicos y digitales.", level: "apply", evidence: "Mide tres objetos del aula y registra la hora de inicio y fin de una actividad." },
      { id: "seed-out-mat-problemas", statement: "Elige y justifica la operación que resuelve un problema de su entorno.", level: "evaluate", evidence: "Explica a un compañero por qué eligió sumar, restar o multiplicar." },
    ] },
  ],
  resources: [
    { id: "seed-res-mat-tabla", title: "Ficha: tabla de valor posicional", description: "Plantilla para ubicar centenas, decenas y unidades.", kind: "text", content: "Centenas | Decenas | Unidades\n\nEscribe el número en la tabla, después descomponlo:\n347 = 300 + 40 + 7\n\nPractica con: 512, 908, 260, 74.", tags: ["seed-tag-worksheet", "seed-tag-logic", "discipline-org-demo-science"], by: "seed-user-lucia" },
    { id: "seed-res-mat-khan", title: "Khan Academy: aritmética", description: "Videos y ejercicios con retroalimentación inmediata para practicar en casa.", kind: "link", content: "https://es.khanacademy.org/math/arithmetic", tags: ["seed-tag-interactive", "seed-tag-video"], by: "seed-user-lucia" },
    { id: "seed-res-mat-reloj", title: "Guía docente: leer la hora", description: "Secuencia sugerida y errores frecuentes al leer relojes analógicos.", kind: "text", content: "1. Empieza por las horas en punto con la manecilla corta.\n2. Introduce las medias horas con la imagen del reloj partido a la mitad.\n3. Cuenta de 5 en 5 para los minutos.\n\nError frecuente: leer la manecilla larga como hora. Pide que la nombren en voz alta: «la corta dice la hora».", tags: ["seed-tag-guide"], by: "seed-user-carlos" },
    { id: "seed-res-mat-phet", title: "Simulación PhET: aritmética", description: "Juego interactivo de multiplicación, factores y división.", kind: "link", content: "https://phet.colorado.edu/es/simulations/arithmetic", tags: ["seed-tag-interactive", "seed-tag-logic"], by: "seed-user-lucia" },
  ],
  modules: [
    { id: "seed-unit-mat-1", name: "Números hasta 1000", objective: "Comprender el valor posicional y comparar números.", plan: ["seed-out-mat-valor", "seed-out-mat-problemas"], lessons: [
      L("seed-les-mat-1", "Centenas, decenas y unidades", "Descomponer números de tres cifras según su valor posicional.", 40, "start-develop-close", ["seed-out-mat-valor"], [
        A("start", "¿Cuántos hay en el frasco?", 5, "explore", "whole-class", [T("Muestra un frasco con 236 frijoles agrupados en bolsitas de 100 y de 10. Pregunta: ¿cómo los contarías más rápido?"), N("Ten listas las bolsitas antes de empezar; los grupos de 10 hacen visible la reagrupación.")]),
        A("develop", "Construimos números con bloques", 20, "explain", "pairs", [T("Con bloques base diez, construyan 347, 512 y 908. Escriban cada número en la tabla de valor posicional."), R("seed-res-mat-tabla")]),
        A("close", "Comprobamos", 10, "assess", "individual", [Q("En el número 482, ¿qué valor tiene el 8?", ["8", "80", "800"], 1), Q("¿Cuál es la descomposición de 605?", ["600 + 5", "60 + 5", "600 + 50"], 0)]),
        A("close", "Lo que aprendí", 5, "reflect", "individual", [T("Escribe en tu cuaderno un número de tres cifras y explica qué significa cada cifra.")]),
      ], { published: "2026-08-19T16:00:00.000Z", by: "seed-user-lucia" }),
      L("seed-les-mat-2", "Comparar y ordenar números", "Comparar números de tres cifras con los signos <, > e =.", 35, "start-develop-close", ["seed-out-mat-valor", "seed-out-mat-problemas"], [
        A("start", "¿Quién tiene más puntos?", 5, "explore", "whole-class", [T("Dos equipos obtuvieron 457 y 475 puntos. ¿Quién ganó? ¿Cómo lo sabes?")]),
        A("develop", "La recta numérica", 15, "explain", "pairs", [T("Ubiquen en la recta 300, 350, 420 y 470. Comparen empezando por las centenas, luego decenas y unidades."), R("seed-res-mat-khan")]),
        A("close", "Ordena del menor al mayor", 15, "assess", "individual", [Q("¿Qué signo va entre 709 y 790?", ["<", ">", "="], 0), N("Si alguien elige «>», pídele que compare primero las decenas.")]),
      ], { published: "2026-08-21T16:00:00.000Z", by: "seed-user-lucia" }),
    ] },
    { id: "seed-unit-mat-2", name: "Suma y resta con reagrupación", objective: "Operar con reagrupación y estimar resultados.", plan: ["seed-out-mat-operar", "seed-out-mat-problemas"], lessons: [
      L("seed-les-mat-3", "Sumamos llevando", "Sumar números de tres cifras con reagrupación.", 40, "start-develop-close", ["seed-out-mat-operar"], [
        A("start", "Estimamos", 5, "explore", "whole-class", [T("La escuela recogió 268 botellas el lunes y 157 el martes. ¿Serán más o menos de 400? Estimen sin calcular.")]),
        A("develop", "Cambiamos 10 unidades por 1 decena", 20, "explain", "pairs", [T("Resuelvan 268 + 157 con bloques. Cada vez que junten 10 unidades, cámbienlas por una decena y registren el «llevo»."), N("Pide que verbalicen cada cambio; es la parte que más se olvida al pasar al papel.")]),
        A("close", "Practico", 15, "assess", "individual", [Q("¿Cuánto es 268 + 157?", ["415", "425", "325"], 1)]),
      ], { published: "2026-08-26T16:00:00.000Z", by: "seed-user-lucia" }),
      L("seed-les-mat-4", "Restamos prestando", "Restar con reagrupación y comprobar con la suma.", 40, "start-develop-close", ["seed-out-mat-operar", "seed-out-mat-problemas"], [
        A("start", "El problema de la tienda", 5, "explore", "whole-class", [T("Una tienda tenía 503 lápices y vendió 248. ¿Cuántos le quedan?")]),
        A("develop", "Desarmamos una centena", 20, "explain", "teams", [T("Con bloques, resuelvan 503 − 248. Cuando no alcance, desarmen una centena en 10 decenas."), T("Comprueben el resultado sumando la respuesta con 248.")]),
        A("close", "Reto en parejas", 15, "assess", "pairs", [Q("¿Cuánto es 503 − 248?", ["255", "355", "265"], 0), Q("¿Cómo compruebas una resta?", ["Sumando el resultado y lo que restaste", "Restando otra vez", "Multiplicando"], 0)]),
      ], { published: "2026-08-28T16:00:00.000Z", by: "seed-user-carlos" }),
    ] },
    { id: "seed-unit-mat-3", name: "Multiplicación como suma repetida", objective: "Comprender la multiplicación con grupos iguales y arreglos.", plan: ["seed-out-mat-multiplicar", "seed-out-mat-problemas"], lessons: [
      L("seed-les-mat-5", "Grupos iguales", "Representar multiplicaciones como grupos iguales.", 35, "start-develop-close", ["seed-out-mat-multiplicar"], [
        A("start", "Cajas de huevos", 5, "explore", "whole-class", [T("Hay 4 cajas con 6 huevos cada una. ¿Cuántos huevos hay? ¿Hay una forma más rápida que contar uno por uno?")]),
        A("develop", "Arreglos con fichas", 20, "explain", "pairs", [T("Formen filas y columnas: 4 filas de 6 fichas. Escriban la suma repetida y la multiplicación."), R("seed-res-mat-phet")]),
        A("close", "Comprobamos", 10, "assess", "individual", [Q("¿Qué multiplicación representa 5 + 5 + 5?", ["3 × 5", "5 × 5", "3 + 5"], 0)]),
      ], { published: "2026-09-02T16:00:00.000Z", by: "seed-user-lucia" }),
      L("seed-les-mat-6", "Tablas del 2, 5 y 10", "Usar patrones para aprender las tablas del 2, 5 y 10.", 35, "start-develop-close", ["seed-out-mat-multiplicar"], [
        A("start", "Contamos de 5 en 5", 5, "explore", "whole-class", [T("Cuenten en voz alta de 5 en 5 hasta 50 aplaudiendo en cada número.")]),
        A("develop", "Buscamos patrones", 20, "practice", "pairs", [T("Coloreen en la tabla del 100 los múltiplos de 2, 5 y 10. ¿Qué patrones observan?")]),
        A("close", "Juego rápido", 10, "assess", "individual", [Q("¿Cuánto es 7 × 10?", ["17", "70", "700"], 1), Q("¿Cuánto es 6 × 5?", ["30", "11", "35"], 0)]),
      ], { published: "2026-09-04T16:00:00.000Z", by: "seed-user-lucia" }),
    ] },
    { id: "seed-unit-mat-4", name: "Medición y tiempo", objective: "Medir longitudes y leer la hora.", plan: ["seed-out-mat-medir", "seed-out-mat-problemas"], lessons: [
      L("seed-les-mat-7", "Medimos el aula", "Medir longitudes en centímetros y metros.", 40, "start-develop-close", ["seed-out-mat-medir"], [
        A("start", "¿Cuántos pasos mide el aula?", 5, "explore", "whole-class", [T("Midan el largo del aula con pasos. ¿Todos obtuvieron lo mismo? ¿Por qué?")]),
        A("develop", "Usamos la regla y el metro", 25, "practice", "teams", [T("Midan su cuaderno, el pizarrón y la puerta. Registren en la tabla en cm o m."), N("Verifica que inicien la medición desde el 0 de la regla.")]),
        A("close", "Comprobamos", 10, "assess", "individual", [Q("¿Qué unidad usarías para medir un lápiz?", ["Centímetros", "Metros", "Kilómetros"], 0)]),
      ], { published: "2026-09-09T16:00:00.000Z", by: "seed-user-carlos" }),
      L("seed-les-mat-8", "¿Qué hora es?", "Leer la hora en relojes analógicos y digitales.", 40, "start-develop-close", ["seed-out-mat-medir", "seed-out-mat-problemas"], [
        A("start", "Nuestra rutina", 5, "explore", "whole-class", [T("¿A qué hora entramos, salimos al recreo y nos vamos? Escríbanlo en el pizarrón.")]),
        A("develop", "Relojes de papel", 20, "explain", "pairs", [T("Con su reloj de papel, marquen las horas de la rutina. Una persona dice la hora y la otra la marca."), R("seed-res-mat-reloj")]),
        A("close", "Problema del recreo", 15, "assess", "individual", [Q("El recreo empieza a las 10:15 y dura 30 minutos. ¿A qué hora termina?", ["10:45", "10:30", "11:15"], 0)]),
      ], { published: "2026-09-11T16:00:00.000Z", by: "seed-user-lucia" }),
    ] },
  ],
  groups: [
    { id: "seed-group-mat-3a", name: "3.º A", weekdays: [1, 3], learners: 18, by: "seed-user-lucia" },
    { id: "seed-group-mat-3b", name: "3.º B", weekdays: [2, 4], learners: 17, by: "seed-user-carlos" },
  ],
};

export const sciences = {
  id: "seed-course-ciencias", title: "Ciencias Naturales 4.º primaria", objective: "Indagar sobre los seres vivos, el agua y el cuerpo humano con experimentos sencillos y registro de evidencias.",
  program: "seed-program-primaria", educationType: "formal", level: "primary", format: "laboratory", modality: "in-person", pacing: "scheduled", area: "051", settings: {},
  lead: "seed-user-carlos", coTeachers: ["seed-user-lucia"], createdAt: "2026-08-11T14:30:00.000Z",
  competencies: [
    { id: "seed-comp-cie-indagar", name: "Indagación científica", description: "Formula preguntas, experimenta y registra evidencias.", outcomes: [
      { id: "seed-out-cie-preguntas", statement: "Formula preguntas investigables y predicciones sobre fenómenos de su entorno.", level: "understand", evidence: "Escribe una pregunta y una predicción antes de cada experimento." },
      { id: "seed-out-cie-registrar", statement: "Registra observaciones en tablas y dibujos y saca conclusiones.", level: "analyze", evidence: "Completa la bitácora con datos y una conclusión." },
    ] },
    { id: "seed-comp-cie-vida", name: "Seres vivos y su ambiente", description: "Explica características y necesidades de los seres vivos.", outcomes: [
      { id: "seed-out-cie-clasificar", statement: "Clasifica seres vivos según sus características.", level: "analyze", evidence: "Organiza diez tarjetas de seres vivos en grupos y justifica." },
      { id: "seed-out-cie-agua", statement: "Describe los estados del agua y los cambios entre ellos.", level: "understand", evidence: "Explica con un esquema el ciclo del agua." },
    ] },
  ],
  resources: [
    { id: "seed-res-cie-phet", title: "PhET: estados de la materia", description: "Simulación para observar sólidos, líquidos y gases al cambiar la temperatura.", kind: "link", content: "https://phet.colorado.edu/es/simulations/states-of-matter-basics", tags: ["seed-tag-interactive", "discipline-org-demo-science"], by: "seed-user-carlos" },
    { id: "seed-res-cie-bitacora", title: "Bitácora de laboratorio", description: "Plantilla para registrar pregunta, predicción, observaciones y conclusión.", kind: "text", content: "Pregunta:\nPredicción (creo que…):\nMateriales:\nLo que observé (dibujo y datos):\nConclusión (aprendí que…):", tags: ["seed-tag-worksheet", "seed-tag-writing", "discipline-org-demo-science"], by: "seed-user-carlos" },
    { id: "seed-res-cie-nasa", title: "NASA Space Place en español", description: "Artículos y juegos sobre la Tierra, el agua y el clima.", kind: "link", content: "https://spaceplace.nasa.gov/sp/", tags: ["seed-tag-reading", "discipline-org-demo-science"], by: "seed-user-lucia" },
  ],
  modules: [
    { id: "seed-unit-cie-1", name: "Los seres vivos", objective: "Reconocer y clasificar seres vivos.", plan: ["seed-out-cie-clasificar", "seed-out-cie-preguntas"], lessons: [
      L("seed-les-cie-1", "¿Está vivo?", "Distinguir seres vivos de objetos inertes por sus características.", 50, "five-e", ["seed-out-cie-clasificar", "seed-out-cie-preguntas"], [
        A("engage", "La caja misteriosa", 5, "explore", "whole-class", [T("Saca de una caja una planta, una piedra y un caracol. ¿Cuáles están vivos? ¿Cómo lo saben?")]),
        A("explore", "Buscamos pistas", 15, "explore", "teams", [T("Observen con lupa cada objeto y anoten en la bitácora si crece, se alimenta, respira o se reproduce."), R("seed-res-cie-bitacora")]),
        A("explain", "Características de los seres vivos", 10, "explain", "whole-class", [T("Los seres vivos nacen, crecen, se alimentan, respiran, se reproducen y mueren.")]),
        A("elaborate", "Seres vivos de nuestro patio", 5, "practice", "teams", [T("Elijan un ser vivo del patio y expliquen qué característica observaron.")]),
        A("evaluate", "Clasificamos", 15, "assess", "individual", [Q("¿Cuál de estos es un ser vivo?", ["Un hongo", "Una nube", "Un reloj"], 0)]),
      ], { published: "2026-08-20T17:00:00.000Z", by: "seed-user-carlos" }),
      L("seed-les-cie-2", "Plantas y animales", "Comparar necesidades de plantas y animales.", 50, "five-e", ["seed-out-cie-clasificar"], [
        A("engage", "¿Qué necesita un frijol?", 5, "explore", "whole-class", [T("Muestra dos frijoles germinados: uno estuvo a la luz y otro en la oscuridad. ¿Qué pasó?")]),
        A("explore", "Diseñamos el experimento", 15, "explore", "teams", [T("Cada equipo decide qué variable cambiará: luz, agua o tierra. Escriban su predicción.")]),
        A("explain", "Lo que necesitan los seres vivos", 10, "explain", "whole-class", [T("Agua, aire, alimento y un lugar adecuado. Las plantas producen su alimento con la luz.")]),
        A("elaborate", "Cuidamos una planta", 5, "practice", "teams", [T("Propongan un plan semanal para cuidar la planta del aula: luz, agua y tierra.")]),
        A("evaluate", "Comprobamos", 15, "assess", "individual", [Q("¿Qué necesita una planta para fabricar su alimento?", ["Luz", "Oscuridad", "Plástico"], 0)]),
      ], { published: "2026-08-27T17:00:00.000Z", by: "seed-user-carlos" }),
    ] },
    { id: "seed-unit-cie-2", name: "El agua y sus estados", objective: "Describir los estados del agua y sus cambios.", plan: ["seed-out-cie-agua", "seed-out-cie-registrar"], lessons: [
      L("seed-les-cie-3", "Sólido, líquido y gaseoso", "Identificar los estados del agua y qué los provoca.", 50, "five-e", ["seed-out-cie-agua", "seed-out-cie-registrar"], [
        A("engage", "El cubo de hielo", 5, "explore", "whole-class", [T("Pon un cubo de hielo en un plato. ¿Qué pasará en 20 minutos? Anoten su predicción.")]),
        A("explore", "Simulamos", 15, "explore", "pairs", [T("Con la simulación, calienten y enfríen agua. Registren qué pasa con las partículas."), R("seed-res-cie-phet")]),
        A("explain", "Cambios de estado", 10, "explain", "whole-class", [T("Fusión, evaporación, condensación y solidificación dependen de la temperatura."), N("Usa el hielo del inicio para comprobar la predicción antes de cerrar.")]),
        A("elaborate", "Agua en la cocina", 10, "practice", "teams", [T("Den un ejemplo de cada cambio de estado que ocurra en casa.")]),
        A("evaluate", "Comprobamos", 10, "assess", "individual", [Q("¿Cómo se llama el paso de líquido a gas?", ["Evaporación", "Fusión", "Condensación"], 0)]),
      ], { published: "2026-09-03T17:00:00.000Z", by: "seed-user-carlos" }),
      L("seed-les-cie-4", "El ciclo del agua", "Explicar el ciclo del agua con un modelo.", 50, "five-e", ["seed-out-cie-agua"], [
        A("engage", "¿De dónde viene la lluvia?", 5, "explore", "whole-class", [T("Escuchen sus ideas y anótenlas sin corregir.")]),
        A("explore", "Ciclo en una bolsa", 20, "explore", "teams", [T("Pongan agua con colorante en una bolsa sellada y péguenla a la ventana. Observen durante la semana."), R("seed-res-cie-nasa")]),
        A("explain", "Las etapas del ciclo", 10, "explain", "whole-class", [T("Evaporación, condensación, precipitación y escorrentía forman un ciclo continuo.")]),
        A("elaborate", "El ciclo en nuestro país", 5, "practice", "pairs", [T("¿En qué meses llueve más donde vivimos? Relacionen la temporada de lluvias con el ciclo.")]),
        A("evaluate", "Mi esquema", 10, "assess", "individual", [Q("¿Qué etapa forma las nubes?", ["Condensación", "Precipitación", "Escorrentía"], 0)]),
      ], { published: "2026-09-10T17:00:00.000Z", by: "seed-user-lucia", changes: A("elaborate", "El agua de nuestra escuela", 10, "practice", "teams", [T("¿De dónde llega el agua a la escuela y a dónde va? Investiguen con el personal y dibujen su recorrido.")]) }),
    ] },
    { id: "seed-unit-cie-3", name: "El cuerpo humano", objective: "Reconocer sistemas del cuerpo y hábitos saludables.", plan: ["seed-out-cie-registrar", "seed-out-cie-preguntas"], lessons: [
      L("seed-les-cie-5", "Nuestro esqueleto", "Identificar huesos principales y su función.", 50, "five-e", ["seed-out-cie-registrar"], [
        A("engage", "¿Qué pasaría sin huesos?", 5, "explore", "whole-class", [T("Muestra un títere de tela y uno con varillas. ¿Cuál se sostiene de pie?")]),
        A("explore", "Palpamos nuestros huesos", 15, "explore", "pairs", [T("Ubiquen en su cuerpo el cráneo, las costillas y la columna. Dibújenlos en la silueta.")]),
        A("explain", "Funciones del esqueleto", 10, "explain", "whole-class", [T("Sostiene, protege órganos y permite el movimiento con ayuda de los músculos.")]),
        A("elaborate", "Huesos en movimiento", 5, "practice", "pairs", [T("Hagan un movimiento y digan qué huesos y articulaciones usaron.")]),
        A("evaluate", "Comprobamos", 15, "assess", "individual", [Q("¿Qué protegen las costillas?", ["El corazón y los pulmones", "El estómago", "Los pies"], 0)]),
      ], { published: "2026-09-17T17:00:00.000Z", by: "seed-user-carlos" }),
      L("seed-les-cie-6", "Hábitos saludables", "Proponer hábitos para cuidar el cuerpo.", 40, "five-e", ["seed-out-cie-preguntas"], [
        A("engage", "Un día de Leo", 5, "explore", "whole-class", [T("Lee la rutina de Leo y pide que identifiquen qué hábitos le ayudan y cuáles no.")]),
        A("explore", "Encuesta en el grupo", 15, "explore", "teams", [T("Pregunten a cinco compañeros cuántas horas duermen y cuánta agua beben. Registren en una tabla.")]),
        A("elaborate", "Nuestro cartel", 20, "practice", "teams", [T("Diseñen un cartel con tres hábitos y la razón científica de cada uno.")]),
      ], { by: "seed-user-carlos" }),
    ] },
  ],
  groups: [{ id: "seed-group-cie-4a", name: "4.º A", weekdays: [1, 4], learners: 20, by: "seed-user-carlos" }],
};
