# Themes

21 built-in themes. Pick one in Settings → Appearance, separately for dark and light mode; `theme.mode = "system"` follows macOS. Right-click a tab to give it its own theme.

Custom themes live in `~/.config/nacre/themes/*.toml` and reload on save:

```toml
name = "Harbor"
background = "#0f1419"
foreground = "#d0d7de"
cursor = "#9ed8cf"
selection = "#253340"
accent = "#9ed8cf"      # tabs and highlights; defaults to ANSI blue
palette = [
  "#1b2129", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#c8ccd4",
  "#5c6370", "#ef8a92", "#b1d88f", "#f0d399", "#8fc1f5", "#d7a6e8", "#7fd4cc", "#ffffff",
]
```

Customize builds one from the current theme with a live preview. Import reads iTerm2 (`.itermcolors`), Base16 (YAML), Windows Terminal (JSON), Ghostty and Alacritty (TOML). Export copies the TOML.
