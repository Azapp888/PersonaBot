# PersonaBot

[简体中文](README.md) | [English](README.en.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português (Brasil)](README.pt-BR.md)

Leichtgewichtiges Verwaltungssystem für QQ-Rollenspiel-Bots. Jeder QQ-Bot ist an eine Persona gebunden und spricht immer in deren Identität. Prompts, Skill-Plugins, Befehlspools und Zeichnungseinstellungen lassen sich im Admin-Bereich konfigurieren. Das Gedächtnissystem nutzt geschichtete Zusammenfassungen mit Zeitbewusstsein, und mehrere Bots können unabhängig betrieben werden.

Die aktuelle Version bietet zusätzlich:

- **Modellverwaltung pro Anbieter**: Name / Base-URL / Schlüssel je Anbieterkarte zentral konfigurieren, verfügbare Modelle mit einem Klick ermitteln, multimodale Fähigkeiten scannen und echte Marken-Icons verwenden;
- **Bild- und Dateiverständnis**: akzeptiert QQ-Bilder und Anhänge; kann das Hauptmodell keine Bilder lesen, transkribiert ein Vision-Nebenmodell sie und die Anfrage wird erneut gesendet;
- **Vollständige Protokollierung**: Nachrichtenprotokolle halten „was gesagt wurde“ fest, Ausführungsprotokolle halten „was geschah, wie lange es dauerte und warum es fehlschlug“ fest, inklusive Filter, Seitenwechsel und JSON-/Markdown-Export;
- **Geschichtetes Gedächtnis und Gesprächsführung**: rollierende Zusammenfassungen + Schiebefenster + Kerngedächtnis + inkrementelle Injektion, zusammen mit Sitzungs-Timeout-Migration und einer Status-Leitplanke.

## Technologie-Stack

| Schicht | Wahl |
| --- | --- |
| Admin-Oberfläche | React + TypeScript + Vite + Tailwind CSS (Komponenten im shadcn-Stil) |
| Backend | Node.js + Fastify |
| Datenbank | SQLite (better-sqlite3) mit integrierten Migrationen |
| Cache | Speicher-Cache + Datei-Cache (kein Redis) |
| Zeitsteuerung | node-cron |
| QQ-Anbindung | Offizielle QQ-Bot-API v2 (HTTPS OpenAPI + WebSocket-Gateway) |
| KI-Modelle | Einheitliche LLM-Provider-Schnittstelle (OpenAI-kompatibel / Anthropic / Google / benutzerdefiniert / Mock), Anbieter-Presets und automatische Modellerkennung |
| Multimodal | Direkte Bildübertragung mit Rückfall auf ein Vision-Nebenmodell (erneuter Versuch nach Transkription, wenn das Hauptmodell Bilder ablehnt) |
| Betrieb | Admin-Oberfläche und API im selben Prozess auf einem Port; Docker / pm2 / systemd |

## Projektstruktur

```
PersonaBot/
├── package.json                 # pnpm-Workspace-Wurzel
├── pnpm-workspace.yaml
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── packages/
    ├── server/                  # Backend-Dienst
    │   └── src/
    │       ├── index.ts         # Prozesseinstieg (DB → Routen → Bot-Gateway → Cron)
    │       ├── app.ts           # Zusammenbau der Fastify-Anwendung
    │       ├── config.ts        # Umgebungsvariablen und Standardwerte
    │       ├── logger.ts        # Pino-Logger
    │       ├── logging.ts       # Doppelte Protokollierung (DB + Pino)
    │       ├── types.ts         # Domänentypen
    │       ├── auth/            # Passwort-Anmeldung + JWT
    │       ├── db/              # SQLite-Verbindung, Migrationen, Seed, Repositories
    │       │   ├── migrate.ts   # Idempotente Migrationen
    │       │   └── repos/       # bots / personas / models / providers / memories / system-logs ...
    │       ├── llm/             # LLM-Provider-Kapselung
    │       │   ├── openai.ts    # OpenAI-kompatibel (DeepSeek / benutzerdefiniert)
    │       │   ├── anthropic.ts # Claude
    │       │   ├── google.ts    # Gemini
    │       │   ├── mock.ts      # Lokale Entwicklung
    │       │   ├── discover.ts  # Automatische Modellerkennung beim Anbieter
    │       │   ├── vision*.ts   # Bildprüfung / Scan / Transkriptions-Rückfall
    │       │   └── factory.ts   # Provider aus Persona-/Bot-Konfiguration auflösen
    │       ├── qq/              # QQ-Bot-Anbindung
    │       │   ├── token.ts     # access_token abrufen und erneuern
    │       │   ├── client.ts    # OpenAPI-Nachrichtenversand / Gateway-URL
    │       │   ├── gateway.ts   # WebSocket-Gateway (Heartbeat / Reconnect / Events)
    │       │   └── manager.ts   # Verwaltung mehrerer Bot-Gateways
    │       ├── attachments/     # Verarbeitung von Bildern und Anhängen
    │       ├── moderation/      # Stichwortfilter (optional)
    │       ├── context/         # Schiebefenster / rollierende Zusammenfassung / Zustandsmaschine / Leitplanke
    │       ├── persona/prompt.ts# System-Prompt-Zusammenbau (stabiler Präfix + dynamischer Suffix)
    │       ├── skills/          # Skill-System + integrierter „Ex“-Skill + GitHub-Auto-Update
    │       ├── memory/          # Geschichtetes Gedächtnis: Zusammenfassung / Injektion / Profile / Echtzeitfakten / Zeitplan / Markdown-Dateien
    │       ├── painting/        # KI-Zeichnung nach Persona-Konfiguration
    │       ├── pipeline/        # Nachrichtenpipeline (Debounce-Zusammenführung / Abbruch / Wiederholung)
    │       ├── proactive/       # Proaktive Nachrichten
    │       ├── stats/           # Statistikaggregation
    │       ├── cron/            # node-cron-Aufgaben
    │       └── routes/          # REST-API
    └── admin/                   # Admin-Frontend
        └── src/
            ├── App.tsx          # Routing + Authentifizierung
            ├── assets/providers/# Integrierte Marken-SVGs
            ├── components/      # Layout, UI-Komponenten, ModelIcon
            ├── lib/             # API-Client / Typen / Auth
            └── pages/           # Dashboard / Bots / Personas / Models / Memories / Logs / Stats / Skills / Settings
```

## Schnellstart

```bash
# 1. Abhängigkeiten installieren (pnpm 9+ / Node 20+)
pnpm install

# 2. Umgebungsvariablen vorbereiten
cp .env.example .env
# ADMIN_PASSWORD / JWT_SECRET / ENCRYPTION_KEY ändern

# 3. Datenbank initialisieren (Migrationen laufen beim ersten Start automatisch)
pnpm --filter @personabot/server migrate

# 4. Entwicklungsmodus (Backend und Frontend parallel)
pnpm dev
# Backend http://localhost:3000
# Frontend http://localhost:5173 (/api-Reverse-Proxy bereits konfiguriert)

# 5. Produktions-Build und Start
pnpm build
pnpm start
# Admin-Oberfläche und API laufen unter http://localhost:3000
```

### Frontend-Code-Splitting

Die Admin-Seiten werden pro Route verzögert geladen (React.lazy + Suspense), und schwere Abhängigkeiten wie Diagramme werden in separate Chunks aufgeteilt. Das anfängliche Bundle sinkt von etwa 700 KB auf etwa 215 KB (etwa 69 KB gzip).

## Modellverwaltung und multimodale Eingabe

Die Modellseite zeigt eine Liste von **Anbieterkarten**. Anbietereinstellungen (Name / API-Base / Schlüssel) werden einmal gepflegt und auf alle zugehörigen Modelle angewendet. Jedes Modell speichert nur `modelId`, Anzeigename, Temperatur, maximale Tokens, Bildfähigkeit und Aktivierungsstatus.

- **Anbieter hinzufügen**: Zuerst einen leeren Anbieter ohne Modelle anlegen und später Modelle ergänzen; ein leer gelassener Schlüssel verwendet den gespeicherten Schlüssel weiter.
- **Automatische Erkennung**: Der eingegebene oder ausgewählte Anbietername wird mit Marken-Icons und Presets abgeglichen (OpenAI / Claude / Gemini / DeepSeek / Qwen / Zhipu / Moonshot / Volcano / Hunyuan und weitere). Die Icons sind integrierte offizielle Marken-SVGs.
- **Erkennung**: Ruft den `/models`-Endpunkt des Anbieters auf, ermittelt verfügbare Modelle und fügt sie gesammelt hinzu; einzelne Modelle lassen sich auch hinzufügen oder entfernen.
- **Verbindungstest**: Sendet eine minimale Anfrage an ein Modell und liefert Antwort und Tokenverbrauch zurück.
- **Bildfähigkeits-Scan**: Kombiniert Namensregeln mit optionalen echten Tests (persistierbar), um zu entscheiden, ob ein Modell Bildeingaben akzeptiert.

Multimodaler Ablauf: QQ-Bilder und -Dateien werden im Anhangmodul normalisiert; unterstützt das Hauptmodell Bilder, werden sie mit der Nachricht gesendet, andernfalls transkribiert ein Vision-Nebenmodell sie in Text und dieselbe Anfrage wird erneut gesendet. Größen- und Dimensionsgrenzen werden pro Anbieter angepasst.

## Protokolle

Die Protokollseite hat zwei Tabs mit unabhängigen Datenquellen:

| Typ | Aufzeichnung | Zweck |
| --- | --- | --- |
| Nachrichtenprotokoll (`message_logs`) | Gesprächstext, Richtung, Persona, Bot, Benutzer | Nachvollziehen, „was gesagt wurde“; zugleich Quelle für Statistiken und Gedächtniszusammenfassungen |
| Ausführungsprotokoll (`system_logs`) | Ebene, Kategorie, Phase, Dauer, strukturierte Details | Untersuchen, „was geschah, wie lange es dauerte und warum es fehlschlug“ |

Ausführungsprotokolle umfassen:

- Beginn und Ende der Antwortgenerierung (Persona, Anbieter, Modell, Historienlänge, Bildvorhandensein, Benutzereingabe);
- jede Modellanfrage und -antwort (`apiBase`, Temperatur, maximale Tokens, Nachrichtenanzahl, Zeichenanzahl, Dauer, usage);
- erneuten Versuch mit Vision-Rückfall nach Ablehnung der Bildeingabe;
- erneuten Versuch mit erzwungener Anweisung nach Auslösen der Status-Leitplanke;
- Verbindungstests, Modellerkennung und Bildscans;
- Fehlername, Meldung und Stacktrace bei fehlgeschlagener Generierung.

Beide Protokolle lassen sich nach Persona, Benutzer, Stichwort und Zeitraum filtern, seitenweise durchblättern und als JSON / Markdown exportieren. Nachrichtenprotokolle filtern zusätzlich nach Richtung, Ausführungsprotokolle nach Ebene und Kategorie. Der Benutzerfilter ist ein aus vorhandenen Protokollen aggregiertes Dropdown.

## Gedächtnis und Gespräche

- **Geschichtetes Gedächtnis**: Tages-, Drei-Tages-, Zweiwochen- und Monatsgedächtnis werden schichtweise verdichtet, zusammen mit Benutzerprofilen und atomaren Fakten.
- **Kerngedächtnis**: Vereinbarungen, Vorlieben und Fakten oberhalb einer Wichtigkeitsgrenze landen in einem geschützten Bereich und werden separat injiziert, sodass Dateibearbeitungen sie nie verlieren.
- **Abruf relevanter Erinnerungen**: Aus aktueller Eingabe und offenen Themen werden Ausschnitte gesucht, um eine vollständige Injektion zu vermeiden.
- **Inkrementelle Gedächtnisdateien**: Ist der Inhalt gegenüber dem vorherigen Zug unverändert, wird nur ein Platzhalter injiziert, was Tokens spart.
- **Echtzeitfakten**: Im Gespräch erkannte Vereinbarungen, Vorlieben und wichtige Informationen werden sofort ins Langzeitgedächtnis geschrieben und wirken ab dem nächsten Zug.
- **Gesprächsführung**: Ein Schiebefenster hält die letzten N Züge im Wortlaut, ältere werden rollierend zusammengefasst; bei Sitzungs-Timeout werden Langzeitpunkte ins Kerngedächtnis migriert, bevor eine neue Sitzung beginnt, damit das Gedächtnis nicht mit dem Cache verloren geht.
- **Status-Leitplanke**: Blockiert und wiederholt Antworten der Art „geh schlafen“, wenn beispielsweise Hausaufgaben noch offen sind.
- **Qualitätsprüfung ausgehender Antworten**: Leere Antworten, exakte Wiederholungen, fehlerhafte Zeichen, Steuerzeichen, geleakte System-Prompts oder Antworten mit Rollenpräfix werden einmal mit einer Korrekturanweisung wiederholt; scheitert auch der zweite Versuch, wird der Zug verworfen und weder im Gespräch noch im Nachrichtenstrom gespeichert.
- **Bereinigung fehlerhafter Antworten**: Die Seite „Gespräche“ zeigt den Verlauf nach Persona und Benutzer und erlaubt das Löschen einzelner Nachrichten, das Leeren ab einer Stelle oder das Zurücksetzen des Kontexts. Gelöschte Nachrichten werden in `message_logs` mit `invalid=1` markiert, sodass Tagesgedächtnis und Faktenextraktion sie überspringen; mit „bestehende Erinnerungen der betroffenen Tage ebenfalls löschen“ werden bereits erzeugte Tageserinnerungen und Fakten entfernt.

## Stichwortfilter (optional)

Aktivieren unter „Einstellungen → Stichwortfilter“. Die Wortliste wird durch Zeilenumbrüche, Kommas oder Semikolons getrennt. Bei einer Übereinstimmung in einer Benutzernachricht:

- **Blockieren**: Die Nachricht erreicht das Modell nicht, ein fester Hinweis wird zurückgegeben;
- **Durch \* ersetzen**: Treffer werden durch gleich viele Sternchen ersetzt und das Gespräch läuft weiter.

Standardmäßig deaktiviert. Es handelt sich um eine grundlegende Betriebsfilterung, nicht um Inhaltsmoderation.

## KI-Anhänge an Gedächtnisdateien (optional)

Die drei Gedächtnisdateien (`MEMORY.md` / `USER.md` / `persona-state.md`) werden nach manueller Bearbeitung standardmäßig nicht mehr automatisch überschrieben. Soll die KI weiter Gedächtnis ansammeln, ohne den eigenen Text zu zerstören:

1. Den globalen Schalter unter „Einstellungen → KI-Anhänge an Gedächtnisdateien“ aktivieren;
2. Auf der Gedächtnisseite eine Datei auswählen und für manuell bearbeitete Dateien „KI-Anhänge erlauben“ aktivieren.

Nach der Aktivierung hängt der tägliche Gedächtnislauf die neuen Inhalte des Tages an den Bereich `<!-- AI:APPEND -->` am Dateiende an:

- Der Originaltext (vor der Markierung) wird nie verändert;
- Angehängte Inhalte werden zeilenweise dedupliziert;
- Das Ausschalten des Dateischalters stoppt Anhänge, Original und bereits Angehängtes bleiben erhalten.

## Qualität und Tests

```bash
# Typprüfung (server + admin)
pnpm -r typecheck

# Unit-Tests (node:test; deckt Uhr, Textaufteilung, Status-Leitplanke, Stichwortfilter, Kontext und Gedächtnis, Anbieterkonfiguration, Ausführungsprotokolle, Gesprächsbereinigung, Antwortqualität und Ratenbegrenzung ab)
pnpm test

# Build
pnpm build
```

Die CI ist in `.github/workflows/ci.yml` definiert und führt bei jedem Push und Pull Request typecheck, test und build aus.

## Sicherheit

- **Schutz der Standard-Geheimnisse**: Bei `NODE_ENV=production` verweigert der Server den Start, wenn `ADMIN_PASSWORD` / `JWT_SECRET` / `ENCRYPTION_KEY` noch Standardwerte haben; in der Entwicklung wird nur gewarnt.
- **Admin-Passwort-Hash (optional)**: `ADMIN_PASSWORD_HASH` (`scrypt$salt$hash`) hat Vorrang vor dem Klartextpasswort und vergleicht in konstanter Zeit. Erzeugen mit:

```bash
node packages/server/dist/scripts/hash-password.js "your-password"
```

- **Verschlüsselung sensibler Felder**: QQ-ClientSecret, LLM-API-Schlüssel, Zeichnungsschlüssel und GitHub-Token werden mit AES-256-GCM gespeichert; die API meldet nur, ob etwas konfiguriert ist, und gibt nie Klartext zurück.
- **Authentifizierung**: Alle Endpunkte außer Anmeldung und Health-Check benötigen eine Sitzung, entweder per `Authorization: Bearer` (API) oder httpOnly-Cookie (Browser-Neuladen); Cookies nutzen in der Produktion `Secure`.
- **Anmelde-Ratenbegrenzung**: höchstens 10 Anmeldeversuche pro IP in 15 Minuten.
- **CORS standardmäßig deaktiviert**: Same-Origin-Betrieb braucht kein CORS; für Cross-Origin die erlaubten Ursprünge explizit in `CORS_ORIGINS` angeben, damit Anmeldedaten nie an beliebige Ursprünge zurückgespiegelt werden.
- **Blockierung von Server-Agent-Befehlen**: Eine integrierte Sperrliste katastrophaler Befehle (Formatieren, direkte Blockgeräte-Schreibzugriffe, Herunterfahren, rekursives Löschen der Wurzel, Leeren der Firewall und Ähnliches) wird auch bei aktiviertem Agent abgelehnt.
- **Netzwerk-Timeouts**: Alle externen Anfragen (QQ / LLM / Zeichnung / GitHub / Anhang-Download) haben Timeouts, um hängende Verbindungen und Speicherlecks zu vermeiden.
- **Protokoll-Maskierung**: Der Pino-Logger maskiert `clientSecret` / `apiKey` / `password` und ähnliche Felder; Ausführungsprotokolle enthalten Anfrage-Metadaten, Dauern und Fehlerursachen und können zur Fehlersuche Gesprächsausschnitte enthalten.

## Sicherungen

SQLite erzeugt mit `VACUUM INTO` konsistente Online-Snapshots ohne Ausfallzeit. Die 10 neuesten werden in `data/backups/` aufbewahrt:

```bash
# Sichern und die 10 neuesten Snapshots behalten
pnpm --filter @personabot/server backup

# Eigene Aufbewahrungszahl
node packages/server/dist/scripts/backup.js 20
```

## Datenmodell

| Tabelle | Beschreibung |
| --- | --- |
| `bots` | QQ-Bot-Instanzen; ClientSecret verschlüsselt, Persona gebunden |
| `personas` | Persona-Definitionspakete (Prompt / Eigenschaften / Skills / Befehle / Zeichnung / Modellkonfiguration) |
| `models` | LLM-Modellkonfiguration (Provider / API-Schlüssel / Base / Temperatur / maximale Tokens / Bild / Aktiv) |
| `providers` | Konfiguration pro Anbieter (Name / Base / verschlüsselter Schlüssel); leere Anbieter erlaubt |
| `memories` | Geschichtetes Gedächtnis (daily / three_day / biweekly / monthly) |
| `conversations` | Gesprächsverlauf (im normalen Chat nur Anhängen, um den Cache-Präfix wiederzuverwenden; im Admin gezielt bereinigbar) |
| `user_profiles` | Benutzergewohnheitsprofile |
| `stats` | Tagesstatistiken (Tokens / Cache-Treffer / Bilder / Nachrichtenanzahl) |
| `message_logs` | Nachrichtenstrom (Quelle für Statistiken und Gedächtniszusammenfassungen; `invalid=1` markiert aus dem Gespräch entfernte Einträge) |
| `system_logs` | Ausführungsprotokoll (Ebene / Kategorie / Phase / Dauer / strukturierte Details, indiziert) |
| `token_usage` | Tokenverbrauch pro Aufruf |
| `painting_logs` | Zeichnungsverlauf und Grundlage der Tageskontingente |
| `skills` | Skill-Plugins (integriert / benutzerdefiniert / GitHub-Sync) |
| `settings` | Schlüssel-Wert-Systemeinstellungen |

Die Migrationen liegen in `packages/server/src/db/migrate.ts`. Sie laufen in id-Reihenfolge und werden in `_migrations` protokolliert, sind also gefahrlos wiederholbar.

## REST-API-Überblick

| Gruppe | Endpunkte |
| --- | --- |
| Authentifizierung | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Bots | `GET/POST /api/bots`, `PUT/DELETE /api/bots/:id`, `POST /api/bots/:id/toggle|restart`, `GET /api/bots/status` |
| Personas | `GET/POST /api/personas`, `PUT/DELETE /api/personas/:id`, `POST /api/personas/:id/simulate` |
| Modelle | `GET/POST /api/models`, `POST /api/models/batch`, `PUT/DELETE /api/models/:id`, `POST /api/models/:id/test|discover`, `POST /api/models/discover`, `POST /api/models/vision-scan` |
| Anbieter | `GET /api/models/providers`, `POST/PUT/DELETE /api/models/providers`, `POST /api/models/providers/discover` |
| Gedächtnis | `GET /api/memories`, `GET /api/memories/users`, `POST /api/memories/trigger|import`, `PUT/DELETE /api/memories/:id`, `GET/PUT /api/memories/file(s)`, `POST /api/memories/file/reset`, `PUT /api/memories/file/append` |
| Gespräche | `GET /api/conversations`, `GET /api/conversations/detail`, `DELETE /api/conversations/message|from`, `POST /api/conversations/reset` |
| Protokolle | `GET /api/logs`, `GET /api/logs/users`, `GET /api/logs/export`, `GET /api/logs/events`, `GET /api/logs/events/export` |
| Statistiken | `GET /api/stats/dashboard|trends|persona/:id|messages` |
| Skills | `GET/POST /api/skills`, `PUT/DELETE /api/skills/:id`, `POST /api/skills/sync` |
| Einstellungen | `GET/PUT /api/settings`, `GET /api/system/info` |
| Betrieb | `POST /api/system/proactive/run|daily/run|tokens/refresh|bots/reload` |

Alle Endpunkte außer `login` und `health` benötigen eine Sitzung (`Authorization: Bearer <token>` oder Cookie).

## Geplante Aufgaben

| Aufgabe | Zeit | Beschreibung |
| --- | --- | --- |
| Tagesgedächtnis | Täglich 00:00 | Bereitet die Chats des Vortags zu einem klaren Tagesgedächtnis auf |
| Statistik-Reset | Täglich 00:05 | Die Statistiken des neuen Tages starten bei null |
| Drei-Tages-Gedächtnis | Alle 3 Tage 01:00 | Fasst die Tagesgedächtnisse der letzten 3 Tage zusammen |
| Verdichtetes Gedächtnis | Alle 2 Wochen 02:00 | Komprimiert zwei Wochen Gedächtnis |
| Monatsgedächtnis | 1. jedes Monats 03:00 | Fasst die verdichteten Zwei-Wochen-Gedächtnisse zusammen |
| Token-Erneuerung | Täglich 04:00 | Erneuert bald ablaufende access_tokens |
| Proaktive Nachrichten | Alle 30 Minuten | Werden nach aktiven Zeiten des Benutzers und Persona-Eigenschaften ausgelöst |
| Tägliche Begrüßung | Alle 15 Minuten | Wird gesendet, wenn das aktive Zeitfenster passt und an dem Tag noch nichts gesendet wurde |
| Speicherbereinigung | Täglich 04:30 | Leert die In-Memory-Zähler proaktiver Nachrichten |
| Bot-Gateway-Sync | Alle 5 Minuten | Synchronisiert Start-/Stoppstatus der Bots aus der Datenbank |
| Skill-Auto-Update | Konfigurierbar | Lädt die neuesten Skills aus dem GitHub-Repository |

## Optimierung der Cache-Trefferquote

1. Stabiler System-Prompt-Präfix: Die Persona-Definition steht vorn und bleibt bytegenau identisch; dynamische Inhalte wie Zeit und Gedächtnis stehen am Ende.
2. Kontext-Präfix pro Gespräch wiederverwenden: Derselbe Benutzer und dieselbe Persona teilen immer ein Gespräch.
3. Minimales Toolset und reines Anhängen: Der Verlauf wird nur angehängt, nie umgeschrieben oder für frühere Züge neu zusammengefasst.
4. Automatische Kompression nutzt den Präfix weiter: Zusammenfassungen werden am Ende der Nachrichtenliste angehängt.
5. Cache-Metriken: Die Statistikseite zeigt `cacheRead / (input + cacheRead + cacheWrite)`.

## Betrieb

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

Die Datenbank liegt in `data/`, die Protokolle in `logs/`, und Geheimnisse werden über `.env` verwaltet.

## Lokaler Test ohne echte Zugangsdaten

1. Unter „Modelle“ eine Anbieterkarte anlegen (`provider = mock`, oder leer lassen und keine Modelle konfigurieren, dann wird automatisch auf Mock zurückgefallen), danach bei Bedarf Modelle ergänzen.
2. Unter „Personas“ eine Persona anlegen, den Prompt bearbeiten und auf „Simulieren“ klicken, um lokal zu chatten.
3. Unter „Gedächtnis“ die Erzeugung von Tages-/Drei-Tages-/Monatsgedächtnis manuell auslösen, um die geschichtete Injektion zu prüfen.
