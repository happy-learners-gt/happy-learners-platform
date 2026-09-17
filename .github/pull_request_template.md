Jira: <!-- HL-N y enlace -->
Source ID: <!-- ST-NNN -->
Release: <!-- REL-NNN -->
Criterios: <!-- criterios satisfechos y pendientes -->
Evidencia: <!-- pruebas, checks, SHA, despliegue o documentación verificable -->

Describe el cambio, sus límites y el impacto de versión.

- [ ] Rama, commits y título incluyen la Jira key; el título comienza por HL-N.
- [ ] La release y el Source ID coinciden con el alcance revisado.
- [ ] Ejecuté `./scripts/verify` y `git diff --check`.
- [ ] Checks aprobados y evidencia sin credenciales ni datos personales.
- [ ] No se declara Done por integrar el PR; Jira requiere validación.

<!-- Excepción maintenance/: label type:maintenance, título maintenance: ... y
Sin Jira: justificación concreta de al menos 16 caracteres. No aplica a trabajo de producto.
Dependabot: únicamente PR creados por dependabot[bot] en dependabot/. -->
