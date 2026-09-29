# Arquitectura actual

## Recorrido de una solicitud

```text
Teléfono o navegador
        │ HTTPS
        ▼
Cloudflare Worker ── React y archivos estáticos
        │ sesión, permiso y organización
        ▼
OrganizationStore por organización
        └── SQLite: usuarios, currículo, recursos,
            borradores, publicación y finalizaciones
```

React muestra los formularios y las lecciones. El Worker valida entradas, sesión, rol y pertenencia a la organización. Cada organización tiene su propio Durable Object con SQLite. No se agregaron servicios.

## Publicación

Una lección guarda contenido de borrador, versión de edición, copia publicada y número de revisión. Guardar exige la versión del borrador que se leyó; si cambió, responde con conflicto. Publicar copia el borrador y los recursos vinculados, de modo que editar o archivar un recurso no altere lo que ve el estudiante.

Nivel → Unidad → Lección es la estructura visible. La tabla histórica de programas se conserva como contenedor interno para mantener los datos de v0.2.0. No existe una pantalla de programas múltiples.

## Acceso y privacidad

Las sesiones están en servidor y se entregan mediante cookie HttpOnly, SameSite y Secure en producción. Las escrituras validan origen. Administrador gestiona organización y permisos; Educador gestiona contenido. Un cambio de permisos revoca las sesiones del miembro.

El acceso público exige un código de lección publicada. No recibe usuarios, credenciales ni borradores. Las preguntas se evalúan en el navegador. El servidor conserva únicamente el identificador de lección y la fecha del evento de finalización. Los conteos no equivalen a estudiantes únicos.

## Migración y recuperación

Las migraciones 0003–0006 son acumulativas y se aplican dentro de una transacción. Conservan usuarios, recursos, lecciones y publicaciones anteriores. La prueba de actualización compara el contenido anterior y revisa las claves foráneas.

Antes de una recuperación, conserva el punto de restauración de SQLite del Durable Object afectado. Para un defecto de interfaz o API, despliega una versión corregida compatible con el esquema actual. No despliegues directamente v0.2.0 sobre el nuevo esquema: sus inserciones antiguas no especifican columnas. Si fuera indispensable regresar al código antiguo, restaura también el punto previo de almacenamiento dentro de la ventana de recuperación disponible y verifica salud, sesión y lecciones. Esa restauración requiere evaluar las escrituras posteriores; nunca se ejecuta automáticamente.

Cloudflare documenta [SQLite y Time Travel](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) y [rollback de Workers](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/). Las migraciones y snapshots publicados siguen versionados en el repositorio.
