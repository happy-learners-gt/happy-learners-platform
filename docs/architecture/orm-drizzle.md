# Prueba de Drizzle como ORM (carril C.5)

Decisión con datos, 31-oct-2026. Prueba hecha fuera del repositorio (carpeta temporal, sin agregar la dependencia),
con `drizzle-orm` 0.45.4 y la tabla `classrooms` de la migración 0074.

## Cómo encajaría

La API no habla con SQLite directamente: arma el SQL en el Worker y lo envía por RPC al Durable Object de la
organización (`storage.ts`, `Prepared` → `measuredQuery`). Por eso Drizzle solo cabe como **constructor de consultas**:
`QueryBuilder` de `drizzle-orm/sqlite-core` y `.toSQL()`, cuyo `{ sql, params }` se pasa a `db.prepare(sql).bind(...)`.
El controlador `drizzle-orm/durable-sqlite` correría dentro del Durable Object y obligaría a mover la lógica allí.

## Lo que se midió

| | SQL a mano | Drizzle (constructor) |
| --- | --- | --- |
| Paquete de una consulta (esbuild, minificado) | 217 bytes | 70 052 bytes (18,9 KB con gzip) |
| Peso relativo frente al Worker actual (2,6 MB sin comprimir) | — | +2,7 % |
| SQL generado | el que se escribe | correcto y parametrizado (incluso `'active'` va como `?`) |
| Esquema | migraciones SQL | migraciones SQL **y** declaración en TypeScript (dos fuentes) |

Consulta generada para las aulas activas:

```sql
select "id", "name", "capacity" from "classrooms" where ("classrooms"."organization_id" = ? and "classrooms"."status" = ?) order by "classrooms"."name" COLLATE NOCASE asc
```

## Lo que se gana y lo que cuesta

- **Gana:** columnas tipadas en las consultas simples; desaparecen las listas de columnas interpoladas (la clase más
  numerosa del inventario de la auditoría, §4) y su ruido en Semgrep.
- **Cuesta:** el esquema en dos lugares. Las migraciones son SQL escrito a mano con disparadores, reconstrucciones de
  tablas y datos de demostración, que `drizzle-kit` no genera; habría que probar en cada cambio que la declaración en
  TypeScript coincide con `sqlite_master`. Las consultas que más importan (las de §4 de `docs/operations/slo.md`:
  `json_each`, subconsultas correlacionadas, `CROSS JOIN` para fijar el orden de unión) se escribirían igual con la
  plantilla `sql` de Drizzle, sin los tipos. Y dos estilos conviviendo en la API es un antipatrón propio
  (`patrones.md`).

## Decisión

**No adoptar Drizzle por ahora.** Se mantiene SQL parametrizado con tipos genéricos en `all<T>()`, la regla de Semgrep
`sql-interpolated-text` y la prueba de rutas. Se revisa si ocurre alguna de estas:

1. Un error en producción causado por una columna mal escrita o un tipo de fila equivocado.
2. Paso a D1 o a migraciones generadas, donde `drizzle-kit` sería la fuente del esquema.
3. Un módulo nuevo grande con mayoría de CRUD simple, como prueba aislada con la comprobación contra `sqlite_master`.

Registrar en `happy-learners-ops/docs/architecture/decisiones.md` como DEC (propuesta: DEC-054).
