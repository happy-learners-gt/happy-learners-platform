# Happy Learners Platform

Monorepo de la aplicación. ST-043 incorpora una página de disponibilidad, `/api/health`, `/api/version` y la entrega verificable. No incluye autenticación, contenido académico ni persistencia.

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
- `packages/domain`: reglas independientes de frameworks, transporte y persistencia; ST-043 no añade reglas.
- `packages/contracts`: contratos compartidos de health y versión.
- `database/migrations`: migraciones acumulativas de historias futuras.
- `infrastructure`: configuración de Workers Static Assets y documentación de entrega.
- `tests`: pruebas de interfaz, paquete construido y controles del workflow.

DEC-008 / ADR-0003 en `happy-learners-ops` aprueban el stack. El lockfile se versiona y CI instala con `npm ci`. D1 y R2 quedan diferidos y no tienen bindings. El CI/CD de la aplicación vive aquí; la generación documental y las integraciones con Jira y OneDrive permanecen en `happy-learners-ops` (DEC-007).

## Entrega y versión

Consulta [infrastructure/README.md](infrastructure/README.md). El SHA se obtiene de `git rev-parse HEAD`, se incorpora al Worker durante el build y se registra en `build/version.json`. En GitHub se comprueba que coincida con `GITHUB_SHA`. La página consulta la versión que responde la API, sin un SHA duplicado en el frontend. Las respuestas API llevan `Cache-Control: no-store`.

Un build local con cambios sin commit informa el SHA base del checkout: no representa esos cambios como una revisión publicada. Solo la construcción desde un checkout integrado y limpio de CI ofrece trazabilidad de una revisión desplegada. La validación local no equivale a un despliegue ni declara ST-043 Done.

## Contexto por historia

```bash
./scripts/prepare-ticket ST-043
```

El contexto proviene del repositorio hermano `happy-learners-ops` (o `HL_OPS_REPO`). No cargar el backlog completo. La Definition of Done conserva su estado `proposed`.
# Entrega v0.2.1

[Empezar aquí](docs/sprint-2/00-EMPEZAR-AQUI.md): guías de usuario y demostración, arquitectura, Sprint Review y matriz Jira–código–pruebas.
