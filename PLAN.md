# Nacre — Plan complet

> Émulateur de terminal de bureau, gratuit, 100 % personnalisable, avec une intégration profonde de Claude / Claude Code.

**Comment lire ce document**

1. **Section 4, Catalogue des fonctionnalités** : chaque fonctionnalité a une case cochée `[x]` = « on la fait ». **Décoche (`[ ]`) ou supprime celles qui ne t'intéressent pas.** Chaque ligne a aussi une priorité :
   - `V1` = indispensable pour la première version utilisable
   - `V2` = gros plus, juste après
   - `V3` = avancé / expérimental / fun
2. **Section 5, Roadmap** : l'ordre de construction, phase par phase, avec des tâches à cocher au fur et à mesure du développement.
3. **Section 6, Instructions pour l'agent** : les règles que Claude suit quand il avance en autonomie sur ce plan.

---

## 0. Exigences de qualité (non négociables)

Elles s'appliquent à chaque écran, chaque texte, chaque ligne de code.

**Identité et design**
- Une vraie identité, pas un look « généré par IA ». Style **épuré, précis, sobre**.
- Le terminal est le héros : l'interface autour est minimale et s'efface.
- Une seule couleur d'accent, utilisée avec parcimonie. Pas de dégradés violets/bleus génériques, pas de glassmorphism partout, pas d'ombres lourdes, pas d'emojis dans l'interface.
- Un seul jeu d'icônes, trait fin, cohérent.
- Grille d'espacement de 4 px, coins arrondis discrets, alignements nets.
- Typographie soignée : une police UI et une police mono, pas plus.
- Animations courtes (< 150 ms) et seulement quand elles aident à comprendre.
- L'identité est définie une fois (`docs/design.md` : palette, typo, icônes, un élément signature), puis appliquée partout.

**Texte**
- Concis. Libellés de 1 à 3 mots.
- Pas de description sous une option dont le nom suffit.
- Pas de redites, pas de surexplication, pas de ton marketing, pas d'onboarding bavard.
- Infobulle seulement si l'action n'est pas évidente.
- Message d'erreur = ce qui s'est passé + comment corriger, en une ligne.
- Même règle pour le code : un commentaire seulement si le code ne parle pas de lui-même ; docs courtes.

**Personnalisation**
- **Tous les raccourcis sont modifiables** dans les réglages. Ceux cités dans ce document ne sont que des valeurs par défaut.
- Tout ce qui est visible est configurable. Les valeurs par défaut doivent être bonnes sans rien toucher.

**Checklist avant chaque commit d'interface** : rien de superflu ? Rien de générique ? Cohérent avec `docs/design.md` ? Raccourci modifiable ?

---

## 1. Vision

- **Multi-sessions** : onglets, panneaux divisés (splits), plusieurs fenêtres, workspaces.
- **Personnalisation totale** : thèmes, polices, barre d'état, raccourcis, plugins, tout est configurable.
- **Pensé pour Claude** : on voit d'un coup d'œil le contexte utilisé, le modèle, le coût, l'état de chaque session Claude Code ; on est notifié quand Claude attend une réponse.
- **Gratuit, local, à nous** : pas de compte, pas de télémétrie, pas d'abonnement.

---

## 2. Stack technique

| Couche | Choix | Pourquoi |
|---|---|---|
| Application de bureau | **Tauri 2** (Rust) | Léger (~10 Mo contre ~150 Mo pour Electron), natif, multi-plateforme |
| Pseudo-terminal (PTY) | **portable-pty** (crate Rust, celle de WezTerm) | Fiable, gère macOS/Linux/Windows |
| Moteur de terminal | **xterm.js** + addons (`webgl`, `fit`, `search`, `web-links`, `unicode11`, `image`, `serialize`, `clipboard`, `ligatures`) | Le moteur de VS Code, éprouvé, rapide en WebGL |
| Interface | **TypeScript + React + Vite** | Écosystème riche, interface très facile à styliser |
| État de l'UI | **Zustand** | Simple, léger |
| Styles | **CSS variables** (thèmes) + CSS modules | Changement de thème à chaud, sans framework lourd |
| Config | **TOML** dans `~/.config/nacre/config.toml` + interface de réglages | Lisible, éditable à la main, rechargé à chaud |
| Surveillance de fichiers | **notify** (crate Rust) | Rechargement de la config, suivi des transcripts Claude |
| Infos système | **sysinfo** + `libc` (`tcgetpgrp`) | Process au premier plan, cwd, CPU/RAM |
| Communication externe | **socket Unix local** + petite CLI `nacre` | Les hooks Claude Code et les scripts peuvent piloter l'app |
| Tests | `cargo test` (Rust), **Vitest** (TS), **Playwright** via `tauri-driver` (e2e, plus tard) | |
| Packaging | `tauri build` → `.dmg` / `.app`, updater Tauri | |

Plateforme cible : **macOS d'abord**, en gardant le code compatible Linux/Windows (pas d'API macOS-only sans alternative).

---

## 3. Architecture

```
nacre/
├── src-tauri/                 # Backend Rust
│   ├── src/
│   │   ├── main.rs
│   │   ├── pty/               # création, lecture/écriture, resize, kill des PTY
│   │   ├── session/           # registre des panes ↔ PTY ↔ process
│   │   ├── process/           # process au premier plan, cwd, nom (détection de "claude")
│   │   ├── claude/            # lecture des transcripts JSONL, calcul du contexte/coût, état
│   │   ├── ipc_socket/        # socket Unix local (hooks Claude, CLI `nacre`)
│   │   ├── config/            # chargement TOML, validation, hot reload
│   │   ├── shell_integration/ # scripts zsh/bash/fish injectés (OSC 7 / 133)
│   │   ├── persistence/       # sauvegarde/restauration de session
│   │   └── system/            # CPU, RAM, batterie, git...
│   └── tauri.conf.json
├── src/                       # Frontend TS/React
│   ├── app/                   # layout racine, fenêtres
│   ├── terminal/              # wrapper xterm.js, addons, rendu
│   ├── layout/                # arbre de splits, onglets, drag & drop
│   ├── statusbar/             # moteur de segments + segments intégrés
│   ├── claude/                # widgets Claude, dashboard, panneau IA
│   ├── palette/               # palette de commandes
│   ├── settings/              # interface des réglages, éditeur de thèmes
│   ├── themes/                # thèmes intégrés + importeurs
│   ├── keybindings/           # moteur de raccourcis
│   ├── plugins/               # API plugins
│   └── store/                 # Zustand
├── cli/                       # binaire `nacre` (Rust) pour piloter l'app
├── shell/                     # scripts d'intégration shell
├── docs/
└── PLAN.md
```

**Principes clés**
- Le **layout** est un arbre : `Fenêtre → Onglets → arbre de splits (nœuds H/V) → Panes`. Chaque pane possède un PTY identifié par un `pane_id`.
- Chaque PTY reçoit des variables d'environnement `NACRE=1`, `NACRE_PANE_ID=<id>` et `NACRE_SOCKET=<chemin>`. C'est ce qui permet aux hooks Claude Code de dire à l'app **dans quel pane** tourne une session.
- Les données PTY transitent par des **events Tauri en binaire**, par lots, pour éviter la latence.

### Comment on récupère les infos Claude (point crucial)

Deux sources combinées :
1. **Hooks Claude Code** (`SessionStart`, `UserPromptSubmit`, `Stop`, `Notification`, `PreToolUse`/`PostToolUse`, `SessionEnd`) : un petit script appelle `nacre claude-event` avec le JSON du hook (qui contient `session_id` et `transcript_path`) et `$NACRE_PANE_ID`. On sait ainsi exactement quel pane correspond à quelle session et dans quel état elle est (en train de réfléchir, en attente, terminée).
2. **Transcripts JSONL** (`~/.claude/projects/<cwd-encodé>/<session>.jsonl`) surveillés avec `notify` : on lit l'`usage` du dernier message assistant (`input_tokens + cache_creation_input_tokens + cache_read_input_tokens`) et on le rapporte à la fenêtre de contexte du modèle (200k, 1M...) pour obtenir le **% de contexte**, les tokens et le coût estimé.
3. *(optionnel)* **Status line Claude Code** : un script `nacre statusline` qu'on peut configurer comme status line. Il reçoit le JSON officiel (modèle, coût, contexte...), l'affiche dans Claude **et** le transmet à l'app.

Fallback sans hooks : détection du process `claude` au premier plan du pane, puis transcript le plus récent dans le dossier projet correspondant au cwd.

> ⚠️ Le format exact des JSONL, des hooks et de la status line doit être **vérifié au moment de l'implémentation** (doc officielle + fichiers réels sur la machine), pas supposé.

---

## 4. Catalogue des fonctionnalités

### 4.A Cœur du terminal
- [x] `V1` Lancement du shell par défaut de l'utilisateur (zsh), en login shell
- [x] `V1` Rendu xterm.js en WebGL (fallback canvas)
- [x] `V1` Couleurs 256 + truecolor (24 bits), `TERM=xterm-256color`
- [x] `V1` Unicode, emojis, caractères larges (unicode11)
- [x] `V1` Redimensionnement correct (PTY resize synchronisé)
- [x] `V1` Scrollback configurable (ex. 10 000 lignes, ou illimité sur disque en V3)
- [x] `V1` Sélection souris, copier/coller (Cmd+C / Cmd+V)
- [x] `V1` Bracketed paste
- [x] `V1` Support souris des apps TUI (vim, htop, lazygit…)
- [x] `V1` Option ⌥ utilisable comme Meta (configurable gauche/droite)
- [x] `V1` Saisie IME (accents, caractères asiatiques)
- [x] `V1` URLs cliquables (Cmd+clic)
- [x] `V1` Recherche dans le scrollback (Cmd+F) : texte, regex, sensible à la casse
- [x] `V2` Hyperliens OSC 8
- [x] `V2` Presse-papier OSC 52 (copier depuis vim/tmux en SSH)
- [x] `V2` Titre de fenêtre/onglet via OSC 0/2
- [x] `V2` Suivi du dossier courant via OSC 7 (et fallback par process)
- [x] `V2` Ligatures de police (Fira Code, JetBrains Mono…)
- [x] `V2` Chemins de fichiers cliquables (`src/main.rs:42` → ouvre dans l'éditeur à la bonne ligne)
- [x] `V2` Copy-on-select (option)
- [x] `V2` Avertissement au collage multi-lignes / commandes dangereuses
- [x] `V2` Bell : visuelle, sonore, notification système, badge (au choix)
- [x] `V3` Images inline (protocoles Sixel, iTerm2 et Kitty)
- [x] `V3` Scrollback illimité stocké sur disque

### 4.B Onglets
- [x] `V1` Nouvel onglet (Cmd+T), fermer (Cmd+W), suivant/précédent (Cmd+Shift+[ / ])
- [x] `V1` Aller à l'onglet N (Cmd+1…9)
- [x] `V1` Nouvel onglet dans le même dossier que l'onglet courant
- [x] `V1` Titre automatique (process en cours + dossier)
- [x] `V1` Confirmation avant de fermer si un process tourne
- [x] `V2` Réordonner par glisser-déposer
- [x] `V2` Renommer un onglet (double-clic)
- [x] `V2` Couleur et icône personnalisées par onglet
- [x] `V2` Icône automatique selon le process (node, python, git, docker, Claude…)
- [x] `V2` Indicateur d'activité (nouvel output en arrière-plan) et de bell
- [x] `V2` Badge « Claude attend ta réponse » sur l'onglet
- [x] `V2` Rouvrir le dernier onglet fermé (Cmd+Shift+T)
- [x] `V2` Dupliquer un onglet
- [x] `V2` Onglets épinglés
- [x] `V3` Onglets verticaux (barre latérale) au lieu d'horizontaux
- [x] `V3` Détacher un onglet dans une nouvelle fenêtre / rattacher
- [x] `V3` Vue d'ensemble des onglets (grille de miniatures)

### 4.C Splits (panneaux)
- [x] `V1` Split vertical (Cmd+D) et horizontal (Cmd+Shift+D)
- [x] `V1` Le nouveau split hérite du dossier courant
- [x] `V1` Navigation entre panes (Cmd+⌥+flèches) et focus au clic
- [x] `V1` Redimensionnement à la souris (séparateur draggable)
- [x] `V1` Fermer un pane (le layout se réorganise)
- [x] `V2` Redimensionnement au clavier
- [x] `V2` Zoom d'un pane (plein onglet, Cmd+Shift+Entrée), puis retour
- [x] `V2` Égaliser les tailles
- [x] `V2` Échanger deux panes / déplacer par drag & drop
- [x] `V2` Pane actif mis en évidence (bordure, ou atténuation des inactifs)
- [x] `V2` Broadcast : taper dans tous les panes en même temps
- [x] `V2` Layouts prédéfinis (2 colonnes, 3 colonnes, grille 2×2, principal + pile)
- [x] `V3` Déplacer un pane vers un autre onglet
- [x] `V3` Titre/barre par pane (mini-barre d'état par pane)

### 4.D Fenêtres, workspaces et sessions
- [x] `V1` Plusieurs fenêtres (Cmd+N)
- [x] `V2` **Restauration de session** au redémarrage : fenêtres, onglets, splits, dossiers (et scrollback en option)
- [x] `V2` **Workspaces** : un ensemble nommé d'onglets + splits + commandes de démarrage (ex. « Projet X » = serveur + tests + Claude), lançable en un clic
- [x] `V2` Plein écran natif macOS
- [x] `V2` Transparence et flou d'arrière-plan (vibrancy macOS)
- [x] `V3` **Mode Quake / dropdown** : terminal qui descend du haut de l'écran via un raccourci global
- [x] `V3` Fenêtre toujours au premier plan
- [x] `V3` Fenêtre sans bordure / titre intégré à la barre d'onglets

### 4.E Thèmes et apparence
- [x] `V1` Thèmes intégrés : Dracula, Catppuccin (4 variantes), Tokyo Night, Gruvbox, Nord, One Dark, Solarized, Rosé Pine, GitHub, Kanagawa, Everforest
- [x] `V1` Choix de la police, taille, hauteur de ligne, espacement des lettres
- [x] `V1` Zoom de police (Cmd+ / Cmd- / Cmd+0)
- [x] `V1` Style de curseur (bloc, barre, souligné) et clignotement
- [x] `V1` Padding intérieur configurable
- [x] `V1` Rechargement à chaud de la config et des thèmes
- [x] `V2` **Éditeur de thème visuel** avec aperçu en direct
- [x] `V2` Import de thèmes : iTerm2 (`.itermcolors`), Base16, Windows Terminal, Ghostty, Alacritty
- [x] `V2` Export / partage de thème
- [x] `V2` Bascule automatique clair/sombre selon le système
- [x] `V2` Thème de l'interface (onglets, barres) indépendant ou dérivé du thème du terminal
- [x] `V2` Opacité de fond
- [x] `V2` Image ou dégradé de fond (avec opacité/flou)
- [x] `V2` Thème différent par profil / par onglet
- [x] `V2` Support Nerd Fonts (icônes dans la barre d'état et les prompts)
- [x] `V3` Curseur animé avec traînée (style Neovide)
- [x] `V3` Shaders fun : effet CRT rétro, scanlines, glow
- [x] `V3` Thème qui change selon le dossier / la machine SSH (ex. rouge en prod)

### 4.F Barre d'état et widgets
- [x] `V1` Barre d'état configurable (en haut ou en bas, globale ou par pane)
- [x] `V1` Segments à gauche / au centre / à droite, dans l'ordre voulu
- [x] `V1` Segment : dossier courant (raccourci, cliquable)
- [x] `V1` Segment : branche git + état (modifié, en avance/en retard)
- [x] `V1` Segment : heure
- [x] `V2` Segment : process en cours + durée de la dernière commande + code de sortie
- [x] `V2` Segment : CPU / RAM / batterie / réseau
- [x] `V2` Segment : versions d'outils (node, python, rust…) selon le projet
- [x] `V2` Segment : contexte Kubernetes / AWS profile / Docker
- [x] `V2` **Segments personnalisés par script** (commande shell exécutée toutes les N secondes, sortie affichée)
- [x] `V2` Styles : simple, powerline (flèches), pills (pastilles arrondies), minimal
- [x] `V2` Couleurs conditionnelles (ex. rouge si contexte > 80 %)
- [x] `V2` Clic sur un segment = action (ouvrir le dossier, git status, dashboard Claude…)
- [x] `V3` Segments via plugins JS

### 4.G Intégration Claude ⭐ (le cœur différenciant)
**Affichage**
- [x] `V1` Détection automatique d'une session Claude Code dans un pane
- [x] `V1` **Jauge de contexte** : % utilisé + tokens (ex. `▓▓▓▓▓░░░ 62 % · 124k/200k`), couleur selon le seuil
- [x] `V1` Modèle utilisé (Opus, Sonnet, Haiku…)
- [x] `V2` Détail des tokens : input, output, cache lu, cache écrit
- [x] `V2` Coût estimé de la session (et du jour)
- [x] `V2` Durée de la session, nombre d'échanges
- [x] `V2` **État en direct** : en train de réfléchir / outil en cours (lequel) / en attente de ta réponse / terminé
- [x] `V2` Alerte quand le contexte approche de la limite (avant l'auto-compact)
- [x] `V3` Suivi des limites d'usage (fenêtre 5 h / hebdo), si les données sont disponibles

**Notifications**
- [x] `V2` Notification système quand Claude a fini ou attend une permission/réponse (seulement si le pane n'est pas visible)
- [x] `V2` Badge sur l'onglet + son optionnel
- [x] `V2` Badge sur l'icône du Dock (nombre de sessions qui t'attendent)

**Gestion des sessions**
- [x] `V2` **Dashboard Claude** : toutes les sessions actives (pane, projet, contexte, état, coût), clic = aller au pane
- [x] `V2` Lancer Claude dans un nouveau split en un raccourci
- [x] `V2` Historique des sessions passées par projet + reprise en un clic (`claude --resume <id>`)
- [x] `V2` Installation automatique des hooks et de la status line (avec confirmation, sans écraser la config existante)
- [x] `V3` Panneau latéral : todo-list de Claude en direct, fichiers modifiés par la session
- [x] `V3` Visualiseur de diff des fichiers modifiés par Claude
- [x] `V3` Graphique de la consommation de contexte au fil de la session
- [x] `V3` Statistiques globales : tokens et coût par jour / projet / modèle

**IA dans le terminal** (via `claude -p` en mode headless, donc ton abonnement est réutilisé sans clé API, ou clé API en option stockée dans le trousseau macOS)
- [x] `V2` **Cmd+K : commande en langage naturel** → proposition de commande shell, que tu valides avant de l'exécuter
- [x] `V2` « Expliquer cette erreur » sur la dernière commande en échec
- [x] `V3` « Résumer cet output » sur un bloc sélectionné
- [x] `V3` Panneau de chat latéral avec le contexte du terminal (cwd, dernière commande, output)
- [x] `V3` Suggestion de correction après une commande en échec (style `thefuck`)

### 4.H Intégration shell et blocs de commandes (à la Warp)
- [x] `V2` Scripts d'intégration zsh/bash/fish injectés automatiquement (OSC 133 : début du prompt, de la commande, fin + code de sortie)
- [x] `V2` Marqueurs de prompt dans la marge (✓ vert / ✗ rouge)
- [x] `V2` Sauter de prompt en prompt (Cmd+↑ / Cmd+↓)
- [x] `V2` Sélectionner / copier l'output d'une seule commande
- [x] `V2` Durée de chaque commande
- [x] `V3` **Blocs** : chaque commande et son output forment un bloc visuel (repliable, copiable, relançable)
- [x] `V3` En-tête de bloc collant (la commande reste visible quand on scrolle un long output)
- [x] `V3` Filtrer l'output d'un bloc (grep visuel)
- [x] `V3` Partager un bloc (export Markdown / image)

### 4.I Saisie améliorée
- [x] `V3` Autocomplétion graphique des commandes (specs façon Fig : git, npm, docker…)
- [x] `V3` Suggestions depuis l'historique
- [x] `V3` Éditeur de commande multi-ligne (curseur à la souris, sélection)
> Ces fonctions entrent en conflit avec l'éditeur de ligne du shell : ce sont les plus difficiles, à garder pour la fin.

### 4.J Palette, raccourcis et snippets
- [x] `V1` **Palette de commandes** (Cmd+Shift+P) : toutes les actions de l'app, recherche floue
- [x] `V1` Raccourcis entièrement configurables (toutes les actions, via la config)
- [x] `V2` **Éditeur de raccourcis dans les réglages** : liste de toutes les actions, recherche, capture de la touche, détection des conflits, réinitialisation
- [x] `V2` **Snippets / commandes favorites** avec paramètres (`ssh {{host}}`)
- [x] `V2` Historique global cherchable (toutes sessions confondues)
- [x] `V2` Sélecteur rapide de dossiers récents (style zoxide)
- [x] `V3` Raccourcis en accords (chords, ex. Ctrl+A puis D)
- [x] `V3` Mode leader façon tmux

### 4.K Profils
- [x] `V2` Profils multiples : shell, dossier de départ, variables d'env, thème, police, commande de démarrage
- [x] `V2` Menu « nouvel onglet avec profil… »
- [x] `V3` Profil automatique selon le dossier (ex. thème différent dans `~/work`)

### 4.L Productivité
- [x] `V2` Notification quand une longue commande se termine (seuil configurable, seulement si pas visible)
- [x] `V2` Surlignage par regex (ex. `ERROR` en rouge, `WARN` en jaune)
- [x] `V2` Sélection intelligente au double-clic (URL, chemin, hash git, IP, email)
- [x] `V2` Glisser-déposer un fichier dans le terminal → insère son chemin échappé
- [x] `V2` Export du scrollback (texte, HTML avec couleurs)
- [x] `V3` **Mode hints** (style Kitty) : raccourci → lettres sur chaque URL/chemin/hash visible → taper la lettre copie/ouvre
- [x] `V3` Mode copie au clavier (navigation façon vim dans le scrollback)
- [x] `V3` Triggers : regex dans l'output → action (notification, commande, surlignage)
- [x] `V3` Enregistrement de session (format asciinema) + relecture
- [x] `V3` Historique du presse-papier

### 4.M SSH et distant
- [x] `V2` Gestionnaire de connexions SSH (lit `~/.ssh/config`, ouverture en un clic)
- [x] `V3` Intégration tmux en mode contrôle (`tmux -CC` : les fenêtres tmux deviennent des onglets natifs)
- [x] `V3` Navigateur de fichiers SFTP

### 4.N Configuration
- [x] `V1` Fichier `~/.config/nacre/config.toml`, commenté, avec valeurs par défaut
- [x] `V1` Validation avec messages d'erreur clairs (sans faire planter l'app)
- [x] `V2` **Interface graphique des réglages** (synchronisée avec le fichier)
- [x] `V2` Import / export de la config
- [x] `V3` Synchronisation via dossier dotfiles / gist

### 4.O Extensibilité
- [x] `V2` **CLI `nacre`** : `nacre new-tab`, `nacre split`, `nacre send-text`, `nacre notify`, `nacre claude-event`, `nacre statusline`…
- [x] `V3` API de plugins JS (segments de barre, commandes de palette, thèmes, triggers)
- [x] `V3` Dossier de plugins + activation/désactivation dans les réglages

### 4.P Système, perf et distribution
- [x] `V1` Menus macOS natifs
- [x] `V1` Icône de l'application
- [x] `V1` Performance : pas de rendu pour les onglets cachés, envoi PTY par lots
- [x] `V2` Build `.dmg` installable
- [x] `V2` Mises à jour automatiques (updater Tauri, via GitHub Releases)
- [x] `V2` Icône dans la barre des menus (menu rapide : nouvelle fenêtre, workspaces, sessions Claude)
- [x] `V2` Lancement à l'ouverture de session (option)
- [x] `V2` Saisie clavier sécurisée macOS (Secure Keyboard Entry)
- [x] `V3` Interface bilingue FR / EN
- [x] `V3` Accessibilité (lecteur d'écran, contraste)
- [x] `V3` Masquage automatique des secrets détectés dans l'output (tokens, clés API)
- [x] `V3` Builds Linux / Windows

---

## 5. Roadmap (ordre de construction)

Chaque phase se termine par une app **qui compile, qui se lance et qui marche**. On ne passe pas à la suite sans ça.

### Phase 0 — Fondations
- [x] `git init`, `.gitignore`, README minimal
- [x] Scaffold Tauri 2 + React + TypeScript + Vite
- [x] ESLint + Prettier, `cargo fmt` + `clippy`
- [x] Vitest + `cargo test` opérationnels (un test bidon chacun)
- [x] Scripts `npm run dev`, `npm run build`, `npm run test`, `npm run lint`

### Phase 1 — Un terminal qui marche (4.A V1)
- [x] Module PTY Rust : spawn du shell, lecture/écriture, resize, kill, nettoyage à la fermeture
- [x] Pont PTY ↔ frontend (events binaires par lots + commandes Tauri)
- [x] Composant xterm.js avec addons webgl, fit, unicode11, web-links, search
- [x] Copier/coller, Option comme Meta, bracketed paste, IME
- [x] Recherche Cmd+F
- [x] Vérif : `vim`, `htop`, `less`, couleurs truecolor, emojis, resize

### Phase 2 — Onglets et splits (4.B V1, 4.C V1, 4.D V1)
- [x] Modèle de layout (arbre) dans le store, avec tests unitaires (split, fermeture, navigation)
- [x] Barre d'onglets + raccourcis
- [x] Splits avec séparateurs draggables
- [x] Navigation directionnelle entre panes
- [x] Héritage du cwd (via le process au premier plan)
- [x] Titres automatiques
- [x] Multi-fenêtres
- [x] Confirmation de fermeture si un process tourne

### Phase 3 — Config et thèmes (4.E V1, 4.N V1, 4.J V1)
- [x] Identité visuelle : proposer 2-3 directions courtes à l'utilisateur, puis écrire `docs/design.md` (voir section 0)
- [x] Schéma de config TOML + valeurs par défaut + validation
- [x] Hot reload (notify)
- [x] Moteur de thèmes (CSS variables + thème xterm), thèmes intégrés
- [x] Polices, curseur, padding, zoom
- [x] Moteur de raccourcis configurable
- [x] Palette de commandes
- [x] Menus natifs + icône

### Phase 4 — Barre d'état (4.F)
- [x] Moteur de segments (gauche/centre/droite, intervalle de rafraîchissement, styles)
- [x] Segments cwd, git, heure, process, durée, code de sortie, système
- [x] Segments personnalisés par script
- [x] Couleurs conditionnelles + actions au clic

### Phase 5 — Intégration Claude (4.G)
- [ ] Étude du format réel : transcripts JSONL, JSON des hooks, JSON de la status line (doc officielle + fichiers locaux)
- [ ] Injection de `NACRE_PANE_ID` / `NACRE_SOCKET` dans chaque PTY
- [ ] Socket Unix + CLI `nacre` (`claude-event`, `statusline`, `notify`)
- [ ] Parser JSONL + calcul contexte/tokens/coût, avec tests sur des fixtures
- [ ] Détection de session (hooks + fallback par process)
- [ ] Segments Claude : jauge de contexte, modèle, coût, état
- [ ] Notifications + badges onglet/Dock
- [ ] Dashboard des sessions, historique + reprise
- [ ] Assistant d'installation des hooks (fusion propre dans `~/.claude/settings.json`, avec sauvegarde)

### Phase 6 — Intégration shell et blocs (4.H)
- [ ] Scripts zsh/bash/fish (OSC 7 + OSC 133) et injection automatique
- [ ] Marqueurs, navigation de prompt en prompt, durée et statut par commande
- [ ] Sélection/copie de l'output d'une commande
- [ ] Blocs visuels (V3)

### Phase 7 — Sessions, workspaces, profils (4.D V2, 4.K)
- [ ] Sauvegarde/restauration de session
- [ ] Workspaces
- [ ] Profils
- [ ] Interface graphique des réglages + éditeur de thème + importeurs de thèmes
- [ ] Éditeur de raccourcis (toutes les actions, conflits, réinitialisation)

### Phase 8 — IA dans le terminal (4.G IA)
- [ ] Cmd+K langage naturel → commande (via `claude -p`), validation obligatoire avant exécution
- [ ] Expliquer l'erreur / résumer un output
- [ ] Panneau de chat

### Phase 9 — Productivité et extensibilité (4.L, 4.M, 4.O, 4.J V2)
- [ ] Snippets, historique global, dossiers récents
- [ ] Surlignage regex, sélection intelligente, drag & drop, export
- [ ] Notifications de longues commandes
- [ ] SSH manager
- [ ] Mode hints, mode copie, triggers
- [ ] API plugins

### Phase 10 — Finitions et distribution (4.P)
- [ ] Transparence/flou, image de fond, effets fun
- [ ] Mode Quake, icône de barre des menus
- [ ] Build `.dmg`, updater
- [ ] Optimisation des performances (benchmark : `cat` d'un gros fichier, 20 onglets ouverts)
- [ ] Documentation utilisateur (`docs/`)

---

## 6. Instructions pour l'agent (développement autonome)

- **La section 0 prime sur tout.** Chaque écran et chaque texte passe la checklist avant commit.
- **Suivre la roadmap dans l'ordre.** Ne traiter que les fonctionnalités cochées `[x]` en section 4. Cocher les tâches de la section 5 au fur et à mesure.
- **Ne jamais laisser l'app cassée** : à la fin de chaque tâche, `npm run build`, `npm run lint` et `npm run test` doivent passer. Lancer l'app pour vérifier visuellement ce qui touche à l'interface.
- **Tester la logique pure** (arbre de layout, parser de config, parser JSONL Claude, calcul du contexte, moteur de raccourcis) avec des tests unitaires.
- **Vérifier, ne pas supposer** : pour tout ce qui concerne Claude Code (hooks, JSONL, status line), lire la documentation officielle et les fichiers réels avant de coder.
- **Ne jamais modifier `~/.claude/` ni les dotfiles de l'utilisateur sans confirmation explicite**, et toujours faire une sauvegarde avant.
- **Commits** : un commit par tâche cohérente, messages clairs (en français ou en anglais, mais de façon cohérente).
- **Bloqué ?** Noter le problème dans une section « Problèmes ouverts » en bas de ce fichier, passer à la tâche suivante si possible, et le signaler.
- **Journal** : tenir à jour la section « Avancement » ci-dessous (date, phase, ce qui a été fait).

---

## 7. Avancement

- 2026-10-25 · Phase 0 · Workspace Cargo (`src-tauri`, `cli`), Tauri 2 + React 19 + Vite 8, ESLint/Prettier/clippy, Vitest + cargo test.
- 2026-10-26 · Phases 1-2 · PTY Rust (lots binaires, contrôle de flux), session xterm.js (WebGL), moteur de raccourcis (accords, AZERTY), arbre de layout testé, onglets (glisser, renommer, épingler, couleur, rouvrir), splits, zoom, broadcast, multi-fenêtres, palette, confirmation de fermeture. Direction visuelle « Nacre » choisie, `docs/design.md`. Socket debug (eval + snapshot WKWebView) pour vérifier l'UI.
- 2026-10-26 · Phase 3 · `~/.config/nacre/config.toml` commenté généré au 1er lancement (défauts = source TS unique, testés), validation par champ avec message d'une ligne, rechargement à chaud (notify) config + `themes/*.toml`, 21 thèmes intégrés, chrome dérivé du thème, ligatures, zoom, menus natifs synchronisés avec les raccourcis, icône.
- 2026-10-26 · Phase 4 · Barre d'état (fenêtre ou par pane, haut/bas), 4 styles (minimal, simple, powerline sans police spéciale, pills), segments cwd, git, heure, process, CPU, RAM, batterie, réseau, versions d'outils par projet, k8s, docker, AWS, venv, scripts perso (`[[statusbar.custom]]`, timeout + kill du groupe), niveaux de couleur, clics.

## 8. Problèmes ouverts

_(aucun)_
