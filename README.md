# Happy Learners Platform

Aplicación para preparar cursos y compartir lecciones de distintas disciplinas. Cada curso reúne sus unidades de aprendizaje, materiales y lecciones. Las clasificaciones son configurables y opcionales. Los estudiantes abren las publicaciones sin cuenta.

Consulta la [entrega de cursos](docs/redesign/cursos-implementacion.md), los [diagramas de base de datos](docs/redesign/base-de-datos.md), el [flujo actual de Studio](docs/redesign/studio-flujos-y-diseno.md) y las [guías de operación](docs/sprint-2/00-EMPEZAR-AQUI.md). La coedición en vivo sincroniza el texto enriquecido; los cambios de estructura usan control de versión. Los documentos Office se guardan en un bucket R2 privado.

## Desarrollo local

Requiere Node.js 24 (versión fijada en `mise.toml`). Desde el sistema de archivos Linux en WSL2:

```bash
npm ci
./scripts/verify
npm run dev
```

`npm run dev` construye y sirve localmente el paquete con Wrangler. No necesita credenciales ni recursos remotos. Tras modificar código, reinicia el comando para reconstruir el paquete.

`./scripts/verify` construye React/Vite y el Worker, genera tipos, verifica TypeScript, ejecuta Vitest (incluido el runtime local y Static Assets) y valida con Wrangler dry-run el paquete que recibiría el despliegue. No publica. Las pruebas de integración requieren poder abrir un puerto de loopback.

## Límites

- `apps/web`: React/Vite y presentación; consume los contratos de la API.
- `apps/api`: Worker TypeScript y composición del backend.
- `packages/domain`: reglas independientes de frameworks, transporte y persistencia.
- `packages/contracts`: contratos compartidos de organización, recursos, currículo y lecciones.
- `database/migrations`: migraciones acumulativas de la persistencia SQLite en Durable Objects.
- `database/seeds`: contenido editorial aprobado; no se carga automáticamente en producción.
- `infrastructure`: configuración de Workers Static Assets, Durable Objects y el bucket R2 privado de documentos.
- `tests`: pruebas de interfaz, paquete construido y controles del workflow.

DEC-008 / ADR-0003 en `happy-learners-ops` aprueban el stack. El lockfile se versiona y CI instala con `npm ci`. Las cuentas de producción deben disponer del bucket `happy-learners-demo-course-files`; CI no crea cuentas ni activa facturación. El CI/CD de la aplicación vive aquí; la generación documental y las integraciones con Jira y OneDrive permanecen en `happy-learners-ops` (DEC-007).

## Entrega y versión

Consulta [infrastructure/README.md](infrastructure/README.md). El SHA se obtiene de `git rev-parse HEAD`, se incorpora al Worker durante el build y se registra en `build/version.json`. En GitHub se comprueba que coincida con `GITHUB_SHA`. `/api/version` devuelve esa revisión. Las respuestas API llevan `Cache-Control: no-store`.

Un build local con cambios sin commit informa el SHA base del checkout: no representa esos cambios como una revisión publicada. Solo la construcción desde un checkout integrado y limpio de CI ofrece trazabilidad de una revisión desplegada. La validación local no equivale a un despliegue ni declara ST-043 Done.

## Contexto por historia

```bash
./scripts/prepare-ticket ST-043
```

El contexto proviene del repositorio hermano `happy-learners-ops` (o `HL_OPS_REPO`). No cargar el backlog completo. La Definition of Done conserva su estado `proposed`.
# Entrega v0.2.2

[Empezar aquí](docs/sprint-2/00-EMPEZAR-AQUI.md): guías de usuario y demostración, arquitectura, Sprint Review y matriz Jira–código–pruebas.
