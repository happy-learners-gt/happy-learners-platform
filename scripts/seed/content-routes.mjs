// Demo organization content, part C: three programs that read as paths (DEC-033). Each course requires the previous
// one, so the program's route goes in stages from the first course to the last. Everything is fictional.
import { A, L, Q, R, T } from "./helpers.mjs";

export const routePrograms = [
  { id: "seed-program-lectura", name: "Ruta de lectura y escritura", description: "De las primeras palabras a escribir y publicar textos propios, en cuatro cursos que se toman en orden.", educationType: "non-formal", level: "unspecified", format: "open-course", modality: "in-person", pacing: "scheduled", area: "023", settings: { moduleLabel: "units" }, locked: [], by: "seed-user-marta", at: "2026-08-04T15:00:00.000Z" },
  { id: "seed-program-programacion", name: "Programación creativa", description: "Del pensamiento computacional a los primeros programas en Python, a tu ritmo y en cuatro cursos progresivos.", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "online", pacing: "self-paced", area: "061", settings: { moduleLabel: "units" }, locked: [], by: "seed-user-marta", at: "2026-08-04T15:20:00.000Z" },
  { id: "seed-program-musica", name: "Iniciación musical", description: "Pulso, lectura musical y práctica en conjunto, en tres cursos que se toman en orden.", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "021", settings: { moduleLabel: "units" }, locked: [], by: "seed-user-marta", at: "2026-08-04T15:40:00.000Z" },
];

/** A course of a route: two modules with one published lesson each, a resource and two outcomes. */
function course({ id, title, objective, program, lead, format, modality, pacing, area, createdAt, requires, outcomes, resource, modules }) {
  const key = id.replace("seed-course-", "");
  const outcomeIds = outcomes.map((_, index) => `seed-out-${key}-${index + 1}`);
  const resourceId = `seed-res-${key}`;
  const day = Date.parse(createdAt);
  return {
    id, title, objective, program, educationType: "non-formal", level: "unspecified", format, modality, pacing, area, settings: {},
    lead, coTeachers: [], createdAt, requires, groups: [],
    competencies: [{ id: `seed-comp-${key}`, name: outcomes[0][0], description: objective, outcomes: outcomes.map(([, statement, level, evidence], index) => ({ id: outcomeIds[index], statement, level, evidence })) }],
    resources: [{ id: resourceId, title: resource[0], description: resource[1], kind: "text", content: resource[2], tags: ["seed-tag-guide"], by: lead }],
    modules: modules.map((module, index) => ({
      id: `seed-unit-${key}-${index + 1}`, name: module.name, objective: module.objective, plan: [outcomeIds[index]],
      lessons: [L(`seed-les-${key}-${index + 1}`, module.lesson, module.goal, 35, "start-develop-close", [outcomeIds[index]], [
        A("start", module.start[0], 5, "explore", "whole-class", [T(module.start[1])]),
        A("develop", module.develop[0], 20, "explain", "pairs", [T(module.develop[1]), ...index === 0 ? [R(resourceId)] : []]),
        A("close", "Comprobamos", 10, "assess", "individual", [Q(...module.check)]),
      ], { published: new Date(day + (6 + index * 3) * 86400000).toISOString(), by: lead })],
    })),
  };
}

const reading = { program: "seed-program-lectura", lead: "seed-user-ana", format: "open-course", modality: "in-person", pacing: "scheduled", area: "023" };
const coding = { program: "seed-program-programacion", lead: "seed-user-diego", format: "workshop", modality: "online", pacing: "self-paced", area: "061" };
const music = { program: "seed-program-musica", lead: "seed-user-sofia", format: "workshop", modality: "in-person", pacing: "scheduled", area: "021" };

export const routeCourses = [
  course({ ...reading, id: "seed-course-lectura-1", title: "Lectura 1: primeras palabras", objective: "Reconocer sonidos y letras para leer palabras y frases cortas.", createdAt: "2026-08-05T14:00:00.000Z", requires: [],
    outcomes: [["Conciencia fonológica", "Identifica los sonidos que forman una palabra.", "understand", "Separa en sonidos cinco palabras dichas en voz alta."], ["Lectura de palabras", "Lee en voz alta palabras y frases cortas.", "apply", "Lee una frase de cinco palabras sin ayuda."]],
    resource: ["Guía docente: juegos de sonidos", "Juegos cortos para escuchar y separar sonidos.", "1. Palmas por sílaba.\n2. ¿Con qué sonido empieza?\n3. Cambia un sonido y forma otra palabra."],
    modules: [
      { name: "Sonidos y letras", objective: "Relacionar cada sonido con su letra.", lesson: "¿Con qué sonido empieza?", goal: "Identificar el sonido inicial de una palabra.", start: ["La caja de objetos", "Saca un objeto de la caja y di su nombre despacio. ¿Con qué sonido empieza?"], develop: ["Clasificamos por sonido", "En parejas, ordenen las tarjetas de dibujos según su sonido inicial."], check: ["¿Con qué sonido empieza «mesa»?", ["/m/", "/s/", "/a/"], 0] },
      { name: "Palabras y frases", objective: "Unir sonidos para leer palabras.", lesson: "Leemos nuestras primeras frases", goal: "Leer frases cortas uniendo sonidos.", start: ["Una frase en el pizarrón", "Lee en voz alta «Mi mamá me ama» señalando cada palabra."], develop: ["Armamos frases", "Con tarjetas de palabras, armen tres frases y léanlas a su pareja."], check: ["¿Cuántas palabras tiene «El sol sale»?", ["Dos", "Tres", "Cuatro"], 1] },
    ] }),
  course({ ...reading, id: "seed-course-lectura-2", title: "Lectura 2: comprensión lectora", objective: "Comprender textos breves: personajes, hechos e ideas principales.", createdAt: "2026-08-06T14:00:00.000Z", requires: ["seed-course-lectura-1"],
    outcomes: [["Comprensión literal", "Reconoce personajes, lugares y hechos de un cuento.", "understand", "Responde quién, dónde y qué pasó en un cuento corto."], ["Idea principal", "Expresa con sus palabras la idea principal de un texto.", "analyze", "Resume un texto informativo en una oración."]],
    resource: ["Ficha: antes, durante y después de leer", "Preguntas para acompañar la lectura.", "Antes: ¿de qué tratará?\nDurante: ¿qué pasará después?\nDespués: ¿qué fue lo más importante?"],
    modules: [
      { name: "Cuentos y personajes", objective: "Reconocer los elementos de un cuento.", lesson: "¿Quién, dónde y qué pasó?", goal: "Identificar personajes, lugar y hechos de un cuento.", start: ["La portada", "Muestra la portada de un cuento. ¿Quiénes creen que aparecen?"], develop: ["El mapa del cuento", "Después de leer, completen en parejas el mapa: personajes, lugar, problema y final."], check: ["¿Qué es el lugar de un cuento?", ["Dónde ocurre la historia", "Quién la cuenta", "Cómo termina"], 0] },
      { name: "Textos que informan", objective: "Encontrar la idea principal de un texto informativo.", lesson: "La idea más importante", goal: "Expresar la idea principal de un texto informativo.", start: ["Un dato curioso", "Lee: «Los colibríes baten sus alas hasta 80 veces por segundo». ¿De qué trata?"], develop: ["Subrayamos lo esencial", "Lean un texto sobre los colibríes y subrayen la oración que lo resume."], check: ["La idea principal de un texto es…", ["Lo más importante que dice", "La primera palabra", "El título"], 0] },
    ] }),
  course({ ...reading, id: "seed-course-lectura-3", title: "Escritura 1: textos breves", objective: "Escribir textos breves con inicio, desarrollo y final.", createdAt: "2026-08-07T14:00:00.000Z", requires: ["seed-course-lectura-2"],
    outcomes: [["Planificar un texto", "Organiza sus ideas antes de escribir.", "apply", "Completa un organizador de inicio, desarrollo y final."], ["Escribir y revisar", "Escribe un texto breve y lo mejora con una lista de revisión.", "create", "Entrega una versión revisada de su texto."]],
    resource: ["Lista de revisión", "Lo que revisamos antes de entregar un texto.", "¿Tiene inicio, desarrollo y final?\n¿Cada oración empieza con mayúscula?\n¿Se entiende lo que quise decir?"],
    modules: [
      { name: "Planificamos", objective: "Ordenar las ideas de un texto.", lesson: "Antes de escribir", goal: "Organizar las ideas de un texto en tres partes.", start: ["Una historia desordenada", "Lee tres partes de una historia en desorden. ¿Cuál va primero?"], develop: ["Nuestro organizador", "En parejas, planeen una historia sobre una mascota: inicio, desarrollo y final."], check: ["¿Qué parte presenta a los personajes?", ["El inicio", "El final", "El título"], 0] },
      { name: "Escribimos y revisamos", objective: "Escribir un texto y mejorarlo.", lesson: "Escribo, reviso y mejoro", goal: "Escribir un texto breve y revisarlo con una lista.", start: ["Un texto con errores", "Muestra un párrafo sin mayúsculas. ¿Qué le falta?"], develop: ["Revisión en parejas", "Intercambien sus textos y revísenlos con la lista de revisión."], check: ["¿Para qué sirve revisar un texto?", ["Para mejorarlo antes de entregarlo", "Para hacerlo más largo", "Para copiarlo"], 0] },
    ] }),
  course({ ...reading, id: "seed-course-lectura-4", title: "Escritura 2: club de autores", objective: "Escribir, ilustrar y publicar un libro corto de la clase.", createdAt: "2026-08-08T14:00:00.000Z", requires: ["seed-course-lectura-3"],
    outcomes: [["Escribir para publicar", "Escribe un cuento completo pensando en sus lectores.", "create", "Entrega un cuento de al menos tres párrafos."], ["Presentar su obra", "Lee su cuento en voz alta ante la clase.", "apply", "Presenta su cuento con buena entonación."]],
    resource: ["Guía docente: la feria del libro", "Cómo organizar la presentación de los libros de la clase.", "1. Cada autor prepara su portada.\n2. Se arma la mesa de libros.\n3. Cada autor lee una página a sus invitados."],
    modules: [
      { name: "Nuestro libro", objective: "Escribir e ilustrar un cuento.", lesson: "Del borrador al libro", goal: "Convertir un borrador en un libro ilustrado.", start: ["Libros de verdad", "Muestra un libro ilustrado. ¿Qué partes tiene: portada, autor, páginas?"], develop: ["Armamos el libro", "En parejas, pasen su cuento en limpio y dibujen una ilustración por página."], check: ["¿Qué va en la portada de un libro?", ["El título y el autor", "El final del cuento", "La lista de revisión"], 0] },
      { name: "La feria del libro", objective: "Presentar el libro a lectores reales.", lesson: "Leemos para nuestros lectores", goal: "Leer en voz alta el propio cuento.", start: ["Ensayamos", "Lee una página con distintas voces. ¿Cuál se escucha mejor?"], develop: ["Ensayo en parejas", "Cada autor lee su cuento a su pareja, que le da un consejo."], check: ["Al leer en voz alta conviene…", ["Hablar claro y hacer pausas", "Leer lo más rápido posible", "Taparse la cara"], 0] },
    ] }),

  course({ ...coding, id: "seed-course-programacion-1", title: "Programación 1: pensamiento computacional", objective: "Resolver problemas con secuencias, patrones y bucles, sin computadora.", createdAt: "2026-08-05T15:00:00.000Z", requires: [],
    outcomes: [["Algoritmos", "Describe un algoritmo como una secuencia ordenada de pasos.", "understand", "Escribe los pasos para preparar un sándwich."], ["Patrones y bucles", "Reconoce patrones que se repiten y los expresa como un bucle.", "apply", "Reescribe una secuencia larga usando «repetir»."]],
    resource: ["Guía: actividades desconectadas", "Juegos para pensar como una computadora sin pantallas.", "1. El robot humano sigue instrucciones exactas.\n2. Cuadrícula de flechas para llegar al tesoro.\n3. Encuentra el patrón y escríbelo con «repetir»."],
    modules: [
      { name: "Instrucciones exactas", objective: "Escribir algoritmos claros y ordenados.", lesson: "El robot humano", goal: "Escribir una secuencia de pasos que otra persona pueda seguir.", start: ["Sigue mis pasos", "Da instrucciones vagas para dibujar una casa. ¿Qué salió mal?"], develop: ["Cuadrícula del tesoro", "En parejas, escriban con flechas el camino para llegar al tesoro."], check: ["Un algoritmo es…", ["Una secuencia ordenada de pasos", "Un dibujo", "Un error"], 0] },
      { name: "Patrones", objective: "Encontrar repeticiones y expresarlas como bucles.", lesson: "Repetir en lugar de copiar", goal: "Expresar una secuencia repetida con un bucle.", start: ["El baile", "Baila: aplauso, salto, aplauso, salto. ¿Qué se repite?"], develop: ["Comprimimos el camino", "Reescriban el camino del tesoro usando «repetir 3 veces»."], check: ["¿Cómo escribes «→ → → →» más corto?", ["Repetir 4 veces →", "→ 2", "Repetir →"], 0] },
    ] }),
  course({ ...coding, id: "seed-course-programacion-2", title: "Programación 2: Scratch, primeros proyectos", objective: "Crear animaciones e historias con bloques de Scratch.", createdAt: "2026-08-06T15:00:00.000Z", requires: ["seed-course-programacion-1"],
    outcomes: [["Programar con bloques", "Programa una animación con eventos y movimiento.", "apply", "Hace que un personaje se mueva al hacer clic en la bandera."], ["Contar una historia", "Crea una historia con dos personajes que dialogan.", "create", "Comparte una historia de al menos tres escenas."]],
    resource: ["Scratch: guía de inicio", "Los bloques que usamos en este curso.", "Eventos: al hacer clic en la bandera.\nMovimiento: mover, girar, ir a.\nApariencia: decir, cambiar disfraz."],
    modules: [
      { name: "Mi primera animación", objective: "Usar eventos y movimiento.", lesson: "¡Que se mueva!", goal: "Programar el movimiento de un personaje.", start: ["Un gato que baila", "Muestra una animación sencilla. ¿Qué instrucciones creen que tiene?"], develop: ["Programamos el gato", "Unan los bloques para que el gato avance y gire al hacer clic en la bandera."], check: ["¿Qué bloque inicia el programa?", ["Al hacer clic en la bandera", "Mover 10 pasos", "Decir hola"], 0] },
      { name: "Historias animadas", objective: "Coordinar dos personajes.", lesson: "Dos personajes conversan", goal: "Crear un diálogo entre dos personajes.", start: ["Un chiste animado", "Muestra dos personajes que se cuentan un chiste. ¿Cómo saben cuándo hablar?"], develop: ["Nuestro diálogo", "Programen un diálogo con «decir» y «esperar» entre dos personajes."], check: ["Para que un personaje espere su turno usas…", ["Esperar 2 segundos", "Mover 10 pasos", "Girar 15 grados"], 0] },
    ] }),
  course({ ...coding, id: "seed-course-programacion-3", title: "Programación 3: Scratch, juegos", objective: "Diseñar un videojuego con variables, condiciones y puntaje.", createdAt: "2026-08-07T15:00:00.000Z", requires: ["seed-course-programacion-2"],
    outcomes: [["Condiciones", "Usa condiciones para que el juego reaccione.", "apply", "Programa que un objeto rebote al tocar el borde."], ["Variables", "Usa una variable para llevar el puntaje.", "apply", "Su juego suma un punto en cada acierto."]],
    resource: ["Plantilla: diseño del juego", "Preguntas para planear el juego antes de programar.", "¿Quién juega?\n¿Cuál es el objetivo?\n¿Cómo se gana un punto?\n¿Cuándo termina?"],
    modules: [
      { name: "Si pasa esto…", objective: "Programar con condiciones.", lesson: "El juego reacciona", goal: "Usar «si… entonces» en un juego.", start: ["¿Qué pasa si…?", "En un juego de pelota, ¿qué debe pasar si la pelota toca el borde?"], develop: ["La pelota rebota", "Programen una pelota que rebote al tocar el borde y cambie de color al tocar la paleta."], check: ["«Si toca el borde, rebotar» es…", ["Una condición", "Una variable", "Un disfraz"], 0] },
      { name: "Puntaje", objective: "Llevar la cuenta con una variable.", lesson: "Contamos los puntos", goal: "Usar una variable para el puntaje.", start: ["El marcador", "¿Cómo sabe un juego cuántos puntos llevas?"], develop: ["Nuestro marcador", "Creen la variable «puntos» y súmenle 1 cada vez que la paleta toque la pelota."], check: ["Para guardar el puntaje usas…", ["Una variable", "Un sonido", "Un fondo"], 0] },
    ] }),
  course({ ...coding, id: "seed-course-programacion-4", title: "Programación 4: Python inicial", objective: "Escribir los primeros programas de texto en Python.", createdAt: "2026-08-08T15:00:00.000Z", requires: ["seed-course-programacion-3"],
    outcomes: [["Primeros programas", "Escribe programas que muestran y piden datos.", "apply", "Su programa saluda usando el nombre que escribe la persona."], ["Bucles en Python", "Usa «for» para repetir instrucciones.", "apply", "Imprime la tabla del 5 con un bucle."]],
    resource: ["Python: guía de bolsillo", "Las instrucciones del curso.", "print('Hola')\nnombre = input('¿Cómo te llamas? ')\nfor numero in range(1, 11):\n    print(5 * numero)"],
    modules: [
      { name: "Hola, Python", objective: "Mostrar y pedir datos.", lesson: "Mi programa saluda", goal: "Escribir un programa que pide un nombre y saluda.", start: ["De bloques a texto", "Muestra el bloque «decir hola» y su equivalente print('hola'). ¿Qué cambia?"], develop: ["El saludo", "Escriban un programa que pregunte el nombre y responda «Hola» con ese nombre."], check: ["¿Qué instrucción muestra un texto?", ["print", "input", "for"], 0] },
      { name: "Repetir en Python", objective: "Usar bucles «for».", lesson: "La tabla del 5", goal: "Repetir instrucciones con «for».", start: ["Del «repetir» al «for»", "Recuerda el bloque «repetir 10 veces». ¿Cómo se escribirá en Python?"], develop: ["Imprimimos la tabla", "Usen for y range para imprimir la tabla del 5 del 1 al 10."], check: ["¿Qué hace range(1, 4)?", ["Da 1, 2 y 3", "Da 1, 2, 3 y 4", "Da solo 4"], 0] },
    ] }),

  course({ ...music, id: "seed-course-musica-1", title: "Música 1: pulso y ritmo", objective: "Sentir el pulso y reproducir ritmos con el cuerpo y la percusión.", createdAt: "2026-08-05T16:00:00.000Z", requires: [],
    outcomes: [["Pulso", "Mantiene el pulso de una canción.", "apply", "Marca el pulso con palmas durante una canción completa."], ["Ritmo", "Reproduce ritmos sencillos.", "apply", "Repite cuatro ritmos con percusión corporal."]],
    resource: ["Guía: percusión corporal", "Sonidos del cuerpo para los ejercicios de ritmo.", "Palmas, chasquidos, muslos y pies.\nEmpieza lento y acelera poco a poco."],
    modules: [
      { name: "El pulso", objective: "Sentir y mantener el pulso.", lesson: "El corazón de la música", goal: "Marcar el pulso de una canción.", start: ["Escuchamos el corazón", "Pongan la mano en el pecho. ¿Late parejo? La música también tiene un pulso."], develop: ["Marchamos con la música", "En parejas, marchen y aplaudan al pulso de la canción."], check: ["El pulso de una canción es…", ["Un latido parejo", "La letra", "El final"], 0] },
      { name: "El ritmo", objective: "Reproducir ritmos.", lesson: "Eco de ritmos", goal: "Repetir ritmos con percusión corporal.", start: ["El juego del eco", "Haz un ritmo con palmas; la clase lo repite."], develop: ["Creamos ritmos", "En parejas, inventen un ritmo de cuatro tiempos y enséñenlo a la clase."], check: ["¿Qué es un eco rítmico?", ["Repetir el ritmo que escuchas", "Cantar más fuerte", "Quedarse en silencio"], 0] },
    ] }),
  course({ ...music, id: "seed-course-musica-2", title: "Música 2: lectura musical", objective: "Leer y escribir ritmos y notas en el pentagrama.", createdAt: "2026-08-06T16:00:00.000Z", requires: ["seed-course-musica-1"],
    outcomes: [["Figuras rítmicas", "Lee negras, corcheas y silencios.", "understand", "Lee en voz alta un ritmo de ocho tiempos."], ["Notas en el pentagrama", "Ubica do, re, mi, fa y sol en el pentagrama.", "apply", "Nombra cinco notas escritas en el pentagrama."]],
    resource: ["Ficha: figuras y notas", "Tabla de figuras rítmicas y notas en clave de sol.", "Negra: ta. Corcheas: ti-ti. Silencio: shh.\nDo, re, mi, fa y sol en clave de sol."],
    modules: [
      { name: "Figuras rítmicas", objective: "Leer ritmos escritos.", lesson: "Ta y ti-ti", goal: "Leer negras y corcheas.", start: ["Ritmos con nombre", "Di «ta» en cada palmada larga y «ti-ti» en las cortas."], develop: ["Leemos tarjetas", "En parejas, lean y aplaudan las tarjetas de ritmo."], check: ["¿Cómo se dice una negra?", ["Ta", "Ti-ti", "Shh"], 0] },
      { name: "El pentagrama", objective: "Ubicar notas.", lesson: "La escalera de las notas", goal: "Nombrar notas en el pentagrama.", start: ["La escalera", "Dibuja cinco líneas. ¿Qué notas viven en las líneas y cuáles en los espacios?"], develop: ["Notas en tarjetas", "En parejas, coloquen fichas en el pentagrama y nombren cada nota."], check: ["¿Cuántas líneas tiene el pentagrama?", ["Cinco", "Cuatro", "Siete"], 0] },
    ] }),
  course({ ...music, id: "seed-course-musica-3", title: "Música 3: ensamble", objective: "Tocar en conjunto una pieza sencilla con flauta y percusión.", createdAt: "2026-08-07T16:00:00.000Z", requires: ["seed-course-musica-2"],
    outcomes: [["Tocar en conjunto", "Toca su parte manteniendo el pulso del grupo.", "apply", "Toca su parte de la pieza sin detenerse."], ["Presentar la pieza", "Presenta la pieza con el ensamble.", "create", "Participa en la presentación final del ensamble."]],
    resource: ["Partitura: «Estrellita»", "Partitura sencilla para flauta y percusión.", "Flauta: do do sol sol la la sol.\nPercusión: negra en cada tiempo.\nTodos: silencio al final de cada frase."],
    modules: [
      { name: "Cada uno su parte", objective: "Aprender una parte de la pieza.", lesson: "Mi parte en la pieza", goal: "Tocar una parte de la pieza.", start: ["Escuchamos la pieza", "Escuchen «Estrellita» y levanten la mano cuando entre la percusión."], develop: ["Ensayo por grupos", "Por parejas, ensayen su parte con la partitura."], check: ["En un ensamble, lo más importante es…", ["Mantener el pulso del grupo", "Tocar más fuerte que los demás", "Terminar primero"], 0] },
      { name: "La presentación", objective: "Presentar la pieza en conjunto.", lesson: "¡A escena!", goal: "Presentar la pieza con el ensamble.", start: ["El director", "Practiquen las señales de entrada y final del director."], develop: ["Ensayo general", "Toquen la pieza completa juntos dos veces y comenten cómo mejorarla."], check: ["¿Qué indica el director al levantar la mano?", ["Prepararse para empezar", "Terminar la pieza", "Cambiar de instrumento"], 0] },
    ] }),
];
