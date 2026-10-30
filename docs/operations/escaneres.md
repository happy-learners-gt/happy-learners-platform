# Escáneres de seguridad

Workflow `Security scanners` (`.github/workflows/security.yml`), carril B.2 de la hoja de ruta. Herramientas abiertas
que no requieren GitHub Advanced Security (el repositorio es privado).

| Escáner | Qué revisa | En un PR | Semanal (lunes) |
| --- | --- | --- | --- |
| gitleaks | Secretos en el historial de Git | Solo los commits del PR; falla si hay uno nuevo | Todo el historial |
| OSV-Scanner | Vulnerabilidades conocidas en `package-lock.json` | Falla si hay una sin excepción vigente | Igual |
| Semgrep | Código: reglas públicas de TypeScript, React, Node y JavaScript, y las propias de `.semgrep/` | Solo lo que el PR agrega; falla si hay un hallazgo nuevo | Todo el código; lista lo abierto en el resumen del job, sin fallar |

## Reglas propias (`.semgrep/`)

- `sql-interpolated-text`: SQL armado con texto interpolado en `prepare` o `exec`. Los valores van como parámetros
  (`?`). Se permiten las listas de marcadores (`ids.map(() => "?").join(",")`). Un fragmento constante (columnas,
  filtros opcionales `AND x=?`) se marca con `// nosemgrep: sql-interpolated-text` y una razón.
  Al crear la regla había 125 interpolaciones, todas revisadas de forma superficial como fragmentos constantes, listas
  de marcadores o nombres de columna validados; la auditoría manual (carril B.3) las revisa una por una.

## Excepciones

- **Secretos:** `.gitleaksignore`, una huella por línea con un comentario que explica por qué no es un secreto.
- **Dependencias:** `osv-scanner.toml`, cada excepción con `reason` y `ignoreUntil`: al vencer, el escaneo vuelve a
  fallar hasta actualizar la dependencia o revisar la excepción. Hoy: `sharp` y `undici` de miniflare (simulador local
  de wrangler 4.132.0; no llegan a producción), hasta actualizar wrangler.
- **Código:** `// nosemgrep: <regla>` en la línea, con la razón.

## Ejecución local

```bash
docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.28.0 git /repo --no-banner --redact --gitleaks-ignore-path /repo/.gitleaksignore
docker run --rm -v "$PWD:/src:ro" ghcr.io/google/osv-scanner:v2.2.2 scan source --config /src/osv-scanner.toml --lockfile /src/package-lock.json
docker run --rm -v "$PWD:/src" -w /src semgrep/semgrep:1.140.0 semgrep scan --metrics=off --config p/typescript --config p/react --config p/nodejs --config p/javascript --config .semgrep
```

## Siguientes pasos

1. Tras dos semanas sin falsos positivos, marcar `secrets`, `dependencies` y `code` como verificaciones obligatorias
   de `main`.
2. Actualizar wrangler y quitar las excepciones de miniflare.
3. CodeQL: ver las alternativas en la hoja de ruta (requiere repositorio público o GitHub Advanced Security).
