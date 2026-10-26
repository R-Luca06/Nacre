<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/media/banner-light.png">
  <img alt="Nacre" src="docs/media/banner-dark.png">
</picture>

<p align="center">
  Un terminal macOS qui sait ce que fait Claude Code.<br>
  Gratuit, rapide, configurable jusqu'au dernier raccourci.
</p>

<p align="center">
  <a href="#premiers-pas">Premiers pas</a> ·
  <a href="#claude-code">Claude Code</a> ·
  <a href="#lia-dans-le-shell">IA</a> ·
  <a href="#onglets-et-splits">Onglets et splits</a> ·
  <a href="#intégration-shell">Intégration shell</a> ·
  <a href="#personnaliser">Personnaliser</a> ·
  <a href="README.md">English</a>
</p>

![Nacre avec Claude Code, un serveur et des tests côte à côte](docs/media/hero.png)

## Premiers pas

1. **Connecte Claude Code** : Réglages <kbd>⌘,</kbd> → Claude → Connecter. Une fois, c'est tout.
2. **Coupe l'écran** : <kbd>⌘D</kbd> à droite, <kbd>⇧⌘D</kbd> en bas. Lance `claude` d'un côté, ton serveur de l'autre.
3. **Oublie les raccourcis** : <kbd>⇧⌘P</kbd> ouvre la palette, qui liste toutes les actions avec leur raccourci.
4. **Demande une commande** : <kbd>⌘K</kbd>, puis écris ce que tu veux faire en français.

## Claude Code

**À quoi ça sert** : savoir où en est chaque session Claude sans aller voir, et ne plus rater le moment où elle attend ta réponse.

Lance `claude` dans n'importe quel panneau. La barre d'état affiche l'état (réfléchit, outil, attend une permission), le modèle, le contexte utilisé, le coût et tes limites sur 5 h et sur la semaine.

![Claude Code au travail, la barre d'état suit son état](docs/media/claude.gif)

- **Un point sur l'onglet** quand Claude a fini ou t'attend, un compteur sur l'icône du Dock, une notification si le panneau n'est pas visible.
- **Sessions** <kbd>⇧⌘C</kbd> : toutes les sessions ouvertes avec leur contexte et leur coût ; un clic t'emmène au bon panneau. **Historique** : reprendre une ancienne session. **Consommation** : coût par jour, par projet, par modèle.
- **Panneau** <kbd>⌃⌘C</kbd> : les fichiers modifiés par la session (clic = le diff) et la courbe du contexte.
- **Claude dans un split** <kbd>⌥⌘C</kbd>.

![Sessions en cours](docs/media/sessions.png)
![Consommation par jour, modèle et projet](docs/media/usage.png)
![Panneau latéral avec le diff d'un fichier modifié par Claude](docs/media/claude-panel.png)

La connexion ajoute des hooks dans `~/.claude/settings.json` (avec une sauvegarde à côté) ; Déconnecter remet le fichier exactement comme avant. Sans connexion, Nacre repère quand même les sessions, avec moins de détails. [Détails](docs/claude.md)

## L'IA dans le shell

**À quoi ça sert** : ne plus chercher une commande sur Google, comprendre une erreur sans copier-coller.

<kbd>⌘K</kbd> transforme une phrase en commande. Tu la lis, puis tu l'insères ou tu l'exécutes : rien ne part sans toi.

![⌘K : une phrase devient une commande](docs/media/cmdk.gif)

- **Expliquer l'erreur** <kbd>⇧⌘E</kbd> sur la dernière commande ratée, avec une correction à insérer.
- **Proposer une correction** <kbd>⌥⌘F</kbd>, **résumer une sortie**, et un **chat** <kbd>⇧⌘A</kbd> qui peut voir le dossier, la dernière commande ou l'écran.

![Expliquer l'erreur sur un port déjà utilisé](docs/media/explain.png)

Ça passe par `claude -p` avec ton abonnement Claude Code, sans outils. Une clé API Anthropic (rangée dans le Trousseau) marche aussi.

## Onglets et splits

**À quoi ça sert** : garder un projet entier dans une fenêtre (Claude, serveur, tests, git) et le retrouver tel quel demain.

![Couper, naviguer et agrandir des panneaux](docs/media/splits.gif)

- <kbd>⌘D</kbd> / <kbd>⇧⌘D</kbd> pour couper, <kbd>⌥⌘</kbd> + flèches pour naviguer, <kbd>⇧⌘↩</kbd> pour agrandir un panneau. Un nouveau panneau s'ouvre dans le dossier courant.
- **Restauration** : fenêtres, onglets, splits, dossiers et historique reviennent après un redémarrage.
- **Workspaces** : un fichier qui ouvre d'un coup les onglets, splits et commandes d'un projet. [Format](docs/workspaces.md)
- Onglets en haut ou en barre latérale, vue de tous les onglets <kbd>⇧⌘\\</kbd>, onglet déplacé vers une autre fenêtre sans couper ses shells, saisie dans tous les panneaux à la fois <kbd>⌥⌘I</kbd>, terminal déroulant sur un raccourci global.

## Intégration shell

**À quoi ça sert** : traiter chaque commande comme un bloc (voir si elle a échoué, la copier, la relancer) au lieu d'un mur de texte.

Ça marche avec zsh, bash et fish, sans toucher à tes fichiers de config.

- Une marque par commande dans la marge (réussie ou ratée). <kbd>⌘↑</kbd> <kbd>⌘↓</kbd> sautent d'une invite à l'autre, <kbd>⇧⌘O</kbd> copie la dernière sortie ; on peut aussi la relancer, la filtrer, garder la commande épinglée en haut pendant le défilement.
- Durée et code de sortie dans la barre d'état, notification quand une longue commande se termine.
- **Complétions** <kbd>⌃Espace</kbd> pour git, npm, docker, cargo, kubectl, brew et gh, et suggestions tirées de ton historique <kbd>→</kbd>.
- **Historique**, **dossiers récents**, **snippets** et **hôtes SSH** dans la palette <kbd>⇧⌘H</kbd> <kbd>⇧⌘J</kbd> <kbd>⇧⌘S</kbd> <kbd>⇧⌘R</kbd>.
- **Hints** <kbd>⇧⌘U</kbd> : une lettre sur chaque URL, chemin et hash à l'écran ; tape-la pour copier ou ouvrir. **Mode copie** <kbd>⇧⌘X</kbd> : se déplacer dans l'historique comme dans vim.

![Menu de complétion git](docs/media/complete.png)
![Hints sur des hashes, une URL et des chemins](docs/media/hints.png)

Aussi : chemins `fichier:ligne` cliquables qui s'ouvrent dans ton éditeur, images dans le terminal (Sixel, iTerm2), secrets masqués dans la sortie, enregistrement de session (asciinema), historique du presse-papier <kbd>⇧⌘V</kbd>.

## Personnaliser

21 thèmes, un éditeur de thème, et l'import depuis iTerm2, Base16, Windows Terminal, Ghostty et Alacritty. Clic droit sur un onglet pour lui donner son propre thème.

![Quatre des thèmes intégrés](docs/media/themes.png)

La barre d'état accepte n'importe quels segments, en quatre styles : dossier, git, process, CPU, mémoire, batterie, versions d'outils, Kubernetes, AWS, Docker, Claude, ou la sortie de ton propre script.

![Styles de la barre d'état](docs/media/statusbar.png)

Les Réglages <kbd>⌘,</kbd> et `~/.config/nacre/config.toml` restent synchronisés, commentaires compris. Chaque raccourci se change, accords compris. Les profils changent shell, dossier, thème ou police selon le dossier ou l'hôte SSH. Les plugins JavaScript ajoutent segments, commandes, thèmes et déclencheurs.

![Réglages](docs/media/settings.png)

## Installer

Télécharge le `.dmg` depuis les [Releases](https://github.com/R-Luca06/Nacre/releases) et glisse Nacre dans Applications. L'app n'est pas encore notarisée : la première fois, clic droit sur Nacre → Ouvrir. Les mises à jour s'installent ensuite depuis l'app.

Pas encore de release ? `npm install && npm run bundle`, puis ouvre le `.dmg` dans `target/release/bundle/dmg`.

macOS 12 ou plus récent.

## Docs

[Configuration](docs/config.md) · [Raccourcis](docs/shortcuts.md) · [Claude Code](docs/claude.md) · [Workspaces et profils](docs/workspaces.md) · [Thèmes](docs/themes.md) · [Plugins](docs/plugins.md) · [CLI](docs/cli.md) · [Releases](docs/release.md) · [Design](docs/design.md)
