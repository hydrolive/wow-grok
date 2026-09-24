# Configuration

`setup.js` writes `bridge/config.json` from `bridge/config.example.json`. Restart the companion after editing it. The file is machine-specific and gitignored.

## Keys

| Key | Meaning |
| --- | --- |
| `addonDir` | `Interface\AddOns` of the client |
| `inboxFile` | `WowGrok\Inbox.lua`, rewritten on every publish |
| `savedVariablesFile` | `WTF\Account\...\SavedVariables\WowGrok.lua`, polled for the reload outbox |
| `defaultCwd` | Folder for chats that have not used `/wow-grok cd` |
| `tocInterface` | TOC interface version written into slot addons. `16001` |
| `slots` | Load-on-demand pool size. Must stay 200 unless `WowGrok.SLOTS` in `WowGrok.lua` changes with it |
| `actMax` | Action wavs per message. Must match `WowGrok.ACT_MAX` |
| `presenceMax` | Presence wavs. Must match `WowGrok.PRESENCE_MAX` |
| `presenceIntervalMs` | How often a presence wav is raised. Default 30000 |
| `presenceLookahead` | How many presence files ahead stay empty. Default 50 |
| `maxParallel` | Chats running Grok at once. Default 3 |
| `capture.enabled` | `false` skips the screen capture |
| `capture.processName` | Game exe without `.exe`. Setup sets this from the client |
| `capture.cellPx`, `cellsPerRow`, `maxRows`, `intervalMs` | Must match the addon strip |
| `backend` | `cli` (default), `echo`, or `api` |
| `grokPath` | CLI executable. Default `grok` |
| `model` | Passed as `grok -m` when set |
| `alwaysApprove` | Default `false`. `true` passes `--always-approve` |
| `permissionMode` | Passed as `--permission-mode`. Default `default` |
| `allowedTools` | Rules passed as repeated `--allow`. Allow & retry appends here |
| `gameContext` | `false` never puts character context in `--rules` |
| `primerFile` | Primer appended into `--rules`. Default `docs/WOW-GROK-PRIMER.md`. `""` disables it |
| `contextHelloMax`, `contextMessageMax` | Document the addon caps (1200 and 800). The addon enforces them |
| `apiBase` | Default `https://api.x.ai/v1` |
| `apiModel` | Default `grok-4.7` |
| `pollMs` | SavedVariables poll. Default 750 |
| `progressWriteMs` | Minimum gap between working-status publishes. Default 3000 |
| `timeoutMs` | Kill a CLI run after this. Default 30 minutes |

## Backends

`cli` runs:

```
grok --no-auto-update --no-alt-screen -p PROMPT --cwd DIR -s UUID --output-format streaming-json --rules "primer + game context"
```

A later message in the same chat and folder uses `-r UUID` instead of `-s UUID`. Those two flags are never combined. `--always-approve` is omitted unless `alwaysApprove` is true.

If the prompt plus rules would exceed the Windows command line, the prompt is written to a temp file and passed with `--prompt-file`. The rules still go in `--rules`.

`api` calls `POST /v1/responses` with `instructions` set to the same rules text and `previous_response_id` set when resuming. It requires `XAI_API_KEY` in the environment. No key, no network call: the chat gets an error reply.

`echo` returns `Echo: <prompt>` and never starts Grok. `[[deny:ToolName]]` in the prompt produces an Allow & retry denial unless that rule is in `allow`. `[[error]]` produces an error status. `npm test` forces this backend.

`WOWGROK_BACKEND=echo|cli|api` overrides `backend` for one run.

There is no ACP backend in v1.

## Command line

| Flag | Where | Meaning |
| --- | --- | --- |
| `--project DIR` | setup and companion | Default working folder |
| `--wow CLIENT` | setup | WoW client folder |
| `--account NAME` | setup | `WTF\Account` folder |
| `--config FILE` | setup and companion | Config path. Default `bridge/config.json` |
| `--slots N`, `--act-max N`, `--presence-max N` | setup, only when writing a new config | Smaller pools for tests |
| `--backend echo\|cli\|api` | companion | One-shot backend |
| `--addon-dir DIR` | companion | Override `addonDir` |
| `--inject JSON` or `--inject @file` | companion | One job, or a capture line `{id, text}` |
| `--once` | companion | Handle `--inject` and exit |

## Game commands

`/wow-grok` and `/grok` toggle the window. With any other text that is not a subcommand, they send that text. `/ai <text>` always sends. `/r` sends only when Grok was the last speaker; otherwise the game's whisper reply is left alone.

Subcommands: `new`, `chat`, `cd`, `reset`, `context`, `rename`, `delete`, `clear`, `echo`, `longchat`, `bind`, `cancel`, `resend`, `reload`, `mode`, `diag`, `slots`, `copy`, `about`, `help`.

`/wow-grok cd` with no folder returns to `defaultCwd`. A relative path is relative to that default. `~` is the home directory. Changing folder starts a fresh Grok session on the next message.

`/wow-grok mode reload` skips pixels and slots. The next keypress reloads the UI, which writes the outbox. The reply is in `Inbox.lua` on the following reload.

`/wow-grok echo` takes `full` (4000 characters), `short` (200), `off`, or a number.
