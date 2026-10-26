# Workspaces and profiles

## Workspaces

A workspace is a file in `~/.config/nacre/workspaces/`. Open it from the palette (`Workspace: …`) or the menu bar. Save the current window with "Save Window as Workspace".

```toml
name = "Project X"
cwd = "~/dev/x"

[[tab]]
title = "dev"
layout = "columns"   # columns | rows | grid | main-stack
panes = [ { command = "npm run dev" }, { command = "npm test -- --watch", cwd = "api" } ]

[[tab]]
title = "claude"
split = { dir = "row", sizes = [0.6, 0.4], children = [ { command = "claude" }, { cwd = "docs" } ] }
```

## Profiles

```toml
[profiles.work]
cwd = "~/work"
shell = "/bin/zsh"
env = { AWS_PROFILE = "work" }
command = ""
theme = "Tokyo Night"
font_family = ""
font_size = 0                # 0 keeps the global size
match_dirs = ["~/work"]      # panes there take this look automatically
match_ssh = ["*.prod.*"]     # same for ssh sessions to these hosts
```

Right-click the + button, or use the palette, to open a tab with a profile.
