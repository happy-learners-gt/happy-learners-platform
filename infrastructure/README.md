# Entrega de demostración — ST-043

`wrangler.jsonc` configura `happy-learners-demo` con Workers Static Assets y destino `workers.dev`. `/api/*` pasa primero por el Worker; el resto sirve la web. No hay D1, R2, dominio personalizado ni credenciales en esta configuración.

## Paquete verificado

`scripts/build.mjs` obtiene el SHA exacto del checkout, comprueba `GITHUB_SHA` cuando existe, construye la web y utiliza Wrangler dry-run para empaquetar el Worker. `build/` contiene el bundle, los assets, el manifiesto de versión y una configuración de entrega sin recompilación (`no_bundle`). Las pruebas ejercitan este paquete mediante Wrangler local. El dry-run final comprueba también la configuración destinada a la entrega.

GitHub Actions ejecuta `npm ci` y `./scripts/verify` para PRs y pushes a main. Solo al terminar correctamente sube el artefacto `demo-<SHA>`. `deploy` requiere el éxito de `verify` y únicamente acepta push a `refs/heads/main`. Descarga el artefacto del mismo run, comprueba su versión y lo publica con Wrangler. Ningún paso permite continuar tras un fallo de verificación. Los PRs no reciben secretos ni publican.

El workflow se activa técnicamente ante todo push a main. Considerarlo un cambio aceptado depende del flujo de integración y el preflight manual del responsable. GitHub Free/private no ofrece Environments ni protección técnica de main; el control mediante PR draft y checks verdes es procedimental. Las pruebas locales comprueban la estructura del workflow; el comportamiento del scheduler de GitHub debe validarse allí después de autorizar su publicación.

## Acciones externas pendientes de aprobación

1. Autorizar commit/push e integración del cambio mediante el flujo acordado.
2. Confirmar el Jira key, revisar los PR draft y los checks verdes del HEAD vigente; comprobar que main no cambió.
3. Ejecutar `./hlcloudflare doctor` desde ops y revisar su resultado. No configurar Environments, rulesets ni protección de ramas bajo GitHub Free/private.
4. Confirmar la cuenta Cloudflare y su subdominio `workers.dev`. Autorizar la creación inicial del Worker `happy-learners-demo` durante la primera entrega.
5. Crear un token limitado a la cuenta de demostración a partir de la plantilla “Edit Cloudflare Workers”, revisando el mínimo de permisos y retirando permisos DNS, D1 y R2 no usados. Guardar exclusivamente en Actions repository secrets de GitHub `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`; no son bindings del Worker. Revisar los permisos contra el error concreto si la cuenta exige alguno adicional; no ampliar preventivamente a todas las cuentas.
6. Autorizar el despliegue real. Comprobar `/api/health`, `/api/version` y la página en `https://happy-learners-demo.<subdominio-aprobado>.workers.dev`; comparar el SHA completo con el commit integrado.
7. Verificar en GitHub que un PR no despliega y que una ejecución con verificación fallida deja `deploy` omitido. Registrar la evidencia real antes de declarar la historia terminada.

La publicación documental, cualquier actualización de Jira y los worklogs requieren autorización independiente. El plan documental de ops no se aplica desde este workflow. El dominio personalizado se difiere hasta incorporar su zona DNS a Cloudflare. El plan gratuito es una restricción inicial: medir consumo y errores antes de cambiar de plan o separar unidades. La observabilidad de Workers está habilitada; su funcionamiento real queda pendiente del despliegue.

## Referencias técnicas

- [Routing de Static Assets](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/).
- [GitHub Actions para Workers](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).
- [Dependencias entre jobs de GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idneeds).

La corrección Free/private es operativa y no cambia la arquitectura. `environment: demo` se omite; los nombres de secretos se resuelven a nivel de repositorio. `hlcloudflare configure` requiere autorización posterior; no se ha ejecutado.
