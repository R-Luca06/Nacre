# Claude Code

Nacre recognizes Claude Code in any pane. For live state (thinking, tool, waiting), notifications and exact costs, connect it once: Settings → Claude → Connect.

Connecting adds hooks to `~/.claude/settings.json` (a backup is written next to it) and wraps your status line so it keeps working. Disconnect restores the file exactly. Hooks do nothing outside Nacre.

- **Status bar**: state, model, context gauge (`62% · 124k/200k`), cost, 5 h / 7 day limits.
- **Tabs and Dock**: a dot when Claude is done or needs you; the Dock shows how many sessions wait.
- **Notifications**: only when the pane is not on screen.
- **Sessions** (⇧⌘C): every live session; click to jump to it. History: resume any past session. Usage: cost per day, project and model (estimated from transcripts).
- **Panel** (⌃⌘C): files changed (click for the diff), context over time, and the todo list when the session keeps one.
- **Claude in a split** (⌥⌘C).

Without hooks, Nacre still finds sessions by watching for the `claude` process and reading its transcript.

The AI features (⌘K, explain, fix, chat) run `claude -p` with your Claude Code login, with tools disabled. Settings → AI can switch them to an Anthropic API key kept in the macOS Keychain.
