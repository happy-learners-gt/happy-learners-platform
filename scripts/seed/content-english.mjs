// Demo organization content, part D: an English program by CEFR level, A1 to C2 (DEC-035). Each level requires the
// previous one; each has a scheduled section whose first classes are already planned, so planning shows when the
// lessons of a class fit its time and when they exceed it. Everything is fictional.
import { A, L, Q, R, T } from "./helpers.mjs";

export const englishPeople = [
  { id: "seed-user-tomas", username: "tomas.aguilar", name: "Tomás Aguilar", role: "instructor", title: "Inglés · jóvenes y adultos" },
];

export const englishPrograms = [
  { id: "seed-program-ingles-mcer", name: "Inglés por niveles (MCER)", description: "Inglés para jóvenes y adultos en seis niveles del Marco Común Europeo, de A1 a C2. Cada nivel requiere el anterior.", educationType: "non-formal", level: "unspecified", format: "open-course", modality: "in-person", pacing: "scheduled", area: "023", settings: { moduleLabel: "units" }, locked: [], by: "seed-user-marta", at: "2026-09-01T15:00:00.000Z" },
];

/** A lesson in three moments; its duration is the sum of its activities. */
function lesson(id, item, minutes, outcomeId, resourceId, published, by) {
  const [start, develop, close] = minutes;
  const activities = [
    A("start", item.start[0], start, "explore", "whole-class", [T(item.start[1])]),
    A("develop", item.develop[0], develop, "practice", "pairs", [T(item.develop[1]), ...resourceId ? [R(resourceId)] : []]),
    A("close", "Check your understanding", close, "assess", "individual", [Q(...item.check)]),
  ];
  return L(id, item.title, item.goal, start + develop + close, "start-develop-close", [outcomeId], activities, { published, by });
}

/** A level: two units with two published lessons each, a resource, two outcomes and one scheduled section. */
function level({ code, title, objective, lead, coTeachers = [], createdAt, requires, minutes, outcomes, resource, units, section }) {
  const key = `ingles-${code.toLowerCase()}`;
  const outcomeIds = outcomes.map((_, index) => `seed-out-${key}-${index + 1}`);
  const resourceId = `seed-res-${key}`;
  const day = Date.parse(createdAt);
  let count = 0;
  return {
    id: `seed-course-${key}`, title, objective, program: "seed-program-ingles-mcer", educationType: "non-formal", level: "unspecified", format: "open-course", modality: "in-person", pacing: "scheduled", area: "023", settings: {},
    lead, coTeachers, createdAt, requires,
    competencies: [{ id: `seed-comp-${key}`, name: `Comunicación en inglés ${code}`, description: objective, outcomes: outcomes.map(([statement, cognitive, evidence], index) => ({ id: outcomeIds[index], statement, level: cognitive, evidence })) }],
    resources: [{ id: resourceId, title: resource[0], description: resource[1], kind: "text", content: resource[2], tags: ["seed-tag-guide"], by: lead }],
    modules: units.map((unit, index) => ({
      id: `seed-unit-${key}-${index + 1}`, name: unit.name, objective: unit.objective, plan: [outcomeIds[index]],
      lessons: unit.lessons.map((item, position) => { count++; return lesson(`seed-les-${key}-${count}`, item, minutes, outcomeIds[index], index === 0 && position === 0 ? resourceId : null, new Date(day + (5 + count * 2) * 86400000).toISOString(), lead); }),
    })),
    groups: [{ id: `seed-group-${key}`, name: section.name, learners: section.learners, by: "seed-user-marta", educators: section.educators,
      schedule: { weekdays: section.weekdays, startsAt: section.startsAt, durationMinutes: section.durationMinutes, from: "2026-10-12", until: "2026-12-18" },
      plan: section.plan.map(numbers => numbers.map(number => `seed-les-${key}-${number}`)) }],
  };
}

export const englishCourses = [
  level({ code: "A1", title: "Inglés A1: primeros pasos", objective: "Presentarse, hablar de lo cotidiano y entender frases sencillas sobre temas conocidos.", lead: "seed-user-ana", createdAt: "2026-09-02T14:00:00.000Z", requires: [], minutes: [5, 25, 10],
    outcomes: [["Se presenta y presenta a otras personas con frases sencillas.", "apply", "Se presenta en voz alta: nombre, edad, ciudad y un gusto."], ["Pregunta y responde sobre rutinas y lugares.", "apply", "Describe su día en cinco frases en presente simple."]],
    resource: ["Guía: frases para presentarse", "Frases modelo del nivel A1.", "Hi, I'm Laura. I'm from Antigua.\nI'm 24 years old. I like music.\nNice to meet you!"],
    units: [
      { name: "Hello!", objective: "Saludar y presentarse.", lessons: [
        { title: "Nice to meet you", goal: "Saludar y presentarse con nombre y procedencia.", start: ["Name game", "En círculo, cada persona dice «Hi, I'm…» y repite el nombre de quien habló antes."], develop: ["Introduce your partner", "En parejas, pregunten «What's your name? Where are you from?» y presenten a su pareja a la clase."], check: ["¿Cómo respondes a «Nice to meet you»?", ["Nice to meet you too", "I'm fine", "Goodbye"], 0] },
        { title: "Numbers and ages", goal: "Decir y preguntar la edad y números del 1 al 100.", start: ["Count together", "Cuenten de diez en diez hasta cien con palmadas."], develop: ["Phone numbers", "En parejas, díctense números de teléfono ficticios y verifiquen que los anotaron bien."], check: ["«I'm twenty-five» quiere decir que tengo…", ["25 años", "52 años", "15 años"], 0] },
      ] },
      { name: "My day", objective: "Hablar de rutinas y lugares.", lessons: [
        { title: "Daily routines", goal: "Describir la rutina diaria en presente simple.", start: ["What time is it?", "Muestra relojes con distintas horas. La clase dice la hora en inglés."], develop: ["My routine", "En parejas, cuéntense su día: «I get up at seven. I have breakfast at…»."], check: ["Completa: «She ___ up at seven».", ["gets", "get", "getting"], 0] },
        { title: "Around town", goal: "Preguntar y dar direcciones sencillas.", start: ["Places in town", "Nombra lugares de la ciudad con imágenes: bank, park, market, school."], develop: ["Where is the bank?", "Con un mapa, una persona pregunta «Where is…?» y la otra responde «It's next to…»."], check: ["«It's next to the park» significa que está…", ["Al lado del parque", "Lejos del parque", "Dentro del parque"], 0] },
      ] },
    ],
    section: { name: "A1 · Lunes y miércoles 08:00", learners: 12, educators: ["seed-user-ana"], weekdays: [1, 3], startsAt: "08:00", durationMinutes: 60, plan: [[1, 2], [3], [4]] } }),

  level({ code: "A2", title: "Inglés A2: situaciones cotidianas", objective: "Comunicarse en tareas simples y habituales: compras, planes y experiencias pasadas.", lead: "seed-user-tomas", coTeachers: ["seed-user-ana"], createdAt: "2026-09-03T14:00:00.000Z", requires: ["seed-course-ingles-a1"], minutes: [5, 25, 10],
    outcomes: [["Resuelve compras y pedidos en situaciones conocidas.", "apply", "Representa una compra en una tienda con precios y cantidades."], ["Cuenta experiencias pasadas en pasado simple.", "apply", "Narra su último fin de semana en seis frases."]],
    resource: ["Guía: verbos irregulares frecuentes", "Los verbos del nivel A2 en pasado.", "go – went\nhave – had\nsee – saw\nbuy – bought\neat – ate"],
    units: [
      { name: "Shopping", objective: "Comprar y pedir cosas.", lessons: [
        { title: "How much is it?", goal: "Preguntar precios y pagar en una tienda.", start: ["Price tags", "Muestra productos con precio. La clase pregunta «How much is it?»."], develop: ["At the market", "En parejas, representen una compra: saludo, pedido, precio y pago."], check: ["¿Qué preguntas para saber el precio?", ["How much is it?", "How many is it?", "What time is it?"], 0] },
        { title: "At the restaurant", goal: "Pedir comida y bebida con cortesía.", start: ["Menu reading", "Lean un menú corto y elijan qué pedirían."], develop: ["Can I have…?", "En grupos de tres, una persona atiende y dos piden con «Can I have…, please?»."], check: ["La forma más cortés de pedir es…", ["Can I have a coffee, please?", "Give me coffee.", "Coffee now."], 0] },
      ] },
      { name: "Last weekend", objective: "Contar lo que pasó.", lessons: [
        { title: "What did you do?", goal: "Preguntar y responder sobre el fin de semana.", start: ["Weekend photos", "Muestra fotos de actividades. ¿Qué hizo esta persona el sábado?"], develop: ["Find someone who…", "Circulen preguntando «Did you…?» hasta completar la tabla con nombres."], check: ["Pasado de «go»:", ["went", "goed", "gone"], 0] },
        { title: "A short story", goal: "Narrar una experiencia con conectores de tiempo.", start: ["First, then, finally", "Ordenen cuatro tarjetas de una historia usando first, then, after that, finally."], develop: ["Tell your story", "En parejas, cuenten un viaje o paseo usando cuatro conectores."], check: ["¿Qué conector cierra una historia?", ["Finally", "First", "Then"], 0] },
      ] },
    ],
    section: { name: "A2 · Lunes y miércoles 08:00", learners: 10, educators: ["seed-user-tomas"], weekdays: [1, 3], startsAt: "08:00", durationMinutes: 60, plan: [[1], [2], [3]] } }),

  level({ code: "B1", title: "Inglés B1: opiniones y planes", objective: "Desenvolverse en viajes, describir experiencias y justificar opiniones y planes.", lead: "seed-user-ana", coTeachers: ["seed-user-tomas"], createdAt: "2026-09-04T14:00:00.000Z", requires: ["seed-course-ingles-a2"], minutes: [10, 25, 10],
    outcomes: [["Expresa y justifica opiniones sobre temas conocidos.", "analyze", "Da su opinión con dos razones en un debate breve."], ["Habla de planes y predicciones.", "apply", "Describe sus planes del próximo año con will y going to."]],
    resource: ["Guía: expresiones para opinar", "Frases para dar y pedir opiniones.", "In my opinion…\nI think that… because…\nWhat do you think about…?\nI agree / I don't agree."],
    units: [
      { name: "In my opinion", objective: "Opinar y argumentar.", lessons: [
        { title: "Agree or disagree?", goal: "Dar opiniones y reaccionar a las de otros.", start: ["Four corners", "Lee una afirmación; cada persona va a la esquina que muestra cuánto está de acuerdo."], develop: ["Mini debate", "En parejas, defiendan posturas opuestas sobre el uso del celular en clase con dos razones."], check: ["¿Qué frase introduce una opinión?", ["In my opinion…", "Last weekend…", "How much…"], 0] },
        { title: "Reviews", goal: "Escribir una reseña breve con valoración.", start: ["Stars", "Lean dos reseñas de un restaurante. ¿Cuántas estrellas le dan y por qué?"], develop: ["Write a review", "En parejas, escriban una reseña de 80 palabras de una película o lugar."], check: ["Una reseña equilibrada incluye…", ["Puntos a favor y en contra", "Solo críticas", "Solo el título"], 0] },
      ] },
      { name: "Future plans", objective: "Hablar del futuro.", lessons: [
        { title: "Going to or will?", goal: "Distinguir planes de predicciones.", start: ["My next holiday", "Cuenta tus planes de vacaciones. ¿Qué ya decidiste y qué solo imaginas?"], develop: ["Plans and predictions", "Clasifiquen frases en planes (going to) y predicciones (will) y escriban dos propias."], check: ["«I'm going to study medicine» expresa…", ["Un plan decidido", "Una predicción", "Un recuerdo"], 0] },
        { title: "Life in 2040", goal: "Hacer predicciones sobre el futuro.", start: ["Future headlines", "Muestra titulares imaginarios de 2040. ¿Cuáles creen que pasarán?"], develop: ["Our predictions", "En grupos, escriban cinco predicciones con will y compártanlas."], check: ["Completa: «In 2040, people ___ live longer».", ["will", "are", "did"], 0] },
      ] },
    ],
    section: { name: "B1 · Martes y jueves 17:00", learners: 14, educators: ["seed-user-ana"], weekdays: [2, 4], startsAt: "17:00", durationMinutes: 90, plan: [[1, 2], [3, 4]] } }),

  level({ code: "B2", title: "Inglés B2: argumentar con fluidez", objective: "Comprender textos complejos y argumentar con fluidez y precisión.", lead: "seed-user-tomas", createdAt: "2026-09-05T14:00:00.000Z", requires: ["seed-course-ingles-b1"], minutes: [10, 25, 10],
    outcomes: [["Argumenta una postura con ejemplos y concesiones.", "evaluate", "Escribe un ensayo de opinión de 200 palabras."], ["Resume ideas de textos y charlas.", "analyze", "Resume una charla de cinco minutos en seis frases."]],
    resource: ["Guía: conectores para argumentar", "Conectores del nivel B2.", "However, …\nOn the other hand, …\nAlthough…, …\nAs a result, …"],
    units: [
      { name: "Making a case", objective: "Argumentar por escrito y oralmente.", lessons: [
        { title: "Pros and cons", goal: "Organizar argumentos a favor y en contra.", start: ["Remote work", "¿Trabajar desde casa es mejor? Lluvia de ideas a favor y en contra."], develop: ["Structured argument", "En parejas, escriban un párrafo con however y on the other hand."], check: ["«However» introduce…", ["Una idea contraria", "Un ejemplo", "Una conclusión"], 0] },
        { title: "Opinion essay", goal: "Planificar y escribir un ensayo de opinión.", start: ["Model essay", "Lean un ensayo modelo e identifiquen introducción, argumentos y conclusión."], develop: ["Plan and draft", "Planifiquen su ensayo con una tesis y dos argumentos y redacten la introducción."], check: ["La tesis de un ensayo aparece normalmente en…", ["La introducción", "La conclusión", "El título"], 0] },
      ] },
      { name: "Listening for ideas", objective: "Comprender y resumir charlas.", lessons: [
        { title: "Note-taking", goal: "Tomar notas de una charla.", start: ["Key words", "Escuchen el primer minuto de una charla y anoten solo palabras clave."], develop: ["Cornell notes", "Con el método Cornell, tomen notas de la charla completa y comparen."], check: ["Al tomar notas conviene…", ["Escribir palabras clave", "Copiar todo", "No escribir nada"], 0] },
        { title: "Summaries", goal: "Resumir con sus palabras.", start: ["One sentence", "Resuman la charla anterior en una sola oración."], develop: ["Summary swap", "Escriban un resumen de seis frases e intercámbienlo para mejorarlo."], check: ["Un buen resumen…", ["Usa palabras propias", "Copia frases enteras", "Agrega opiniones"], 0] },
      ] },
    ],
    section: { name: "B2 · Martes y jueves 17:00", learners: 11, educators: ["seed-user-tomas"], weekdays: [2, 4], startsAt: "17:00", durationMinutes: 90, plan: [[1, 2], [3]] } }),

  level({ code: "C1", title: "Inglés C1: inglés académico y profesional", objective: "Usar el inglés con flexibilidad en contextos académicos y profesionales.", lead: "seed-user-tomas", createdAt: "2026-09-06T14:00:00.000Z", requires: ["seed-course-ingles-b2"], minutes: [10, 35, 15],
    outcomes: [["Presenta un tema profesional con estructura y registro adecuados.", "create", "Da una presentación de diez minutos con preguntas."], ["Redacta textos formales claros y bien organizados.", "create", "Escribe un correo formal y un informe breve."]],
    resource: ["Guía: lenguaje para presentaciones", "Frases para estructurar una presentación.", "Today I'd like to talk about…\nLet me move on to…\nTo sum up, …\nAre there any questions?"],
    units: [
      { name: "Presentations", objective: "Presentar con claridad.", lessons: [
        { title: "Signposting", goal: "Guiar a la audiencia durante una presentación.", start: ["Lost audience", "Muestra una presentación sin transiciones. ¿Por qué cuesta seguirla?"], develop: ["Add signposts", "En parejas, agreguen frases de transición a una presentación de cinco diapositivas."], check: ["«Let me move on to…» sirve para…", ["Pasar al siguiente punto", "Terminar", "Saludar"], 0] },
        { title: "Handling questions", goal: "Responder preguntas con seguridad.", start: ["Tough questions", "Lean preguntas difíciles de una audiencia. ¿Cómo responderían?"], develop: ["Q&A practice", "Cada persona presenta dos minutos y responde dos preguntas de su pareja."], check: ["Si no sabes la respuesta, conviene…", ["Decirlo y ofrecer averiguarlo", "Inventar una", "Ignorar la pregunta"], 0] },
      ] },
      { name: "Formal writing", objective: "Escribir con registro formal.", lessons: [
        { title: "Formal emails", goal: "Redactar un correo formal.", start: ["Formal or informal?", "Clasifiquen frases de correos según su registro."], develop: ["Write the email", "Redacten un correo formal para solicitar información sobre un curso."], check: ["Un cierre formal es…", ["Kind regards", "See ya", "Bye!"], 0] },
        { title: "Short reports", goal: "Escribir un informe breve con recomendaciones.", start: ["Report sections", "Ordenen las secciones de un informe: introducción, hallazgos y recomendaciones."], develop: ["Our report", "Escriban un informe de 250 palabras sobre una encuesta de la clase."], check: ["Las recomendaciones de un informe van…", ["Al final", "En el título", "Antes de la introducción"], 0] },
      ] },
    ],
    section: { name: "C1 · Sábados 09:00", learners: 8, educators: ["seed-user-tomas"], weekdays: [6], startsAt: "09:00", durationMinutes: 120, plan: [[1, 2], [3, 4]] } }),

  level({ code: "C2", title: "Inglés C2: dominio del idioma", objective: "Comprender prácticamente todo y expresarse con precisión y matices.", lead: "seed-user-tomas", createdAt: "2026-09-07T14:00:00.000Z", requires: ["seed-course-ingles-c1"], minutes: [10, 35, 15],
    outcomes: [["Interpreta matices, ironía y registro en textos auténticos.", "evaluate", "Analiza el tono de un artículo de opinión."], ["Media entre textos y audiencias distintas.", "create", "Adapta un texto técnico para un público general."]],
    resource: ["Guía: matices y registro", "Ejemplos de cómo cambia el sentido con el registro.", "It's not bad → It's quite good.\nI was wondering if… (muy cortés)\nWell, that went well… (irónico)"],
    units: [
      { name: "Reading between the lines", objective: "Interpretar matices.", lessons: [
        { title: "Irony and tone", goal: "Reconocer ironía y tono en textos.", start: ["Same words, new meaning", "Lean la misma frase con tres entonaciones. ¿Qué cambia?"], develop: ["Analyse the article", "En parejas, marquen en un artículo de opinión las frases irónicas y expliquen su efecto."], check: ["«Well, that went well…» dicho tras un error es…", ["Irónico", "Literal", "Formal"], 0] },
        { title: "Idioms in context", goal: "Interpretar expresiones idiomáticas.", start: ["Idiom guess", "Muestra cinco expresiones idiomáticas. ¿Qué creen que significan?"], develop: ["Idioms in the news", "Busquen expresiones idiomáticas en titulares y explíquenlas con sus palabras."], check: ["«Break the ice» significa…", ["Romper la tensión inicial", "Romper un objeto", "Enfriar algo"], 0] },
      ] },
      { name: "Mediation", objective: "Adaptar textos a otras audiencias.", lessons: [
        { title: "Plain English", goal: "Reescribir un texto técnico en lenguaje claro.", start: ["Jargon", "Lean un párrafo lleno de tecnicismos. ¿Quién lo entendería?"], develop: ["Rewrite it", "Reescriban el párrafo para un público general sin perder información."], check: ["Lenguaje claro significa…", ["Frases simples y precisas", "Más tecnicismos", "Textos más largos"], 0] },
        { title: "Summarising for others", goal: "Resumir una fuente para una audiencia concreta.", start: ["Who is it for?", "El mismo informe resumido para un director y para estudiantes. ¿Qué cambia?"], develop: ["Two audiences", "Resuman un artículo dos veces: para especialistas y para el público general."], check: ["Al mediar entre audiencias, lo primero es…", ["Saber quién leerá", "Traducir palabra por palabra", "Acortar a la mitad"], 0] },
      ] },
    ],
    section: { name: "C2 · Sábados 11:30", learners: 6, educators: ["seed-user-tomas"], weekdays: [6], startsAt: "11:30", durationMinutes: 120, plan: [[1, 2]] } }),
];
