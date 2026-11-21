# PersonaBot

[简体中文](README.md) | [English](README.en.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português (Brasil)](README.pt-BR.md)

Sistema ligero de gestión de bots de QQ con juego de rol. Cada bot de QQ se vincula a una persona y siempre conversa con esa identidad. Los prompts, los plugins de habilidades, el conjunto de comandos y la configuración de dibujo se gestionan desde el panel de administración. El sistema de memoria usa resumen por capas con conciencia temporal y permite ejecutar varios bots de forma independiente.

La versión actual también incluye:

- **Gestión de modelos por proveedor**: configura nombre / Base URL / clave en cada tarjeta de proveedor, descubre los modelos disponibles con un clic, analiza capacidades multimodales y usa iconos de marca reales;
- **Comprensión de imágenes y archivos**: acepta imágenes y archivos adjuntos de QQ; si el modelo principal no puede leer imágenes, un modelo auxiliar de visión las transcribe y se reintenta la petición;
- **Registro completo**: los registros de mensajes guardan "qué se dijo" y los registros de ejecución guardan "qué ocurrió, cuánto tardó y por qué falló", con filtros, paginación y exportación a JSON / Markdown;
- **Memoria por capas y gobierno de conversaciones**: resúmenes rodantes + ventana deslizante + memoria central + inyección incremental, junto con migración por expiración de sesión y una barrera de estado.

## Stack técnico

| Capa | Elección |
| --- | --- |
| Panel de administración | React + TypeScript + Vite + Tailwind CSS (componentes estilo shadcn) |
| Backend | Node.js + Fastify |
| Base de datos | SQLite (better-sqlite3) con migraciones integradas |
| Caché | Caché en memoria + caché de archivos (sin Redis) |
| Tareas programadas | node-cron |
| Integración con QQ | API oficial de bots de QQ v2 (HTTPS OpenAPI + pasarela WebSocket) |
| Modelos de IA | Interfaz unificada de LLM Provider (compatible con OpenAI / Anthropic / Google / personalizado / Mock), presets de proveedor y descubrimiento automático de modelos |
| Multimodal | Envío directo de imágenes con respaldo a un modelo auxiliar de visión (reintento tras transcripción si el principal rechaza imágenes) |
| Despliegue | Panel y API en el mismo proceso y puerto; compatible con Docker / pm2 / systemd |

## Estructura del proyecto

```
PersonaBot/
├── package.json                 # Raíz del workspace pnpm
├── pnpm-workspace.yaml
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── packages/
    ├── server/                  # Servicio backend
    │   └── src/
    │       ├── index.ts         # Entrada del proceso (DB → rutas → pasarela de bots → cron)
    │       ├── app.ts           # Ensamblado de la aplicación Fastify
    │       ├── config.ts        # Variables de entorno y valores por defecto
    │       ├── logger.ts        # Logger Pino
    │       ├── logging.ts       # Doble escritura de registros de ejecución (DB + Pino)
    │       ├── types.ts         # Tipos del dominio
    │       ├── auth/            # Inicio de sesión con contraseña + JWT
    │       ├── db/              # Conexión SQLite, migraciones, seed, repositorios
    │       │   ├── migrate.ts   # Migraciones idempotentes
    │       │   └── repos/       # bots / personas / models / providers / memories / system-logs ...
    │       ├── llm/             # Envoltorios de LLM Provider
    │       │   ├── openai.ts    # Compatible con OpenAI (DeepSeek / personalizado)
    │       │   ├── anthropic.ts # Claude
    │       │   ├── google.ts    # Gemini
    │       │   ├── mock.ts      # Desarrollo local
    │       │   ├── discover.ts  # Descubrimiento de modelos del proveedor
    │       │   ├── vision*.ts   # Detección / escaneo / respaldo por transcripción
    │       │   └── factory.ts   # Resuelve el Provider desde la persona / el bot
    │       ├── qq/              # Integración con bots de QQ
    │       │   ├── token.ts     # Obtención y renovación de access_token
    │       │   ├── client.ts    # Envío de mensajes OpenAPI / URL de pasarela
    │       │   ├── gateway.ts   # Pasarela WebSocket (latido / reconexión / eventos)
    │       │   └── manager.ts   # Gestión de pasarelas de varios bots
    │       ├── attachments/     # Tratamiento de imágenes y archivos adjuntos
    │       ├── moderation/      # Filtro de palabras clave (opcional)
    │       ├── context/         # Ventana deslizante / resumen rodante / máquina de estados / barrera
    │       ├── persona/prompt.ts# Ensamblado del System Prompt (prefijo estable + sufijo dinámico)
    │       ├── skills/          # Sistema de habilidades + habilidad integrada "ex" + autoactualización desde GitHub
    │       ├── memory/          # Memoria por capas: resumen / inyección / perfiles / hechos en tiempo real / agenda / archivos Markdown
    │       ├── painting/        # Dibujo con IA según la configuración de la persona
    │       ├── pipeline/        # Canalización de mensajes (agrupación por debounce / interrupción / reintento)
    │       ├── proactive/       # Mensajes proactivos
    │       ├── stats/           # Agregación de estadísticas
    │       ├── cron/            # Tareas node-cron
    │       └── routes/          # API REST
    └── admin/                   # Frontend del panel
        └── src/
            ├── App.tsx          # Rutas + autenticación
            ├── assets/providers/# Iconos SVG de marcas integrados
            ├── components/      # Layout, componentes de UI, ModelIcon
            ├── lib/             # Cliente de API / tipos / autenticación
            └── pages/           # Dashboard / Bots / Personas / Models / Memories / Logs / Stats / Skills / Settings
```

## Inicio rápido

```bash
# 1. Instalar dependencias (pnpm 9+ / Node 20+)
pnpm install

# 2. Preparar variables de entorno
cp .env.example .env
# Cambiar ADMIN_PASSWORD / JWT_SECRET / ENCRYPTION_KEY

# 3. Inicializar la base de datos (las migraciones se ejecutan en el primer arranque)
pnpm --filter @personabot/server migrate

# 4. Modo desarrollo (backend y frontend en paralelo)
pnpm dev
# Backend http://localhost:3000
# Frontend http://localhost:5173 (proxy inverso de /api ya configurado)

# 5. Compilar y arrancar en producción
pnpm build
pnpm start
# El panel y la API se sirven en http://localhost:3000
```

### División del código del frontend

Las páginas del panel se cargan de forma diferida por ruta (React.lazy + Suspense) y las dependencias pesadas, como los gráficos, se dividen en fragmentos independientes. El paquete inicial baja de unos 700KB a unos 215KB (unos 69KB con gzip).

## Gestión de modelos y entrada multimodal

La página de modelos muestra una lista de **tarjetas de proveedor**. La configuración del proveedor (nombre / API Base / clave) se mantiene una sola vez y se aplica a todos sus modelos. Cada modelo solo guarda `modelId`, nombre visible, temperatura, tokens máximos, indicador de visión y estado de activación.

- **Añadir proveedor**: permite crear primero un proveedor vacío (sin modelos) y añadirlos después; si se deja la clave en blanco se reutiliza la guardada.
- **Reconocimiento automático**: el nombre de proveedor introducido o seleccionado se compara con iconos y presets de marca (OpenAI / Claude / Gemini / DeepSeek / Qwen / Zhipu / Moonshot / Volcano / Hunyuan y otros). Los iconos son SVG oficiales integrados.
- **Descubrimiento**: llama al endpoint `/models` del proveedor para descubrir modelos disponibles y añadirlos en lote; también permite añadir o quitar modelos uno a uno.
- **Prueba de conectividad**: envía una petición mínima a un modelo y devuelve la respuesta y el uso de tokens.
- **Escaneo de visión**: combina reglas de nombres con pruebas reales opcionales (persistibles) para decidir si un modelo acepta imágenes.

Flujo multimodal: las imágenes y archivos de QQ se normalizan en el módulo de adjuntos; si el modelo principal admite visión se envían con el mensaje, y si no, un modelo auxiliar de visión los transcribe a texto y se reintenta la misma petición. Los límites de tamaño y dimensiones se adaptan por proveedor.

## Registros

La página de registros tiene dos pestañas con fuentes de datos independientes:

| Tipo | Registra | Uso |
| --- | --- | --- |
| Registro de mensajes (`message_logs`) | Texto de la conversación, dirección, persona, bot, usuario | Revisar "qué se dijo"; también es la fuente de estadísticas y resúmenes de memoria |
| Registro de ejecución (`system_logs`) | Nivel, categoría, etapa, duración, detalle estructurado | Investigar "qué ocurrió, cuánto tardó y por qué falló" |

Los registros de ejecución cubren:

- Inicio y fin de la generación de respuesta (persona, proveedor, modelo, longitud del historial, presencia de imágenes, entrada del usuario);
- Cada petición y respuesta al modelo (`apiBase`, temperatura, tokens máximos, número de mensajes, caracteres, duración, usage);
- Reintento con respaldo de visión tras el rechazo de imágenes por el proveedor;
- Reintento con instrucción forzada tras activarse la barrera de estado;
- Pruebas de conectividad, descubrimiento de modelos y escaneos de visión;
- Nombre, mensaje y traza del error cuando falla la generación.

Ambos registros permiten filtrar por persona, usuario, palabra clave y rango de fechas, paginar y exportar a JSON / Markdown. Los mensajes se filtran además por dirección y los de ejecución por nivel y categoría. El filtro de usuario es un desplegable agregado a partir de los registros existentes.

## Memoria y conversaciones

- **Memoria por capas**: memorias diaria / de tres días / quincenal / mensual se condensan por capas, junto con perfiles de usuario y hechos atómicos.
- **Memoria central**: los acuerdos, preferencias y hechos por encima de un umbral de importancia entran en un área protegida y se inyectan aparte, por lo que editar archivos nunca los elimina.
- **Recuperación de memoria relevante**: se buscan fragmentos a partir de la entrada actual y los temas pendientes para evitar inyectar todo.
- **Archivos de memoria incrementales**: si el contenido no cambió respecto al turno anterior, solo se inyecta un marcador de posición para ahorrar tokens.
- **Hechos en tiempo real**: los acuerdos, preferencias e información importante detectados durante la conversación se escriben de inmediato en la memoria a largo plazo y surten efecto en el siguiente turno.
- **Gobierno de conversaciones**: una ventana deslizante conserva las últimas N rondas literales y las anteriores se resumen de forma rodante; al expirar una sesión, los puntos a largo plazo se migran a la memoria central antes de abrir una nueva, de modo que la memoria no se pierde con la caché.
- **Barrera de estado**: intercepta y reintenta respuestas del tipo "vete a dormir" cuando, por ejemplo, los deberes siguen sin terminar.
- **Filtro de calidad de salida**: las respuestas vacías, repetidas exactamente, con texto corrupto, caracteres de control, fugas del prompt del sistema o prefijos de rol se reintentan una vez con una instrucción correctiva; si vuelven a fallar, se descarta el turno sin escribir en la conversación ni en el flujo de mensajes.
- **Limpieza de respuestas erróneas**: la página "Conversaciones" muestra el historial por persona y usuario y permite borrar un mensaje, vaciar desde un punto o restablecer el contexto. Los mensajes eliminados se marcan con `invalid=1` en `message_logs`, por lo que la memoria diaria y la extracción de hechos atómicos los omiten; marca "borrar también las memorias existentes de las fechas afectadas" para eliminar las memorias diarias y los hechos ya generados.

## Filtro de palabras clave (opcional)

Se activa en "Configuración → Filtro de palabras clave". La lista se separa por saltos de línea, comas o punto y coma. Cuando un mensaje del usuario coincide:

- **Bloquear**: el mensaje no llega al modelo y se devuelve un aviso fijo;
- **Sustituir por \***: las palabras coincidentes se reemplazan por el mismo número de asteriscos y la conversación continúa.

Desactivado por defecto. Es un filtro operativo básico, no moderación de contenido.

## Añadido de IA a los archivos de memoria (opcional)

Los tres archivos de memoria (`MEMORY.md` / `USER.md` / `persona-state.md`) dejan de sobrescribirse automáticamente en cuanto se editan a mano. Si quieres que la IA siga acumulando memoria sin destruir tu texto:

1. Activa el interruptor global en "Configuración → Añadido de IA a archivos de memoria";
2. En la página de memoria, selecciona un archivo y activa "Permitir añadido de IA" en los que hayas editado manualmente.

Una vez activado, la tarea diaria de memoria añade el contenido nuevo del día a la sección `<!-- AI:APPEND -->` al final del archivo:

- Tu texto original (antes del marcador) nunca se modifica;
- El contenido añadido se deduplica línea a línea;
- Al desactivar el interruptor del archivo se detienen los añadidos y se conservan tanto el original como lo ya añadido.

## Calidad y pruebas

```bash
# Comprobación de tipos (server + admin)
pnpm -r typecheck

# Pruebas unitarias (node:test; cubre reloj, división de texto, barrera de estado, filtro de palabras clave, contexto y memoria, configuración de proveedores, registros de ejecución y limitación de intentos)
pnpm test

# Compilación
pnpm build
```

La CI está definida en `.github/workflows/ci.yml` y ejecuta typecheck, test y build en cada push y pull request.

## Seguridad

- **Protección de secretos por defecto**: con `NODE_ENV=production`, el servidor se niega a arrancar si `ADMIN_PASSWORD` / `JWT_SECRET` / `ENCRYPTION_KEY` siguen con sus valores por defecto; en desarrollo solo avisa.
- **Hash de la contraseña de administrador (opcional)**: definir `ADMIN_PASSWORD_HASH` (`scrypt$salt$hash`) tiene prioridad sobre la contraseña en texto plano y compara en tiempo constante. Se genera con:

```bash
node packages/server/dist/scripts/hash-password.js "tu-contraseña"
```

- **Cifrado de campos sensibles**: el ClientSecret de QQ, las claves de LLM, las claves de dibujo y los tokens de GitHub se guardan con AES-256-GCM; la API solo indica si están configurados y nunca devuelve el texto plano.
- **Autenticación**: todos los endpoints excepto el inicio de sesión y el chequeo de salud requieren sesión, mediante `Authorization: Bearer` (API) o cookie httpOnly (recarga del navegador); las cookies usan `Secure` en producción.
- **Límite de intentos de inicio de sesión**: máximo 10 intentos por IP en 15 minutos.
- **CORS desactivado por defecto**: el despliegue en el mismo origen no necesita CORS; para acceso cruzado, indica los orígenes permitidos en `CORS_ORIGINS`, de modo que las credenciales nunca se reflejen a orígenes arbitrarios.
- **Bloqueo de comandos del agente de servidor**: una lista negra integrada de comandos catastróficos (formateo, escritura directa en dispositivos de bloque, apagado, borrado recursivo de la raíz, vaciado de cortafuegos y similares) se rechaza incluso con el agente activado.
- **Tiempos de espera de red**: todas las peticiones externas (QQ / LLM / dibujo / GitHub / descarga de adjuntos) tienen tiempo de espera para evitar conexiones colgadas y fugas de memoria.
- **Redacción de registros**: el logger Pino redacta `clientSecret` / `apiKey` / `password` y campos similares; los registros de ejecución guardan metadatos de la petición, duraciones y causas de error, y pueden incluir fragmentos de la conversación para facilitar el diagnóstico.

## Copias de seguridad

SQLite usa `VACUUM INTO` para generar instantáneas en línea consistentes sin detener el servicio. Se conservan las 10 más recientes en `data/backups/`:

```bash
# Copia de seguridad conservando las 10 más recientes
pnpm --filter @personabot/server backup

# Número de copias personalizado
node packages/server/dist/scripts/backup.js 20
```

## Modelo de datos

| Tabla | Descripción |
| --- | --- |
| `bots` | Instancias de bot de QQ; el ClientSecret se cifra y se vincula una persona |
| `personas` | Paquetes de definición de persona (prompt / rasgos / habilidades / comandos / dibujo / configuración de modelo) |
| `models` | Configuración de modelos LLM (proveedor / clave API / base / temperatura / tokens máximos / visión / activo) |
| `providers` | Configuración por proveedor (nombre / base / clave cifrada); se permiten proveedores vacíos |
| `memories` | Memorias por capas (daily / three_day / biweekly / monthly) |
| `conversations` | Historial de conversaciones (solo añadir durante el chat normal para reutilizar el prefijo en caché; el administrador puede limpiarlo con precisión) |
| `user_profiles` | Perfiles de hábitos del usuario |
| `stats` | Estadísticas diarias (tokens / aciertos de caché / imágenes / número de mensajes) |
| `message_logs` | Flujo de mensajes (fuente de estadísticas y resúmenes de memoria; `invalid=1` indica que se eliminó de la conversación) |
| `system_logs` | Registros de ejecución (nivel / categoría / etapa / duración / detalle estructurado, con índices) |
| `token_usage` | Detalle de uso de tokens por llamada |
| `painting_logs` | Registros de dibujo y base de las cuotas diarias |
| `skills` | Plugins de habilidades (integrados / personalizados / sincronizados con GitHub) |
| `settings` | Configuración del sistema clave-valor |

Las migraciones están en `packages/server/src/db/migrate.ts`. Se ejecutan en orden de id y se registran en `_migrations`, por lo que es seguro repetirlas.

## Resumen de la API REST

| Grupo | Endpoints |
| --- | --- |
| Autenticación | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Bots | `GET/POST /api/bots`, `PUT/DELETE /api/bots/:id`, `POST /api/bots/:id/toggle|restart`, `GET /api/bots/status` |
| Personas | `GET/POST /api/personas`, `PUT/DELETE /api/personas/:id`, `POST /api/personas/:id/simulate` |
| Modelos | `GET/POST /api/models`, `POST /api/models/batch`, `PUT/DELETE /api/models/:id`, `POST /api/models/:id/test|discover`, `POST /api/models/discover`, `POST /api/models/vision-scan` |
| Proveedores | `GET /api/models/providers`, `POST/PUT/DELETE /api/models/providers`, `POST /api/models/providers/discover` |
| Memoria | `GET /api/memories`, `GET /api/memories/users`, `POST /api/memories/trigger|import`, `PUT/DELETE /api/memories/:id`, `GET/PUT /api/memories/file(s)`, `POST /api/memories/file/reset`, `PUT /api/memories/file/append` |
| Conversaciones | `GET /api/conversations`, `GET /api/conversations/detail`, `DELETE /api/conversations/message|from`, `POST /api/conversations/reset` |
| Registros | `GET /api/logs`, `GET /api/logs/users`, `GET /api/logs/export`, `GET /api/logs/events`, `GET /api/logs/events/export` |
| Estadísticas | `GET /api/stats/dashboard|trends|persona/:id|messages` |
| Habilidades | `GET/POST /api/skills`, `PUT/DELETE /api/skills/:id`, `POST /api/skills/sync` |
| Configuración | `GET/PUT /api/settings`, `GET /api/system/info` |
| Operaciones | `POST /api/system/proactive/run|daily/run|tokens/refresh|bots/reload` |

Todos los endpoints excepto `login` y `health` requieren sesión (`Authorization: Bearer <token>` o cookie).

## Tareas programadas

| Tarea | Horario | Descripción |
| --- | --- | --- |
| Memoria diaria | Cada día a las 00:00 | Organiza las conversaciones del día anterior en una memoria diaria clara |
| Reinicio de estadísticas | Cada día a las 00:05 | Las estadísticas del nuevo día empiezan desde cero |
| Memoria de tres días | Cada 3 días a la 01:00 | Resume las memorias diarias de los últimos 3 días |
| Memoria condensada | Cada 2 semanas a las 02:00 | Comprime dos semanas de memoria |
| Memoria mensual | Día 1 de cada mes a las 03:00 | Resume las memorias condensadas de dos semanas |
| Renovación de tokens | Cada día a las 04:00 | Renueva los access_token próximos a caducar |
| Mensajes proactivos | Cada 30 minutos | Se inician según las horas activas del usuario y los rasgos de la persona |
| Saludo diario | Cada 15 minutos | Se envía al coincidir la ventana activa del usuario y si no se envió ese día |
| Limpieza de memoria | Cada día a las 04:30 | Limpia los contadores en memoria de mensajes proactivos |
| Sincronización de pasarelas | Cada 5 minutos | Sincroniza el estado de arranque de los bots desde la base de datos |
| Autoactualización de habilidades | Configurable | Descarga las últimas habilidades del repositorio de GitHub |

## Optimización de aciertos de caché

1. Prefijo estable del System Prompt: la definición de la persona va primero y permanece idéntica byte a byte; el contenido dinámico, como la hora y la memoria, va al final.
2. Reutilización del prefijo de contexto por conversación: el mismo usuario y persona siempre comparten una conversación.
3. Conjunto mínimo de herramientas e historial solo de añadir: el historial solo se añade, nunca se reescribe ni se vuelve a resumir para turnos anteriores.
4. La compresión automática reutiliza el prefijo: los resúmenes se añaden al final de la lista de mensajes.
5. Métricas de caché: la página de estadísticas muestra `cacheRead / (input + cacheRead + cacheWrite)`.

## Despliegue

### Docker

```bash
cp .env.example .env
docker compose up -d --build
```

### pm2

```bash
pnpm build
pm2 start packages/server/dist/index.js --name personabot
```

### systemd

```ini
[Unit]
Description=PersonaBot
After=network.target

[Service]
WorkingDirectory=/opt/personabot
ExecStart=/usr/bin/node packages/server/dist/index.js
EnvironmentFile=/opt/personabot/.env
Restart=always

[Install]
WantedBy=multi-user.target
```

La base de datos está en `data/`, los registros en `logs/` y los secretos se gestionan mediante `.env`.

## Pruebas locales sin credenciales reales

1. Crea una tarjeta de proveedor en "Modelos" (`provider = mock`, o déjala vacía y no configures modelos para usar Mock automáticamente) y añade modelos según necesites.
2. Crea una persona en "Personas", edita el prompt y pulsa "Simular" para conversar localmente.
3. Genera manualmente la memoria diaria / de tres días / mensual en "Memoria" para verificar la inyección por capas.
