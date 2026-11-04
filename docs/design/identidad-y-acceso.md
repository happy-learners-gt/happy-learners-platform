# Identidad y acceso

Rediseño de REL-007 tras la revisión del responsable del proyecto (04-nov-2026): la configuración del segundo factor y
de las passkeys era manual, y la seguridad estaba repartida entre «Roles y accesos», «Seguridad», Educadores y Mi cuenta,
sin una vista que sirviera para operar. Referencias: Microsoft Entra admin center (Información de seguridad, registros de
inicio de sesión, revisiones de acceso, puntuación de identidad) y Okta (Security › HealthInsight, perfil de la persona
con sus factores). Se adapta a una institución educativa pequeña: menos opciones, cada una con su acción.

## 1. La persona: «Seguridad» en Mi cuenta

Una sola página (`/mi-cuenta/seguridad`) con lo que protege la cuenta, como «Información de seguridad» de Microsoft:

1. **Estado** arriba: «Tu cuenta está protegida» o qué falta, con un botón.
2. **Métodos de inicio de sesión**: contraseña, passkeys, aplicación de autenticación, códigos de recuperación y
   cuentas vinculadas, en una lista; cada uno con su acción. **Agregar un método** abre un selector con la passkey
   primero («Recomendado: entra con tu huella, rostro o PIN»).
3. **Dispositivos y sesiones** y **Actividad reciente** (inicios y cambios de seguridad propios).

Cambios de flujo:

- **Modo de confirmación** (como el «sudo mode» de GitHub): durante 10 minutos después de entrar o de confirmar con la
  contraseña, una passkey o un código, las acciones sensibles no piden la contraseña otra vez. Fuera de ese tiempo, un
  diálogo pide confirmar y la acción sigue sola.
- **Passkey en un clic**: «Crear passkey» abre el diálogo del dispositivo; el nombre se pone solo («Chrome en Windows»)
  y se cambia después.
- **Aplicación de autenticación con QR**: se escanea; «¿No puedes escanear?» muestra la clave. El código va en seis
  casillas que aceptan pegar y se envía solo al completarse. Los códigos de recuperación se descargan, copian o imprimen.
- **Entrar con passkey sin escribir el usuario** (credenciales detectables) y sugerencia de crear una passkey después de
  entrar con contraseña, que se puede descartar.

## 2. Administración: «Identidad y acceso»

Un centro (`/identidad`) que reemplaza «Roles y accesos» y «Seguridad» (sus direcciones redirigen), con navegación lateral
en escritorio y pestañas en el teléfono:

| Sección | Para qué |
| --- | --- |
| **Resumen** | Puntuación de seguridad de la organización y recomendaciones con su acción: administración sin segundo factor, cuentas inactivas con acceso, contraseñas filtradas sin revisar, tokens por vencer, revisión de accesos atrasada, proveedor en borrador, fallos y bloqueos recientes |
| **Personas** | Directorio de acceso: rol, estado, métodos registrados, último inicio, riesgo. Al abrir una persona, un panel con su resumen, roles y grupos, métodos (restablecer, desvincular), sesiones (cerrar) y su actividad de seguridad |
| **Roles y grupos** | La matriz de permisos por rol, los grupos de seguridad con sus personas y la coordinación |
| **Políticas** | Métodos permitidos, segundo factor por rol, contraseñas y duración de sesiones, en tarjetas con su efecto |
| **Inicio de sesión** | Google, Microsoft, Apple (configurados o no) y el proveedor institucional |
| **Integraciones** | Tokens de toda la organización |
| **Registros** | Inicios de sesión, auditoría y la integridad de la cadena |
| **Revisiones de acceso** | Campañas: cada persona con «Mantener» o «Quitar acceso»; al completar se aplica y queda registrado |

Educadores deja de tener acciones de seguridad propias: «Seguridad de la cuenta» abre la persona en Identidad y acceso.

## 3. Medidas

- Configurar el segundo factor: de 4 pantallas y 3 datos escritos (contraseña, clave, código) a escanear y escribir un
  código.
- Crear una passkey: de escribir la contraseña y un nombre a un clic.
- Encontrar a quien no tiene segundo factor: del CSV de revisión a una recomendación con la lista.
