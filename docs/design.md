# Design

The terminal is the hero. Chrome is quiet, flat and thin.

## Palette

| Token         | Dark      | Light     | Use                                     |
| ------------- | --------- | --------- | --------------------------------------- |
| `--bg`        | `#0E0F12` | `#F7F7F5` | window, terminal                        |
| `--bg-raised` | `#16181C` | `#FFFFFF` | popovers, palette                       |
| `--bg-hover`  | `#1D2025` | `#ECECE8` | hover rows                              |
| `--line`      | `#23262B` | `#E2E2DD` | separators, borders                     |
| `--text`      | `#D6D8DC` | `#1E2024` | primary text                            |
| `--text-dim`  | `#7D828B` | `#6E727A` | secondary text, inactive tabs           |
| `--accent`    | `#9ED8CF` | `#2E8C80` | the one accent: focus, active, progress |
| `--warn`      | `#E5C07B` | `#A87A1F` | thresholds                              |
| `--danger`    | `#E06C75` | `#C2414B` | errors, failed commands                 |

Chrome colors derive from the active terminal theme (background, foreground, one ANSI color as accent) unless `ui.theme` pins them.

## Type

- UI: **Inter** 12 px, weights 400 / 500. Labels 1–3 words, sentence case.
- Mono: **JetBrains Mono** 13 px, line height 1.2. Both are bundled.

## Shape

- 4 px grid. Bars: tabs 32, status 24. Inner padding 8.
- Radius 4 (controls), 8 (popovers). No shadows except popovers: `0 8px 24px #0006`.
- Separators are 1 px `--line`.

## Icons

Lucide, 14 px, stroke 1.5, `currentColor`. Nothing else.

## Motion

80–120 ms, `ease-out`, only for appearance of popovers and the active indicator. Never on terminal content.

## Signature

**The pearl line**: a 1 px hairline with a nacre sheen (`#9ED8CF → #C8C2E8 → #E9DCC6`) under the active tab and along the active pane edge. It is the only gradient in the app.

## Text rules

No descriptions under self-explanatory options, no onboarding, no emojis. Errors: what happened + how to fix, one line.
