# happy-learners-platform

Monorepo privado del producto Happy Learners. Contendrá la aplicación web, la API, el dominio compartido, los contratos, las migraciones de base de datos y la infraestructura necesaria para desplegar el producto.

La tecnología de implementación se decidirá mediante un ADR antes de incorporar dependencias. Esta estructura fija límites de responsabilidad sin crear repositorios separados antes de que existan equipos o ciclos de entrega independientes.

## Uso en WSL2

Trabaja desde el sistema de archivos Linux:

```bash
mkdir -p ~/code/personal/happy-learners
cd ~/code/personal/happy-learners
git clone git@github.com:happy-learners-gt/happy-learners-platform.git
cd happy-learners-platform
mise trust
./scripts/verify
```

No clones el repositorio bajo `/mnt/c`. Mantén `happy-learners-platform` y `happy-learners-ops` como directorios hermanos para preparar contextos de trabajo sin copiar todo el backlog.

## Estructura

- `apps/web`: experiencia web.
- `apps/api`: interfaz de aplicación y composición del backend.
- `packages/domain`: reglas de negocio independientes de frameworks.
- `packages/contracts`: contratos compartidos entre procesos y aplicaciones.
- `database/migrations`: cambios versionados del esquema y datos de referencia.
- `infrastructure`: definición reproducible de despliegue y operación.
- `tests`: pruebas que cruzan más de una unidad o aplicación.

La documentación del producto, las decisiones, el backlog y la publicación a OneDrive pertenecen a `happy-learners-ops`. Este repositorio conserva únicamente documentación cercana al código.

## Preparar una sesión de Codex

```bash
./scripts/prepare-ticket ST-043
```

El comando genera `.codex/context.md` desde el registro canónico del repositorio de operaciones. Ese archivo es local y deliberadamente pequeño.
