# Nacre

A desktop terminal for macOS, fully configurable, built around Claude Code.

- Tabs, splits, windows, workspaces, session restore
- Claude Code sessions at a glance: context gauge, model, cost, state, limits, notifications
- ⌘K: describe a command, review it, run it
- Shell integration: command marks, durations, blocks, history across sessions
- Themes, profiles, status bar, every shortcut rebindable, plugins

## Install

Open `Nacre_x.y.z_aarch64.dmg` and drag Nacre to Applications.

## Develop

```sh
npm install
npm run dev      # run the app with hot reload
npm run test     # Vitest + cargo test
npm run lint     # ESLint, Prettier, rustfmt, clippy
npm run bundle   # .app and .dmg in target/release/bundle
```

Requires Node 20+ and Rust (`rustup`).

## Docs

[Configuration](docs/config.md) · [Shortcuts](docs/shortcuts.md) · [Claude Code](docs/claude.md) · [Workspaces & profiles](docs/workspaces.md) · [Themes](docs/themes.md) · [Plugins](docs/plugins.md) · [CLI](docs/cli.md) · [Releases](docs/release.md) · [Design](docs/design.md)
