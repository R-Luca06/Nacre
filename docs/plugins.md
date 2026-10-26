# Plugins

A plugin is one ES module in `~/.config/nacre/plugins/` (`name.js` or `name/index.js`). It loads at startup and reloads when the file changes. Turn plugins on or off in Settings → Plugins.

```js
export default function activate(nacre) {
  nacre.registerSegment({
    id: "weather", // add "plugin.weather" to a status bar zone
    interval: 600_000,
    compute: async () => ({ text: await nacre.runScript("curl -s 'wttr.in?format=%t'") }),
  });

  nacre.registerCommand({
    id: "deploy",
    label: "Deploy",
    keys: ["ctrl+cmd+d"],
    run: () => nacre.sendText("make deploy"),
  });

  nacre.registerTrigger({
    regex: "Server running on (\\S+)",
    run: ([, url]) => nacre.notify("Server up", url),
  });

  nacre.onCommandFinished(({ command, exitCode, duration }) => {
    /* … */
  });

  return () => {
    /* optional cleanup */
  };
}
```

| Method                                                                           |                                                                                                                            |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `registerSegment({ id, interval?, compute(ctx), click?(ctx) })`                  | `ctx`: `cwd`, `process`. Return `{ text, level? }` or `null`. `level`: `normal`, `dim`, `accent`, `ok`, `warn`, `danger`.  |
| `registerCommand({ id, label, keys?, run })`                                     | Shows in the palette, the menu shortcuts and the shortcut editor.                                                          |
| `registerTheme(theme)`                                                           | Same fields as a theme file: `name`, `background`, `foreground`, `palette` (16), optional `cursor`, `selection`, `accent`. |
| `registerTrigger({ regex, run(match, line, paneId) })`                           | Runs on each new output line that matches.                                                                                 |
| `onCommandFinished(cb)`                                                          | Needs shell integration.                                                                                                   |
| `notify(title, body?)`, `sendText(text)`, `activePane()`, `runScript(cmd, cwd?)` |                                                                                                                            |

Plugins run with the app's permissions. Only install code you trust.
