# CLI

`nacre` ships inside the app (`Nacre.app/Contents/MacOS/nacre`); shells started by Nacre know it as `$NACRE_BIN`. Link it into your PATH to use it anywhere:

```sh
ln -s /Applications/Nacre.app/Contents/MacOS/nacre /usr/local/bin/nacre
```

|                                                     |                                  |
| --------------------------------------------------- | -------------------------------- |
| `nacre new-tab [--cwd DIR] [--cmd CMD]`             |                                  |
| `nacre split [right\|down] [--cwd DIR] [--cmd CMD]` |                                  |
| `nacre send-text [--pane ID] [--enter] TEXT`        |                                  |
| `nacre notify TITLE [BODY]`                         |                                  |
| `nacre claude-event`                                | Claude Code hook (JSON on stdin) |
| `nacre statusline [--wrap CMD]`                     | Claude Code status line          |
| `nacre ping`                                        |                                  |
