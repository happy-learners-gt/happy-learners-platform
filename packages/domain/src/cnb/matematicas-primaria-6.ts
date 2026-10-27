import type { CurriculumPackage } from "../curriculum-packages";

/**
 * Dosificación de los aprendizajes · Área de Matemáticas · Sexto Grado (Nivel Primario), as published by CNB Guatemala.
 * Transcribed from the page named in `source`: competencies, achievement indicators and contents keep their wording
 * and numbering; only line breaks of the extract, a space before a period and the apostrophe of K’im and K’atun were
 * normalized. The extract does not keep which unit (1–4) each content is marked in, so units are not transcribed.
 * `level` is the platform's classification of each indicator's verb for its curriculum plan, not part of the source.
 */
export const matematicasPrimaria6: CurriculumPackage = {
  id: "cnb-matematicas-primaria-6",
  version: "2026-10-27",
  title: "Dosificación de los aprendizajes · Matemáticas · Sexto Grado",
  area: "Matemáticas",
  grade: "Sexto Grado",
  level: "Nivel Primario",
  source: {
    name: "CNB Guatemala",
    url: "https://cnbguatemala.org/wiki/Dosificaci%C3%B3n_de_los_aprendizajes_-_%C3%81rea_de_Matem%C3%A1ticas_-_Sexto_Grado",
    retrievedOn: "2026-10-27",
  },
  competencies: [
    {
      code: "1",
      statement: "Produce información acerca de la utilización de figuras geométricas, símbolos, signos y señales de fenómenos naturales, sociales y culturales en su región.",
      indicators: [
        { code: "1.1", level: "remember", statement: "Identifica características de polígonos regulares e irregulares.", contents: [
          "1.1.1. Clasificación de triángulos por sus ángulos (rectángulo, obtusángulo, acutángulo).",
          "1.1.2. Clasificación y trazo de paralelogramos (rectángulos, cuadrados, romboides, rombos).",
          "1.1.3. Elaboración de diseños que contengan diferentes paralelogramos.",
          "1.1.4. Identificación de figuras congruentes, basándose en observación de longitud de lados y medida de ángulos.",
          "1.1.5. Trazo de figuras congruentes.",
          "1.1.6. Clasificación de figuras geométricas en polígonos regulares e irregulares.",
          "1.1.7. Identificación y descripción de polígonos hasta de 10 lados",
          "1.1.8. Establecimiento de la suma de ángulos en un pentágono y hexágono.",
          "1.1.9. Elaboración de diseños utilizando círculos y aplicando diferentes patrones.",
          "1.1.10. Identificación e interpretación de polígonos regulares e irregulares en la cultura Maya.",
          "1.1.11. Aplicación de la traslación, simetría y rotación de figuras planas.",
        ] },
        { code: "1.2", level: "apply", statement: "Calcula perímetro y área de diferentes polígonos y del círculo.", contents: [
          "1.2.1 Cálculo del perímetro de polígonos regulares e irregulares.",
          "1.2.2. Cálculo del área de triángulos acutángulo y obtusángulo aplicando fórmula.",
          "1.2.3. Cálculo de circunferencia y área del círculo.",
        ] },
        { code: "1.3", level: "remember", statement: "Identifica características de prismas, pirámides, conos y cilindros.", contents: [
          "1.3.1 Descripción de prisma, pirámide, cono y cilindro por el número de caras, vértices y aristas.",
          "1.3.2 Identificación de caras congruentes en prismas, pirámides y cilindros.",
          "1.3.3. Clasificación de sólidos geométricos en pirámides y prismas basándose en número de caras congruente que cumplen la función de base.",
          "1.3.4. Descripción de prismas, pirámides, conos y cilindros por el número y tipo de caras laterales y caras-base, número de vértices y aristas.",
          "1.3.5. Identificación de altura en sólidos geométricos.",
          "1.3.6. Trazo de la representación plana de prismas, pirámides, conos y cilindros en hojas cuadriculadas.",
          "1.3.7. Construcción de prisma, pirámide, cono y cilindro.",
        ] },
        { code: "1.4", level: "apply", statement: "Calcula el área y volumen de sólidos geométricos.", contents: [
          "1.4.1. Cálculo del área de prismas (incluyendo cubo), cilindros, pirámides y conos.",
          "1.4.2. Cálculo del volumen de prismas rectangulares (incluyendo cubo), cilindro, pirámide rectangular y de conos.",
          "1.4.3 Medición y cálculo de área y volumen de objetos de su entorno que tienen forma de prisma rectangular o cilindro.",
        ] },
        { code: "1.5", level: "apply", statement: "Utiliza el plano cartesiano.", contents: [
          "1.5.1. Utilización de los números enteros positivos y negativos para representar situaciones de la vida cotidiana (temperatura).",
          "1.5.2. Asociación de los números positivos y negativos a puntos de la recta numérica.",
          "1.5.3 Utilización de pares ordenados en la localización de puntos en un plano cartesiano.",
        ] },
      ],
    },
    {
      code: "2",
      statement: "Aplica el pensamiento lógico, reflexivo, crítico y creativo para impulsar la búsqueda de solución a situaciones problemáticas en los diferentes ámbitos en los que se desenvuelve.",
      indicators: [
        { code: "2.1", level: "create", statement: "Construye series numéricas aplicando diferentes patrones.", contents: [
          "2.1.1. Completación de series numéricas que tienen secuencias en las que se combina dos o tres operaciones aritméticas (suma, resta, multiplicación o división).",
          "2.1.2. Creación de series numéricas que tienen secuencias en las que se combina dos o tres operaciones aritméticas (suma, resta, multiplicación o división).",
        ] },
      ],
    },
    {
      code: "3",
      statement: "Aplica, con autonomía, signos, símbolos gráficos, algoritmos y términos matemáticos, para dar respuesta a diversas situaciones y problemas en los diferentes ámbitos en los que se desenvuelve.",
      indicators: [
        { code: "3.1", level: "understand", statement: "Representa subconjuntos de un conjunto.", contents: [
          "3.1.1. Identificación de todos los subconjuntos de un conjunto que tenga 3 a 5 elementos.",
        ] },
        { code: "3.2", level: "apply", statement: "Realiza operaciones entre conjuntos.", contents: [
          "3.2.1. Representación gráfica y enumerativa de la unión, intersección y diferencia entre dos y tres conjuntos.",
          "3.2.2. Realización de operaciones combinadas de unión, intersección y diferencia.",
          "3.2.3. Realización de operaciones de diferencia simétrica entre dos conjuntos.",
          "3.2.4. Realización del producto cartesiano de dos conjuntos con dos o tres elementos.",
        ] },
        { code: "3.3", level: "remember", statement: "Identifica los elementos del conjunto de números naturales, enteros y fraccionarios.", contents: [
          "3.3.1. Identificación de los elementos de conjuntos numéricos: naturales, enteros y fraccionarios.",
        ] },
      ],
    },
    {
      code: "4",
      statement: "Aplica elementos matemáticos en situaciones que promueven el mejoramiento y la transformación del medio natural, social y cultural en el que se desenvuelve.",
      indicators: [
        { code: "4.1", level: "apply", statement: "Utiliza los números naturales enteros en el sistema de numeración decimal hasta 999,999,999 y en el sistema de númeración vigesimal Maya hasta la quinta posición y numeración romana hasta mil.", contents: [
          "4.1.1. Lectura y escritura de cantidades hasta 999,999,999",
          "4.1.2. Lectura y escritura de números Romanos Hasta M.",
          "4.1.3. Determinación de la cantidad de unidades, decenas, centenas, millares y millones que hay en una cantidad.",
          "4.1.4. Aproximación de cantidades a la última cifra o dígito dada.",
          "4.1.5. Utilización de numerales mayas para representar situaciones cotidianas.",
          "4.1.6. Conversión de cantidades escritas en sistema decimal a sistema vigesimal.",
          "4.1.7. Ordenamiento de series numéricas presentadas con numerales Mayas (series de 20 en 20, 100 en 100).",
        ] },
        { code: "4.2", level: "apply", statement: "Realiza cálculos aritméticos de adición, sustracción, multiplicación, división y potenciación con números naturales enteros.", contents: [
          "4.2.1. Estimación de resultados de las operaciones de suma y resta, multiplicación y división.",
          "4.2.2. Aplicación de diferentes estrategias de cálculo mental.",
          "4.2.3. Cálculo de operaciones abiertas (operaciones en las que falta uno de los términos).",
          "4.2.4. Realización de cálculos aritméticos combinados de suma, resta, multiplicación y división, respetando la jerarquía operacional y con signos de agrupación (paréntesis)",
          "4.2.5. Cálculo de suma y resta de potencias con igual base.",
          "4.2.6. Cálculo de raíz cuadrada exacta en un ámbito hasta 1,000.",
          "4.2.7. Cálculo de sumas y restas combinadas con números mayas.",
          "4.2.8. Cálculo de multiplicaciones con numeración Maya en las que uno de los factores está entre 2 y 19 y el otro factor llega a la segunda posición.",
        ] },
        { code: "4.3", level: "understand", statement: "Identifica relaciones entre números naturales.", contents: [
          "4.3.1. Enumeración de todos los factores o divisores de un número.",
          "4.3.2. Aplicación de reglas de divisibilidad del 2, 3, 4, 5, 6, 8, 9 y 10.",
          "4.3.3. Clasificación de números en primos y compuestos.",
          "4.3.4. Expresión de la factorización prima de un número.",
          "4.3.5. Cálculo del mínimo común múltiplo y el máximo común divisor de dos o tres números aplicando la factorización prima.",
        ] },
        { code: "4.4", level: "apply", statement: "Realiza cálculos aritméticos de adición, sustracción, multiplicación, división con fracciones.", contents: [
          "4.4.1. Simplificación de fracciones a su mínima expresión.",
          "4.4.2. Cálculo de operaciones combinadas de suma y resta de fracciones con diferente denominador.",
          "4.4.3. Cálculo de multiplicación de entero por fracción, fracción por entero, fracciones por fracciones.",
          "4.4.4. Cálculo de división de entero entre fracción, fracción entre entero y fracción entre fracción.",
        ] },
        { code: "4.5", level: "apply", statement: "Realiza cálculos aritméticos de adición, sustracción, multiplicación, división con decimales", contents: [
          "4.5.1. Cálculo de operaciones combinadas de suma y resta de decimales.",
          "4.5.2. Cálculo de multiplicación de decimal por entero, entero por decimal y decimal por decimal.",
          "4.5.3. Cálculo de división de decimales entre enteros, enteros entre decimales y decimales entre decimales.",
          "4.5.4. Cálculo de operaciones combinadas de suma, resta, multiplicación y división de decimales.",
        ] },
        { code: "4.6", level: "apply", statement: "Aplica propiedad de proporciones", contents: [
          "4.6.1. Cálculo del término desconocido en una proporción.",
        ] },
      ],
    },
    {
      code: "5",
      statement: "Aplica estrategias de aritmética básica en la resolución de situaciones problemáticas de su vida cotidiana que contribuyen a mejorar su calidad de vida.",
      indicators: [
        { code: "5.1", level: "apply", statement: "Resuelve problemas aplicando una o varias operaciones aritméticas", contents: [
          "5.1.1. Solución de problemas en los que utiliza dos o tres operaciones aritméticas con números naturales.",
          "5.1.2. Solución de problemas en los que utiliza una o dos operaciones aritméticas con fracciones o decimales.",
        ] },
        { code: "5.2", level: "apply", statement: "Utiliza la regla de tres simple y compuesta en la solución de problemas.", contents: [
          "5.2.1. Aplicación de reglas de tres simple y compuesta, para resolver problemas de interés.",
        ] },
      ],
    },
    {
      code: "6",
      statement: "Utiliza la información que obtiene de diferentes elementos y fenómenos que ocurren en su contexto social, cultural y natural y la expresa en forma gráfica y simbólica.",
      indicators: [
        { code: "6.1", level: "understand", statement: "Clasifica información recopilada según variables cualitativas y cuantitativas y la expresa en porcentajes", contents: [
          "6.1.1. Clasificación de información del contexto (población, número de habitantes, hombres y mujeres o resultados de eventos deportivos).",
          "6.1.2. Presentación de información utilizando porcentajes.",
          "6.1.3. Interpretación de información presentada en porcentaje.",
        ] },
        { code: "6.2", level: "analyze", statement: "Organiza información recopilada en tablas de frecuencias, gráficas de barras y circulares.", contents: [
          "6.2.1. Presentación e interpretación de información gráfica (barra simple, circular, poligonal o lineal).",
        ] },
        { code: "6.3", level: "analyze", statement: "Determina diferencia entre el dato más bajo y el más alto (datos no agrupados).", contents: [
          "6.3.1. Análisis e interpretación de diferencias de datos numéricos.",
        ] },
        { code: "6.4", level: "apply", statement: "Calcula e interpreta el promedio aritmético, la mediana y la moda en un conjunto de datos no agrupados.", contents: [
          "6.4.1. Cálculo de la moda y el promedio aritmético de datos no agrupados (20 datos como máximo).",
        ] },
      ],
    },
    {
      code: "7",
      statement: "Aplica los conocimientos y las tecnologías propias de la cultura y de otras culturas para impulsar el desarrollo personal, familiar y de su comunidad.",
      indicators: [
        { code: "7.1", level: "remember", statement: "Identifica unidades de medida de longitud, peso y capacidad.", contents: [
          "7.1.1. Estimación y medición de longitud, peso y capacidad utilizando diferentes unidades (del sistema métrico y del sistema inglés antiguo).",
          "7.1.2. Discusión sobre razones de los posibles errores de medición.",
          "7.1.3. Establecimiento de equivalencia entre el metro y sus múltiplos y submúltiplos.",
          "7.1.4. Establecimiento de equivalencia entre el gramo sus múltiplos y submúltiplos.",
          "7.1.5. Establecimiento de equivalencia entre el litro y sus múltiplos y submúltiplos.",
          "7.1.6 Establecimiento de equivalencia entre onza y libra.",
        ] },
        { code: "7.2", level: "apply", statement: "Utiliza un termómetro para medir la temperatura del ambiente.", contents: [
          "7.2.1. Interpretación de la escala de medición de la temperatura, grados sobre cero y grados bajo cero.",
        ] },
        { code: "7.3", level: "understand", statement: "Describe aplicaciones del calendario maya agrícola y sagrado", contents: [
          "7.3.1. Cálculo de la cuenta larga (K’im, Winal, Tun, K’atun, Baktun) para diferentes fechas del gregoriano.",
          "7.3.2. Investigación de aplicaciones prácticas del calendario agrícola y sagrado de la Cultura Maya.",
        ] },
        { code: "7.4", level: "understand", statement: "Establece equivalencia entre la moneda nacional y otras monedas.", contents: [
          "7.4.1. Establecimiento de equivalencia de la moneda nacional con el dólar, euro y monedas regionales.",
        ] },
        { code: "7.5", level: "apply", statement: "Resuelve problemas utilizando la moneda nacional y otras monedas de uso regional.", contents: [
          "7.5.1. Resolución de problemas que involucren el uso de la moneda nacional: suma, resta, multiplicación y división",
        ] },
      ],
    },
  ],
};
