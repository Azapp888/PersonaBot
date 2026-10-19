# PersonaBot

[简体中文](README.md) | [English](README.en.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português (Brasil)](README.pt-BR.md)

Système léger de gestion de bots QQ de jeu de rôle. Chaque bot QQ est lié à une persona et s'exprime toujours avec cette identité. Les prompts, les plugins de compétences, le jeu de commandes et la configuration de dessin se règlent depuis l'interface d'administration. Le système de mémoire utilise une synthèse par couches avec conscience temporelle, et plusieurs bots peuvent fonctionner indépendamment.

Cette version apporte également :

- **Gestion des modèles par fournisseur** : configurer nom / Base URL / clé sur chaque carte de fournisseur, découvrir les modèles disponibles en un clic, analyser les capacités multimodales et utiliser de véritables icônes de marque ;
- **Compréhension des images et des fichiers** : accepte les images et pièces jointes QQ ; si le modèle principal ne lit pas les images, un modèle secondaire de vision les transcrit et la requête est relancée ;
- **Journalisation complète** : les journaux de messages retiennent « ce qui a été dit », les journaux d'exécution retiennent « ce qui a été fait, combien de temps cela a pris et pourquoi cela a échoué », avec filtres, pagination et export JSON / Markdown ;
- **Mémoire par couches et gouvernance des conversations** : synthèses glissantes + fenêtre glissante + mémoire centrale + injection incrémentale, avec migration à l'expiration de session et garde-fou d'état.

## Pile technique

| Couche | Choix |
| --- | --- |
| Interface d'administration | React + TypeScript + Vite + Tailwind CSS (composants style shadcn) |
| Backend | Node.js + Fastify |
| Base de données | SQLite (better-sqlite3) avec migrations intégrées |
| Cache | Cache mémoire + cache fichier (sans Redis) |
| Tâches planifiées | node-cron |
| Intégration QQ | API officielle des bots QQ v2 (HTTPS OpenAPI + passerelle WebSocket) |
| Modèles d'IA | Interface unifiée LLM Provider (compatible OpenAI / Anthropic / Google / personnalisé / Mock), préréglages de fournisseurs et découverte automatique des modèles |
| Multimodal | Envoi direct des images avec repli sur un modèle secondaire de vision (nouvelle tentative après transcription si le modèle principal refuse les images) |
| Déploiement | Interface et API dans le même processus sur un seul port ; Docker / pm2 / systemd |

## Arborescence

```
PersonaBot/
├── package.json                 # Racine du workspace pnpm
├── pnpm-workspace.yaml
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── packages/
    ├── server/                  # Service backend
    │   └── src/
    │       ├── index.ts         # Entrée du processus (DB → routes → passerelle des bots → cron)
    │       ├── app.ts           # Assemblage de l'application Fastify
    │       ├── config.ts        # Variables d'environnement et valeurs par défaut
    │       ├── logger.ts        # Journalisation Pino
    │       ├── logging.ts       # Double écriture des journaux d'exécution (DB + Pino)
    │       ├── types.ts         # Types du domaine
    │       ├── auth/            # Connexion par mot de passe + JWT
    │       ├── db/              # Connexion SQLite, migrations, seed, dépôts
    │       │   ├── migrate.ts   # Migrations idempotentes
    │       │   └── repos/       # bots / personas / models / providers / memories / system-logs ...
    │       ├── llm/             # Encapsulation des LLM Provider
    │       │   ├── openai.ts    # Compatible OpenAI (DeepSeek / personnalisé)
    │       │   ├── anthropic.ts # Claude
    │       │   ├── google.ts    # Gemini
    │       │   ├── mock.ts      # Développement local
    │       │   ├── discover.ts  # Découverte des modèles du fournisseur
    │       │   ├── vision*.ts   # Détection / analyse / repli par transcription
    │       │   └── factory.ts   # Résolution du Provider depuis la persona / le bot
    │       ├── qq/              # Intégration des bots QQ
    │       │   ├── token.ts     # Obtention et renouvellement de l'access_token
    │       │   ├── client.ts    # Envoi de messages OpenAPI / URL de passerelle
    │       │   ├── gateway.ts   # Passerelle WebSocket (battement de cœur / reconnexion / événements)
    │       │   └── manager.ts   # Gestion des passerelles de plusieurs bots
    │       ├── attachments/     # Traitement des images et pièces jointes
    │       ├── moderation/      # Filtrage par mots-clés (facultatif)
    │       ├── context/         # Fenêtre glissante / synthèse glissante / machine d'état / garde-fou
    │       ├── persona/prompt.ts# Assemblage du System Prompt (préfixe stable + suffixe dynamique)
    │       ├── skills/          # Système de compétences + compétence intégrée « ex » + mise à jour GitHub
    │       ├── memory/          # Mémoire par couches : synthèse / injection / profils / faits en temps réel / agenda / fichiers Markdown
    │       ├── painting/        # Dessin par IA selon la persona
    │       ├── pipeline/        # Pipeline de messages (regroupement par debounce / interruption / nouvelle tentative)
    │       ├── proactive/       # Messages proactifs
    │       ├── stats/           # Agrégation des statistiques
    │       ├── cron/            # Tâches node-cron
    │       └── routes/          # API REST
    └── admin/                   # Frontend de l'interface
        └── src/
            ├── App.tsx          # Routage + authentification
            ├── assets/providers/# Icônes SVG de marques intégrées
            ├── components/      # Layout, composants d'UI, ModelIcon
            ├── lib/             # Client API / types / authentification
            └── pages/           # Dashboard / Bots / Personas / Models / Memories / Logs / Stats / Skills / Settings
```

## Démarrage rapide

```bash
# 1. Installer les dépendances (pnpm 9+ / Node 20+)
pnpm install

# 2. Préparer les variables d'environnement
cp .env.example .env
# Modifier ADMIN_PASSWORD / JWT_SECRET / ENCRYPTION_KEY

# 3. Initialiser la base de données (migrations automatiques au premier démarrage)
pnpm --filter @personabot/server migrate

# 4. Mode développement (backend et frontend en parallèle)
pnpm dev
# Backend http://localhost:3000
# Frontend http://localhost:5173 (proxy inverse /api déjà configuré)

# 5. Build et démarrage en production
pnpm build
pnpm start
# L'interface et l'API sont servies sur http://localhost:3000
```

### Découpage du code frontend

Les pages de l'interface sont chargées à la demande par route (React.lazy + Suspense) et les dépendances lourdes, comme les graphiques, sont séparées. Le bundle initial passe d'environ 700 Ko à environ 215 Ko (environ 69 Ko gzip).

## Gestion des modèles et entrée multimodale

La page Modèles affiche une liste de **cartes de fournisseur**. La configuration du fournisseur (nom / API Base / clé) est maintenue une seule fois et s'applique à tous ses modèles. Chaque modèle ne stocke que `modelId`, le nom affiché, la température, les tokens max, l'indicateur de vision et l'état d'activation.

- **Ajouter un fournisseur** : créer d'abord un fournisseur vide (sans modèle), puis ajouter des modèles ; une clé laissée vide réutilise la clé enregistrée.
- **Reconnaissance automatique** : le nom de fournisseur saisi ou choisi est comparé aux icônes et préréglages de marque (OpenAI / Claude / Gemini / DeepSeek / Qwen / Zhipu / Moonshot / Volcano / Hunyuan, etc.). Les icônes sont des SVG officiels intégrés.
- **Découverte** : appelle l'endpoint `/models` du fournisseur pour découvrir les modèles disponibles et les ajouter en lot ; ajout et suppression individuels également possibles.
- **Test de connectivité** : envoie une requête minimale à un modèle et renvoie la réponse et l'usage des tokens.
- **Analyse des capacités de vision** : combine des règles de nommage et des tests réels facultatifs (persistables) pour déterminer si un modèle accepte les images.

Flux multimodal : les images et fichiers QQ sont normalisés par le module de pièces jointes ; si le modèle principal gère la vision, ils sont envoyés avec le message, sinon un modèle secondaire de vision les transcrit en texte et la même requête est relancée. Les limites de taille et de dimensions sont adaptées par fournisseur.

## Journaux

La page Journaux comporte deux onglets dont les sources de données sont indépendantes :

| Type | Contenu | Usage |
| --- | --- | --- |
| Journal des messages (`message_logs`) | Texte de la conversation, sens, persona, bot, utilisateur | Revoir « ce qui a été dit » ; sert aussi de source aux statistiques et aux synthèses de mémoire |
| Journal d'exécution (`system_logs`) | Niveau, catégorie, étape, durée, détail structuré | Enquêter sur « ce qui a été fait, combien de temps cela a pris et pourquoi cela a échoué » |

Les journaux d'exécution couvrent :

- Le début et la fin de la génération de réponse (persona, fournisseur, modèle, longueur de l'historique, présence d'images, saisie de l'utilisateur) ;
- Chaque requête et réponse au modèle (`apiBase`, température, tokens max, nombre de messages, nombre de caractères, durée, usage) ;
- La nouvelle tentative avec repli de vision après un refus des images par le fournisseur ;
- La nouvelle tentative avec instruction forcée après déclenchement du garde-fou d'état ;
- Les tests de connectivité, la découverte de modèles et les analyses de vision ;
- Le nom, le message et la pile d'erreur en cas d'échec de génération.

Les deux journaux se filtrent par persona, utilisateur, mot-clé et plage de dates, avec pagination et export JSON / Markdown. Les messages se filtrent aussi par sens, les journaux d'exécution par niveau et catégorie. Le filtre utilisateur est une liste déroulante agrégée à partir des journaux existants.

## Mémoire et conversations

- **Mémoire par couches** : les mémoires journalière / sur trois jours / bimensuelle / mensuelle sont condensées couche par couche, avec les profils utilisateur et les faits atomiques.
- **Mémoire centrale** : les accords, préférences et faits dépassant un seuil d'importance entrent dans une zone protégée et sont injectés séparément, donc une édition de fichier ne les perd jamais.
- **Récupération de mémoire pertinente** : des extraits sont recherchés à partir de la saisie courante et des sujets en attente pour éviter une injection complète.
- **Fichiers de mémoire incrémentaux** : si le contenu est identique au tour précédent, seul un espace réservé est injecté, ce qui économise des tokens.
- **Faits en temps réel** : les accords, préférences et informations importantes détectés pendant la conversation sont écrits immédiatement en mémoire long terme et prennent effet au tour suivant.
- **Gouvernance des conversations** : une fenêtre glissante conserve les N derniers tours tels quels, les plus anciens étant résumés ; à l'expiration d'une session, les points long terme migrent vers la mémoire centrale avant l'ouverture d'une nouvelle session, afin que la mémoire ne disparaisse pas avec le cache.
- **Garde-fou d'état** : intercepte et relance les réponses du type « va te coucher » lorsque, par exemple, les devoirs ne sont pas terminés.

## Filtrage par mots-clés (facultatif)

À activer dans « Paramètres → Filtrage par mots-clés ». La liste est séparée par retours à la ligne, virgules ou points-virgules. Lorsqu'un message utilisateur correspond :

- **Bloquer** : le message n'atteint pas le modèle et un avis fixe est renvoyé ;
- **Remplacer par \*** : les mots correspondants sont remplacés par autant d'astérisques et la conversation continue.

Désactivé par défaut. Il s'agit d'un filtrage opérationnel de base, non d'une modération de contenu.

## Ajout par l'IA aux fichiers de mémoire (facultatif)

Les trois fichiers de mémoire (`MEMORY.md` / `USER.md` / `persona-state.md`) ne sont plus écrasés automatiquement dès qu'ils sont édités à la main. Si vous voulez que l'IA continue d'accumuler de la mémoire sans détruire votre texte :

1. Activez l'interrupteur global dans « Paramètres → Ajout IA aux fichiers de mémoire » ;
2. Sur la page Mémoire, sélectionnez un fichier et activez « Autoriser l'ajout IA » pour ceux que vous avez édités manuellement.

Une fois activé, la tâche mémoire quotidienne ajoute le contenu du jour dans la section `<!-- AI:APPEND -->` en fin de fichier :

- Votre texte d'origine (avant le marqueur) n'est jamais modifié ;
- Le contenu ajouté est dédupliqué ligne par ligne ;
- Désactiver l'interrupteur du fichier arrête les ajouts tout en conservant l'original et le contenu déjà ajouté.

## Qualité et tests

```bash
# Vérification des types (server + admin)
pnpm -r typecheck

# Tests unitaires (node:test ; couvre horloge, découpage de texte, garde-fou d'état, filtrage par mots-clés, contexte et mémoire, configuration des fournisseurs, journaux d'exécution et limitation de débit)
pnpm test

# Build
pnpm build
```

La CI est définie dans `.github/workflows/ci.yml` et exécute typecheck, test et build à chaque push et pull request.

## Sécurité

- **Protection des secrets par défaut** : avec `NODE_ENV=production`, le serveur refuse de démarrer si `ADMIN_PASSWORD` / `JWT_SECRET` / `ENCRYPTION_KEY` gardent leurs valeurs par défaut ; en développement, il avertit seulement.
- **Hachage du mot de passe administrateur (facultatif)** : définir `ADMIN_PASSWORD_HASH` (`scrypt$salt$hash`) prend le pas sur le mot de passe en clair et compare en temps constant. Génération :

```bash
node packages/server/dist/scripts/hash-password.js "votre-mot-de-passe"
```

- **Chiffrement des champs sensibles** : le ClientSecret QQ, les clés LLM, les clés de dessin et les tokens GitHub sont stockés en AES-256-GCM ; l'API indique seulement s'ils sont configurés et ne renvoie jamais le texte clair.
- **Authentification** : tous les endpoints sauf la connexion et le contrôle de santé exigent une session, via `Authorization: Bearer` (API) ou un cookie httpOnly (rechargement du navigateur) ; les cookies utilisent `Secure` en production.
- **Limitation des connexions** : au maximum 10 tentatives par IP sur 15 minutes.
- **CORS désactivé par défaut** : un déploiement same-origin n'a pas besoin de CORS ; pour du cross-origin, indiquez les origines autorisées dans `CORS_ORIGINS`, afin que les identifiants ne soient jamais réfléchis vers des origines arbitraires.
- **Blocage des commandes de l'agent serveur** : une liste noire intégrée de commandes catastrophiques (formatage, écriture directe sur périphérique bloc, arrêt, suppression récursive de la racine, vidage du pare-feu, etc.) est refusée même lorsque l'agent est activé.
- **Délais réseau** : toutes les requêtes externes (QQ / LLM / dessin / GitHub / téléchargement de pièces jointes) ont un délai pour éviter les connexions bloquées et les fuites de mémoire.
- **Masquage des journaux** : le logger Pino masque `clientSecret` / `apiKey` / `password` et champs similaires ; les journaux d'exécution conservent les métadonnées de requête, les durées et les causes d'erreur, et peuvent inclure des extraits de conversation pour faciliter le diagnostic.

## Sauvegardes

SQLite utilise `VACUUM INTO` pour produire des instantanés en ligne cohérents sans arrêt de service. Les 10 plus récents sont conservés dans `data/backups/` :

```bash
# Sauvegarder en conservant les 10 instantanés les plus récents
pnpm --filter @personabot/server backup

# Nombre de sauvegardes personnalisé
node packages/server/dist/scripts/backup.js 20
```

## Modèle de données

| Table | Description |
| --- | --- |
| `bots` | Instances de bots QQ ; le ClientSecret est chiffré et une persona est liée |
| `personas` | Paquets de définition de persona (prompt / traits / compétences / commandes / dessin / configuration de modèle) |
| `models` | Configuration des modèles LLM (fournisseur / clé API / base / température / tokens max / vision / actif) |
| `providers` | Configuration par fournisseur (nom / base / clé chiffrée) ; les fournisseurs vides sont autorisés |
| `memories` | Mémoires par couches (daily / three_day / biweekly / monthly) |
| `conversations` | Historique des conversations (ajout seul pour réutiliser le préfixe en cache) |
| `user_profiles` | Profils d'habitudes utilisateur |
| `stats` | Statistiques quotidiennes (tokens / succès de cache / images / nombre de messages) |
| `message_logs` | Flux de messages (source des statistiques et des synthèses de mémoire) |
| `system_logs` | Journaux d'exécution (niveau / catégorie / étape / durée / détail structuré, indexés) |
| `token_usage` | Détail de l'usage des tokens par appel |
| `painting_logs` | Historique de dessin et base des quotas quotidiens |
| `skills` | Plugins de compétences (intégrés / personnalisés / synchronisés avec GitHub) |
| `settings` | Paramètres système clé-valeur |

Les migrations se trouvent dans `packages/server/src/db/migrate.ts`. Elles s'exécutent dans l'ordre des id et sont enregistrées dans `_migrations`, donc rejouables sans risque.

## Aperçu de l'API REST

| Groupe | Endpoints |
| --- | --- |
| Authentification | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Bots | `GET/POST /api/bots`, `PUT/DELETE /api/bots/:id`, `POST /api/bots/:id/toggle|restart`, `GET /api/bots/status` |
| Personas | `GET/POST /api/personas`, `PUT/DELETE /api/personas/:id`, `POST /api/personas/:id/simulate` |
| Modèles | `GET/POST /api/models`, `POST /api/models/batch`, `PUT/DELETE /api/models/:id`, `POST /api/models/:id/test|discover`, `POST /api/models/discover`, `POST /api/models/vision-scan` |
| Fournisseurs | `GET /api/models/providers`, `POST/PUT/DELETE /api/models/providers`, `POST /api/models/providers/discover` |
| Mémoire | `GET /api/memories`, `GET /api/memories/users`, `POST /api/memories/trigger|import`, `PUT/DELETE /api/memories/:id`, `GET/PUT /api/memories/file(s)`, `POST /api/memories/file/reset`, `PUT /api/memories/file/append` |
| Journaux | `GET /api/logs`, `GET /api/logs/users`, `GET /api/logs/export`, `GET /api/logs/events`, `GET /api/logs/events/export` |
| Statistiques | `GET /api/stats/dashboard|trends|persona/:id|messages` |
| Compétences | `GET/POST /api/skills`, `PUT/DELETE /api/skills/:id`, `POST /api/skills/sync` |
| Paramètres | `GET/PUT /api/settings`, `GET /api/system/info` |
| Opérations | `POST /api/system/proactive/run|daily/run|tokens/refresh|bots/reload` |

Tous les endpoints sauf `login` et `health` exigent une session (`Authorization: Bearer <token>` ou cookie).

## Tâches planifiées

| Tâche | Horaire | Description |
| --- | --- | --- |
| Mémoire journalière | Chaque jour à 00:00 | Organise les conversations de la veille en une mémoire journalière claire |
| Réinitialisation des statistiques | Chaque jour à 00:05 | Les statistiques du nouveau jour repartent de zéro |
| Mémoire de trois jours | Tous les 3 jours à 01:00 | Synthétise les mémoires journalières des 3 derniers jours |
| Mémoire condensée | Toutes les 2 semaines à 02:00 | Compresse deux semaines de mémoire |
| Mémoire mensuelle | Le 1er de chaque mois à 03:00 | Synthétise les mémoires condensées de deux semaines |
| Renouvellement des tokens | Chaque jour à 04:00 | Renouvelle les access_token proches de l'expiration |
| Messages proactifs | Toutes les 30 minutes | Lancés selon les plages actives de l'utilisateur et les traits de la persona |
| Salutation quotidienne | Toutes les 15 minutes | Envoyée lorsque la plage active de l'utilisateur correspond et rien n'a été envoyé ce jour |
| Nettoyage mémoire | Chaque jour à 04:30 | Vide les compteurs en mémoire des messages proactifs |
| Synchronisation des passerelles | Toutes les 5 minutes | Synchronise l'état démarré/arrêté des bots depuis la base |
| Mise à jour des compétences | Configurable | Récupère les dernières compétences depuis le dépôt GitHub |

## Optimisation du taux de succès du cache

1. Préfixe stable du System Prompt : la définition de la persona vient en premier et reste identique octet par octet ; le contenu dynamique, comme l'heure et la mémoire, vient à la fin.
2. Réutilisation du préfixe de contexte par conversation : le même utilisateur et la même persona partagent toujours une conversation.
3. Ensemble d'outils minimal et historique en ajout seul : l'historique n'est jamais réécrit ni re-résumé pour les tours précédents.
4. La compression automatique réutilise le préfixe : les synthèses sont ajoutées en fin de liste de messages.
5. Suivi des métriques de cache : la page Statistiques affiche `cacheRead / (input + cacheRead + cacheWrite)`.

## Déploiement

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

La base de données se trouve dans `data/`, les journaux dans `logs/`, et les secrets sont gérés via `.env`.

## Test local sans identifiants réels

1. Créez une carte de fournisseur dans « Modèles » (`provider = mock`, ou laissez vide sans configurer de modèle pour utiliser Mock automatiquement), puis ajoutez des modèles selon vos besoins.
2. Créez une persona dans « Personas », modifiez le prompt et cliquez sur « Simuler » pour dialoguer localement.
3. Lancez manuellement la génération des mémoires journalière / de trois jours / mensuelle dans « Mémoire » pour vérifier l'injection par couches.
