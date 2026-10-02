// Demo organization content, part B: English, Robotics, Art, an archived course and the existing demo course.
import { A, L, N, Q, R, T } from "./helpers.mjs";

export const english = {
  id: "seed-course-english", title: "English Explorers A1", objective: "Comunicarse en inglés en situaciones cotidianas: saludar, hablar de la familia, la comida y los animales.",
  program: "seed-program-ingles", educationType: "non-formal", level: "unspecified", format: "open-course", modality: "hybrid", pacing: "scheduled", area: "023", settings: {},
  lead: "seed-user-ana", coTeachers: ["seed-user-sofia"], createdAt: "2026-08-12T15:00:00.000Z",
  competencies: [
    { id: "seed-comp-eng-oral", name: "Interacción oral", description: "Participa en intercambios breves y sencillos.", outcomes: [
      { id: "seed-out-eng-introduce", statement: "Saluda, se presenta y pregunta datos personales básicos.", level: "apply", evidence: "Mantiene un diálogo de cuatro turnos con un compañero." },
      { id: "seed-out-eng-describe", statement: "Describe a su familia y sus gustos con frases sencillas.", level: "apply", evidence: "Presenta a su familia con una foto o un dibujo." },
    ] },
    { id: "seed-comp-eng-vocab", name: "Vocabulario y comprensión", description: "Reconoce vocabulario frecuente al escuchar y leer.", outcomes: [
      { id: "seed-out-eng-listen", statement: "Comprende instrucciones y preguntas breves al escucharlas.", level: "understand", evidence: "Responde con gestos o palabras a cinco instrucciones." },
      { id: "seed-out-eng-words", statement: "Nombra alimentos y animales comunes.", level: "remember", evidence: "Nombra ocho tarjetas de vocabulario sin ayuda." },
    ] },
  ],
  resources: [
    { id: "seed-res-eng-bc", title: "LearnEnglish Kids (British Council)", description: "Canciones, cuentos y juegos para practicar en casa.", kind: "link", content: "https://learnenglishkids.britishcouncil.org/", tags: ["seed-tag-listening", "seed-tag-interactive", "discipline-org-demo-languages"], by: "seed-user-ana" },
    { id: "seed-res-eng-song", title: "Hello song (letra)", description: "Canción de bienvenida para empezar cada clase.", kind: "text", content: "Hello, hello, how are you?\nI'm fine, I'm fine, and I hope that you are too.\nHello, hello, what's your name?\nMy name is ___, let's play a game!", tags: ["seed-tag-song", "seed-tag-listening", "discipline-org-demo-languages"], by: "seed-user-sofia" },
    { id: "seed-res-eng-family", title: "Flashcards: family", description: "Vocabulario de la familia con frases modelo.", kind: "text", content: "mother · father · sister · brother · grandmother · grandfather\n\nThis is my mother. She is kind.\nThis is my brother. He is funny.", tags: ["seed-tag-worksheet", "seed-tag-speaking", "discipline-org-demo-languages"], by: "seed-user-ana" },
  ],
  modules: [
    { id: "seed-unit-eng-1", name: "Hello!", objective: "Greet people and introduce yourself.", plan: ["seed-out-eng-introduce", "seed-out-eng-listen"], lessons: [
      L("seed-les-eng-1", "Hello, what's your name?", "Saludar y decir el nombre.", 40, "ppp", ["seed-out-eng-introduce", "seed-out-eng-listen"], [
        A("presentation", "Hello song", 10, "explain", "whole-class", [T("Sing the Hello song with gestures. Point to yourself when you say «my name is»."), R("seed-res-eng-song")]),
        A("practice", "Name chain", 15, "practice", "whole-class", [T("Sit in a circle. Ask «What's your name?» to the person on your right and answer «My name is…»."), N("Model the question twice before starting; praise attempts, not just accuracy.")]),
        A("production", "Meet a friend", 10, "practice", "pairs", [T("Walk around and meet three classmates. Say hello, your name and goodbye.")]),
        A("production", "Check", 5, "assess", "individual", [Q("How do you answer «What's your name?»", ["My name is Ana.", "I'm six.", "Goodbye!"], 0)]),
      ], { published: "2026-08-22T15:00:00.000Z", by: "seed-user-ana" }),
      L("seed-les-eng-2", "How old are you?", "Preguntar y decir la edad con números del 1 al 10.", 40, "ppp", ["seed-out-eng-introduce"], [
        A("presentation", "Numbers 1–10", 10, "explain", "whole-class", [T("Count fingers from one to ten, then backwards. Show number cards in random order.")]),
        A("practice", "Birthday cake", 15, "practice", "pairs", [T("Draw candles on a cake and ask «How old are you?». Your partner answers «I'm seven».")]),
        A("production", "Check", 10, "assess", "individual", [Q("«I'm eight» means…", ["Tengo ocho años", "Me llamo Ocho", "Ocho amigos"], 0)]),
      ], { published: "2026-08-29T15:00:00.000Z", by: "seed-user-ana" }),
    ] },
    { id: "seed-unit-eng-2", name: "My family", objective: "Talk about family members.", plan: ["seed-out-eng-describe", "seed-out-eng-words"], lessons: [
      L("seed-les-eng-3", "This is my family", "Presentar a los miembros de la familia.", 45, "ppp", ["seed-out-eng-describe"], [
        A("presentation", "Family flashcards", 10, "explain", "whole-class", [T("Show the flashcards and say each word. Students repeat and point to the picture."), R("seed-res-eng-family")]),
        A("practice", "Who is it?", 15, "practice", "pairs", [T("Describe a family member from the cards; your partner guesses who it is.")]),
        A("production", "My family poster", 15, "practice", "individual", [T("Draw your family and present it: «This is my mother. She is…»")]),
        A("production", "Check", 5, "assess", "individual", [Q("Your father's mother is your…", ["grandmother", "sister", "aunt"], 0)]),
      ], { published: "2026-09-05T15:00:00.000Z", by: "seed-user-sofia" }),
      L("seed-les-eng-4", "He is funny, she is kind", "Describir a la familia con adjetivos.", 40, "ppp", ["seed-out-eng-describe", "seed-out-eng-listen"], [
        A("presentation", "Adjectives mime", 10, "explain", "whole-class", [T("Mime happy, funny, tall, short and kind. Students guess the word.")]),
        A("practice", "Listen and point", 15, "practice", "whole-class", [T("Listen to the descriptions and point to the right person on the poster.")]),
        A("production", "Check", 15, "assess", "pairs", [Q("Which sentence is correct?", ["She is kind.", "She are kind.", "She kind is."], 0)]),
      ], { published: "2026-09-12T15:00:00.000Z", by: "seed-user-ana" }),
    ] },
    { id: "seed-unit-eng-3", name: "Food I like", objective: "Say what food you like and don't like.", plan: ["seed-out-eng-words", "seed-out-eng-describe"], lessons: [
      L("seed-les-eng-5", "I like apples", "Expresar gustos sobre comida.", 40, "ppp", ["seed-out-eng-words", "seed-out-eng-describe"], [
        A("presentation", "Food basket", 10, "explain", "whole-class", [T("Take toy food out of a basket: apple, banana, bread, milk, rice, chicken. Say «I like…» or «I don't like…» with a face.")]),
        A("practice", "Thumbs up, thumbs down", 15, "practice", "whole-class", [T("Say a food; students show thumbs up or down and say the sentence.")]),
        A("production", "Class survey", 10, "practice", "teams", [T("Ask five classmates «Do you like…?» and mark the chart.")]),
        A("production", "Check", 5, "assess", "individual", [Q("«I don't like milk» means…", ["No me gusta la leche", "Me gusta la leche", "Quiero leche"], 0)]),
      ], { published: "2026-09-19T15:00:00.000Z", by: "seed-user-ana" }),
    ] },
    { id: "seed-unit-eng-4", name: "Animals", objective: "Name and describe animals.", plan: ["seed-out-eng-words", "seed-out-eng-listen"], lessons: [
      L("seed-les-eng-6", "At the farm", "Nombrar animales de la granja y sus sonidos.", 40, "ppp", ["seed-out-eng-words", "seed-out-eng-listen"], [
        A("presentation", "Animal sounds", 10, "explain", "whole-class", [T("Play animal sounds; students guess: cow, pig, duck, horse, sheep."), R("seed-res-eng-bc")]),
        A("practice", "Simon says animals", 15, "practice", "whole-class", [T("«Simon says: walk like a duck!» Students act only when they hear «Simon says».")]),
        A("production", "Check", 15, "assess", "individual", [Q("Which animal says «moo»?", ["cow", "duck", "pig"], 0)]),
      ], { by: "seed-user-sofia" }),
    ] },
  ],
  groups: [{ id: "seed-group-eng-sab", name: "Sábados 9:00", weekdays: [6], learners: 14, by: "seed-user-ana", from: "2026-08-22" }],
};

export const robotics = {
  id: "seed-course-robotica", title: "Taller de robótica educativa", objective: "Diseñar, construir y programar un robot sencillo que resuelva un reto, trabajando en equipo.",
  program: "seed-program-tecnologia", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "071", settings: {},
  lead: "seed-user-diego", coTeachers: [], createdAt: "2026-08-13T16:00:00.000Z",
  competencies: [
    { id: "seed-comp-rob-pensamiento", name: "Pensamiento computacional", description: "Descompone problemas y crea algoritmos.", outcomes: [
      { id: "seed-out-rob-algoritmo", statement: "Escribe algoritmos con secuencias, bucles y condiciones.", level: "apply", evidence: "Programa un recorrido que usa un bucle y un sensor." },
      { id: "seed-out-rob-depurar", statement: "Encuentra y corrige errores en un programa.", level: "analyze", evidence: "Explica qué falló y cómo lo corrigió en su bitácora." },
    ] },
    { id: "seed-comp-rob-diseno", name: "Diseño y construcción", description: "Construye prototipos que responden a un reto.", outcomes: [
      { id: "seed-out-rob-construir", statement: "Construye un robot siguiendo un diseño y lo mejora tras probarlo.", level: "create", evidence: "Presenta su robot y dos mejoras realizadas." },
    ] },
  ],
  resources: [
    { id: "seed-res-rob-seguridad", title: "Checklist de seguridad del kit", description: "Revisión antes y después de cada sesión.", kind: "text", content: "Antes: baterías cargadas, piezas contadas, mesa despejada.\nDurante: cables lejos del borde, no tocar motores en marcha.\nDespués: desconectar baterías, guardar piezas en su bolsa.", tags: ["seed-tag-guide", "discipline-org-demo-technology"], by: "seed-user-diego" },
    { id: "seed-res-rob-scratch", title: "Scratch", description: "Programación por bloques para planear el algoritmo antes de pasarlo al robot.", kind: "link", content: "https://scratch.mit.edu/", tags: ["seed-tag-interactive", "seed-tag-logic", "discipline-org-demo-technology"], by: "seed-user-diego" },
    { id: "seed-res-rob-code", title: "Code.org: cursos por bloques", description: "Actividades guiadas de algoritmos y bucles.", kind: "link", content: "https://code.org/", tags: ["seed-tag-interactive", "seed-tag-logic"], by: "seed-user-diego" },
  ],
  modules: [
    { id: "seed-unit-rob-1", name: "Conocemos el kit", objective: "Identificar piezas, motores y sensores.", plan: ["seed-out-rob-construir"], lessons: [
      L("seed-les-rob-1", "Piezas, motores y sensores", "Reconocer las partes del kit y su función.", 90, "workshop", ["seed-out-rob-construir"], [
        A("demonstration", "Así funciona un robot", 15, "explain", "whole-class", [T("Muestra un robot armado: cerebro (controlador), músculos (motores) y sentidos (sensores)."), R("seed-res-rob-seguridad"), N("Revisa la checklist de seguridad con el grupo antes de abrir los kits.")]),
        A("guided", "Inventario por equipos", 30, "practice", "teams", [T("Cada equipo cuenta y clasifica sus piezas en la hoja de inventario.")]),
        A("independent", "Primer movimiento", 35, "practice", "teams", [T("Conecten un motor y háganlo girar desde la tableta durante 3 segundos.")]),
        A("independent", "Comprobamos", 10, "assess", "individual", [Q("¿Qué parte del robot recibe información del entorno?", ["El sensor", "El motor", "La batería"], 0)]),
      ], { published: "2026-08-25T18:00:00.000Z", by: "seed-user-diego" }),
    ] },
    { id: "seed-unit-rob-2", name: "Programamos el movimiento", objective: "Usar secuencias y bucles para mover el robot.", plan: ["seed-out-rob-algoritmo"], lessons: [
      L("seed-les-rob-2", "Secuencias y bucles", "Programar un recorrido con secuencias y repeticiones.", 90, "workshop", ["seed-out-rob-algoritmo"], [
        A("demonstration", "El cuadrado", 15, "explain", "whole-class", [T("Programa en Scratch un gato que dibuja un cuadrado. ¿Qué bloques se repiten?"), R("seed-res-rob-scratch")]),
        A("guided", "Del gato al robot", 30, "practice", "teams", [T("Pasen el algoritmo del cuadrado al robot usando un bucle «repetir 4 veces».")]),
        A("independent", "Recorrido libre", 35, "practice", "teams", [T("Diseñen un recorrido con forma de letra y prográmenlo.")]),
        A("independent", "Comprobamos", 10, "assess", "individual", [Q("¿Para qué sirve un bucle?", ["Repetir instrucciones", "Apagar el robot", "Medir distancia"], 0)]),
      ], { published: "2026-09-01T18:00:00.000Z", by: "seed-user-diego" }),
    ] },
    { id: "seed-unit-rob-3", name: "Sensores y decisiones", objective: "Programar decisiones con sensores.", plan: ["seed-out-rob-algoritmo", "seed-out-rob-depurar"], lessons: [
      L("seed-les-rob-3", "Si hay un obstáculo…", "Usar el sensor de distancia para tomar decisiones.", 90, "workshop", ["seed-out-rob-algoritmo", "seed-out-rob-depurar"], [
        A("demonstration", "Condiciones", 15, "explain", "whole-class", [T("«Si la distancia es menor a 10 cm, gira; si no, avanza». Escenifícalo con un estudiante con los ojos vendados.")]),
        A("guided", "Probamos el sensor", 30, "practice", "teams", [T("Muestren en pantalla la lectura del sensor al acercar la mano.")]),
        A("independent", "Robot que esquiva", 35, "practice", "teams", [T("Programen el robot para avanzar y esquivar una caja. Anoten cada error y cómo lo corrigieron."), R("seed-res-rob-code")]),
        A("independent", "Comprobamos", 10, "assess", "individual", [Q("Si el robot choca siempre, ¿qué revisarías primero?", ["El valor de distancia en la condición", "El color del robot", "El nombre del programa"], 0)]),
      ], { published: "2026-09-08T18:00:00.000Z", by: "seed-user-diego" }),
    ] },
    { id: "seed-unit-rob-4", name: "Reto final", objective: "Resolver un reto integrando lo aprendido.", plan: ["seed-out-rob-construir", "seed-out-rob-depurar"], lessons: [
      L("seed-les-rob-4", "El rescate en el laberinto", "Construir y programar un robot que rescate un objeto en un laberinto.", 120, "workshop", ["seed-out-rob-construir", "seed-out-rob-depurar"], [
        A("demonstration", "Presentamos el reto", 15, "explain", "whole-class", [T("El robot debe salir de la base, encontrar el cubo y regresarlo en menos de 3 minutos.")]),
        A("guided", "Plan del equipo", 30, "practice", "teams", [T("Dibujen el recorrido, repartan roles y escriban el algoritmo en papel.")]),
        A("independent", "Construimos y probamos", 60, "practice", "teams", [T("Construyan, prueben y mejoren. Registren dos mejoras en la bitácora."), N("Pendiente: preparar el laberinto con cajas antes de la sesión.")]),
      ], { by: "seed-user-diego" }),
    ] },
  ],
  groups: [{ id: "seed-group-rob-mar", name: "Martes 15:00", weekdays: [2], learners: 12, by: "seed-user-diego", from: "2026-08-25" }],
};

export const art = {
  id: "seed-course-arte", title: "Arte y expresión creativa", objective: "Explorar el color, las formas y las texturas para expresar ideas y emociones.",
  program: null, educationType: "formal", level: "pre-primary", format: "subject", modality: "in-person", pacing: "scheduled", area: "021", settings: { moduleLabel: "topics", outcomesRequired: false, assessmentRequired: false },
  lead: "seed-user-sofia", coTeachers: ["seed-user-ana"], createdAt: "2026-08-14T14:00:00.000Z",
  competencies: [
    { id: "seed-comp-art-expresion", name: "Expresión artística", description: "Usa materiales y técnicas para comunicar ideas.", outcomes: [
      { id: "seed-out-art-color", statement: "Mezcla colores primarios para obtener secundarios.", level: "apply", evidence: "Obtiene verde, naranja y morado y los nombra." },
      { id: "seed-out-art-crear", statement: "Crea una obra con formas y texturas y la explica.", level: "create", evidence: "Presenta su obra al grupo diciendo qué quiso expresar." },
      { id: "seed-out-art-observar", statement: "Describe con sus palabras colores, formas y emociones que observa en una obra.", level: "understand", evidence: "Comenta una obra de arte nombrando dos colores, una forma y lo que le hace sentir." },
    ] },
  ],
  resources: [
    { id: "seed-res-art-mezclas", title: "Guía: mezcla de colores primarios", description: "Preparación de la mesa y preguntas para guiar la exploración.", kind: "text", content: "Prepara tres vasos con témpera roja, azul y amarilla, platos y pinceles.\nPreguntas: ¿qué pasa si mezclas rojo y amarillo? ¿Y azul y amarillo?\nCierra pidiendo que nombren el color nuevo.", tags: ["seed-tag-guide", "seed-tag-making", "discipline-org-demo-arts"], by: "seed-user-sofia" },
    { id: "seed-res-art-gac", title: "Google Arts & Culture", description: "Obras de museos del mundo para observar colores y formas.", kind: "link", content: "https://artsandculture.google.com/", tags: ["seed-tag-interactive", "discipline-org-demo-arts"], by: "seed-user-ana" },
  ],
  modules: [
    { id: "seed-unit-art-1", name: "El color", objective: "Explorar y mezclar colores.", plan: ["seed-out-art-color"], lessons: [
      L("seed-les-art-1", "Colores primarios", "Reconocer el rojo, el azul y el amarillo en el entorno.", 30, "start-develop-close", ["seed-out-art-color"], [
        A("start", "Búsqueda del color", 5, "explore", "whole-class", [T("Busquen en el aula objetos rojos, azules y amarillos y pónganlos en su aro.")]),
        A("develop", "Pintamos con un color", 20, "practice", "individual", [T("Elige un color primario y pinta todo lo que se te ocurra con él."), N("Ten toallas húmedas a mano; algunos niños no toleran la pintura en las manos.")]),
        A("close", "¿Qué color es?", 5, "assess", "whole-class", [Q("¿Cuál es un color primario?", ["Azul", "Verde", "Rosa"], 0)]),
      ], { published: "2026-08-24T15:00:00.000Z", by: "seed-user-sofia" }),
      L("seed-les-art-2", "Magia de colores", "Mezclar colores primarios para obtener secundarios.", 35, "start-develop-close", ["seed-out-art-color"], [
        A("start", "El cuento de los colores", 5, "explore", "whole-class", [T("Cuenta la historia de Rojo y Amarillo que se abrazan y se convierten en Naranja.")]),
        A("develop", "Mezclamos", 20, "practice", "pairs", [T("En parejas, mezclen dos colores en su plato y descubran el color nuevo."), R("seed-res-art-mezclas")]),
        A("close", "Comprobamos", 10, "assess", "individual", [Q("¿Qué color sale al mezclar azul y amarillo?", ["Verde", "Morado", "Naranja"], 0)]),
      ], { published: "2026-08-31T15:00:00.000Z", by: "seed-user-sofia" }),
    ] },
    { id: "seed-unit-art-2", name: "Formas y texturas", objective: "Crear con formas y texturas.", plan: ["seed-out-art-crear", "seed-out-art-observar"], lessons: [
      L("seed-les-art-3", "Collage de texturas", "Crear un collage combinando texturas.", 35, "start-develop-close", ["seed-out-art-crear"], [
        A("start", "La caja de texturas", 5, "explore", "whole-class", [T("Con los ojos cerrados, toquen lija, algodón, papel aluminio y tela. ¿Cómo se sienten?")]),
        A("develop", "Mi collage", 25, "practice", "individual", [T("Peguen materiales con distintas texturas para formar un animal o un paisaje.")]),
        A("close", "Galería", 5, "reflect", "whole-class", [T("Recorran la galería y digan qué textura les gustó más.")]),
      ], { published: "2026-09-07T15:00:00.000Z", by: "seed-user-ana" }),
      L("seed-les-art-4", "Mirar como artistas", "Observar obras y reconocer formas y colores.", 30, "start-develop-close", ["seed-out-art-observar", "seed-out-art-color"], [
        A("start", "¿Qué ves?", 5, "explore", "whole-class", [T("Proyecta una obra y pide que digan colores y formas que ven."), R("seed-res-art-gac")]),
        A("develop", "Nos inspiramos", 20, "practice", "individual", [T("Dibuja tu propia versión usando las mismas formas.")]),
        A("close", "Comprobamos", 5, "assess", "whole-class", [Q("¿Qué forma tiene una rueda?", ["Círculo", "Cuadrado", "Triángulo"], 0)]),
      ], { published: "2026-09-14T15:00:00.000Z", by: "seed-user-sofia" }),
    ] },
    { id: "seed-unit-art-3", name: "Arte y emociones", objective: "Expresar emociones con el arte.", plan: ["seed-out-art-crear", "seed-out-art-observar"], lessons: [
      L("seed-les-art-5", "Colores que sienten", "Asociar colores con emociones.", 30, "start-develop-close", ["seed-out-art-crear"], [
        A("start", "¿De qué color es la alegría?", 5, "explore", "whole-class", [T("Muestra caras con emociones y pregunta qué color les pondrían.")]),
        A("develop", "Pinto cómo me siento", 20, "practice", "individual", [T("Pinta cómo te sientes hoy usando los colores que elijas.")]),
      ], { by: "seed-user-sofia" }),
    ] },
  ],
  groups: [{ id: "seed-group-art-k2", name: "Preprimaria K2", weekdays: [1, 3, 5], learners: 16, by: "seed-user-sofia" }],
};

/** A finished course from last year, archived: its published lesson stays available. */
export const archivedCourse = {
  id: "seed-course-lectura", title: "Club de lectura 2025", objective: "Leer y comentar cuentos breves en grupo.", archived: true,
  program: null, educationType: "non-formal", level: "unspecified", format: "seminar", modality: "in-person", pacing: "scheduled", area: "022", settings: {},
  lead: "seed-user-ana", coTeachers: [], createdAt: "2025-02-03T15:00:00.000Z",
  competencies: [], resources: [],
  modules: [{ id: "seed-unit-lec-1", name: "Cuentos breves", objective: "Comentar cuentos en grupo.", plan: [], lessons: [
    L("seed-les-lec-1", "El cuento del mes", "Leer un cuento y conversar sobre los personajes.", 45, "start-develop-close", [], [
      A("start", "Predicción", 5, "explore", "whole-class", [T("Muestra la portada: ¿de qué tratará?")]),
      A("develop", "Leemos juntos", 30, "explain", "whole-class", [T("Lectura en voz alta con pausas para preguntar qué pasará después.")]),
      A("close", "Comentamos", 10, "assess", "teams", [Q("¿Quién era el personaje principal?", ["El zorro", "La luna", "El río"], 0)]),
    ], { published: "2025-03-01T15:00:00.000Z", by: "seed-user-ana" }),
  ] }],
  groups: [],
};

/** The existing demo course keeps its content; Ana joins its team and its attendance gets a history. */
export const exploradores = { id: "course-exploradores", coTeachers: ["seed-user-ana"], group: "group-demo-class", weekdays: [2, 4] };
