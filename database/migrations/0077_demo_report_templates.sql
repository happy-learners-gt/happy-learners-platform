-- Plantillas de demostración (DOC-02, docs/transformacion/auditoria.md §8). Documentos se veía vacío en la
-- demostración: una boleta y una constancia publicadas para el programa «Primaria bilingüe», con el formato de siempre
-- de cada documento. Solo org-demo, solo si el programa existe y no hay ya una plantilla activa de ese tipo y programa.

INSERT INTO report_templates(id,organization_id,kind,program_id,name,draft,published_version,status,updated_by,updated_at)
SELECT 'seed-template-boleta-primaria','org-demo','report-card','seed-program-primaria','Boleta de Primaria bilingüe','{"kind":"report-card","page":{"size":"letter","orientation":"portrait","marginMm":20},"logoId":null,"header":["{{organizacion.nombre}}","Boleta de calificaciones · Docente: {{seccion.docentes}}"],"footer":"Documento generado por Happy Learners","blocks":[{"id":"estudiante","type":"title","text":"{{estudiante.nombre}}"},{"id":"datos","type":"fields","pairs":[{"label":"Curso","field":"curso.nombre"},{"label":"Sección","field":"seccion.nombre"},{"label":"Ciclo","field":"ciclo.nombre"}]},{"id":"periodos","type":"table","dataset":"periodos","columns":[{"field":"periodo","label":"Periodo","width":3},{"field":"nota","label":"Nota","width":1,"align":"right"},{"field":"estado","label":"Estado","width":1.5},{"field":"comentario","label":"Comentario","width":4}],"borders":true,"shade":true},{"id":"resultado","type":"fields","pairs":[{"label":"Resultado del ciclo","field":"resultado.nota"},{"label":"Estado","field":"resultado.estado"},{"label":"Esquema","field":"esquema.nombre"}]},{"id":"firmas","type":"signatures","lines":[{"name":"Docente","role":"{{seccion.docentes}}"},{"name":"Coordinación académica","role":"{{organizacion.nombre}}"}]}]}',1,'active','user-0','2026-11-03T12:00:00Z'
WHERE EXISTS (SELECT 1 FROM study_programs WHERE id='seed-program-primaria' AND organization_id='org-demo')
  AND EXISTS (SELECT 1 FROM users WHERE id='user-0')
  AND NOT EXISTS (SELECT 1 FROM report_templates WHERE organization_id='org-demo' AND kind='report-card' AND program_id='seed-program-primaria' AND status='active');
INSERT INTO report_template_versions(template_id,version,content,published_by,published_at)
SELECT id,1,draft,'user-0','2026-11-03T12:00:00Z' FROM report_templates
WHERE id='seed-template-boleta-primaria' AND NOT EXISTS (SELECT 1 FROM report_template_versions WHERE template_id='seed-template-boleta-primaria');

INSERT INTO report_templates(id,organization_id,kind,program_id,name,draft,published_version,status,updated_by,updated_at)
SELECT 'seed-template-constancia-primaria','org-demo','certificate','seed-program-primaria','Constancia de Primaria bilingüe','{"kind":"certificate","page":{"size":"letter","orientation":"portrait","marginMm":20},"logoId":null,"header":["{{organizacion.nombre}}","Constancia"],"footer":"Documento generado por Happy Learners","blocks":[{"id":"titulo","type":"title","text":"Constancia de {{constancia.tipo}}","align":"center"},{"id":"cuerpo","type":"text","text":"Se hace constar que {{estudiante.nombre}} está inscrita o inscrito en {{curso.nombre}}, sección {{seccion.nombre}}, del ciclo {{ciclo.nombre}}, del {{constancia.desde}} al {{constancia.hasta}}."},{"id":"lugar","type":"text","text":"Se extiende la presente el {{fecha.hoy}}.","italic":true},{"id":"firmas","type":"signatures","lines":[{"name":"Dirección","role":"{{organizacion.nombre}}"}]}]}',1,'active','user-0','2026-11-03T12:00:00Z'
WHERE EXISTS (SELECT 1 FROM study_programs WHERE id='seed-program-primaria' AND organization_id='org-demo')
  AND EXISTS (SELECT 1 FROM users WHERE id='user-0')
  AND NOT EXISTS (SELECT 1 FROM report_templates WHERE organization_id='org-demo' AND kind='certificate' AND program_id='seed-program-primaria' AND status='active');
INSERT INTO report_template_versions(template_id,version,content,published_by,published_at)
SELECT id,1,draft,'user-0','2026-11-03T12:00:00Z' FROM report_templates
WHERE id='seed-template-constancia-primaria' AND NOT EXISTS (SELECT 1 FROM report_template_versions WHERE template_id='seed-template-constancia-primaria');
