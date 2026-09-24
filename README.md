# WowGrok

Chat with local [Grok](https://docs.x.ai/build/overview) sessions from inside World of Warcraft. Type `/grok` or `/wow-grok`, ask about a quest, your bags, your gear, or the zone, or hand Grok a coding task. Keep playing. The reply pings you in game. No alt-tab. No `/reload` per message.

Shift-click an item, spell, quest, or talent into the box. The tooltip is expanded when you send. Several chats can run at once, each with its own folder and Grok session. A status light shows whether the companion is up. **Allow & retry** appears when a tool was denied.

Nothing here injects code, reads game memory, or generates input. The addon uses documented APIs. The companion reads the corner of your own window and writes ordinary files. It is not affiliated with Blizzard or xAI. Inspired by [wow-claude](https://github.com/chelinho139/wow-claude).

## How it works

WoW addons cannot open sockets. Two doors remain. **Out:** the addon draws the message as 4×4 colored cells in the top-left of the screen, and the companion captures that corner. **In:** 200 load-on-demand slot addons (`WowGrok_S001`–`WowGrok_S200`) read `Inbox.lua` from disk at the moment they load. Empty and valid wavs tell the addon whether a reply is ready without spending a slot. Details are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requirements

- Windows, NTFS
- World of Warcraft, windowed or borderless (tested target TOC 16001). Exclusive fullscreen blocks capture
- [Node.js](https://nodejs.org) 22.2 or newer
- [Grok Build](https://docs.x.ai/build/overview) installed and logged in (`grok` works in a terminal) for the default CLI backend

## Install

Step by step: [docs/INSTALL-WINDOWS.md](docs/INSTALL-WINDOWS.md).

```
node setup.js --project "C:\path\to\your\project"
npm start
```

Fully quit and relaunch WoW once so it sees the new addon files, enable **WowGrok**, then `/wow-grok`.

## Use

| Command | What it does |
| --- | --- |
| `/wow-grok`, `/grok` | Toggle the window. Other text sends a message |
| `/ai <text>` | Send from the normal chat box |
| `/r <text>` | Reply to Grok when Grok was the last to message you |
| `/wow-grok new [name]` | New chat, new Grok session |
| `/wow-grok chat <n\|name>` | Switch chats |
| `/wow-grok cd [folder]` | Folder this chat works in |
| `/wow-grok reset` | Fresh Grok session, keep the transcript |
| `/wow-grok context [on\|off]` | Show or toggle character context |
| `/wow-grok rename`, `delete`, `clear` | Manage the current chat |
| `/wow-grok echo full\|short\|off\|<chars>` | How much of a reply is printed in game chat |
| `/wow-grok longchat on\|off` | Let the game chat box take 4000 characters |
| `/wow-grok bind <key>` | Hotkey: check for a reply, or toggle the window |
| `/wow-grok cancel`, `resend`, `reload` | Stop waiting, show the strip again, reload the UI |
| `/wow-grok mode auto\|reload` | Pixel and slots, or a reload per step |
| `/wow-grok diag`, `slots` | Transport diagnostics |
| `/wow-grok copy`, `about`, `help` | Copy the last reply, credits, command list |

`/wow-grok context` shows the lines Grok is given: client, character, position, money, professions, quests, equipment, bags, group, and target. Hello sends about 1200 bytes. A message sends about 800, and only when it changed. Every API is called inside `pcall`.

The companion's default backend is the Grok CLI:

```
grok -p PROMPT --cwd DIR -s UUID --output-format streaming-json --rules "primer + game context"
```

Later messages resume with `-r UUID`. `alwaysApprove` defaults to false. Set `XAI_API_KEY` and `"backend": "api"` to call the xAI API instead. Tests use the echo backend and do not need a login. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Documentation

- [docs/INSTALL-WINDOWS.md](docs/INSTALL-WINDOWS.md)
- [docs/CONFIGURATION.md](docs/CONFIGURATION.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/WOW-GROK-PRIMER.md](docs/WOW-GROK-PRIMER.md)
- [docs/TOS-AND-SAFETY.md](docs/TOS-AND-SAFETY.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)

## Credits

- [chelinho139/wow-claude](https://github.com/chelinho139/wow-claude) is the inspiration for the pixel strip, slot pool, and signal wavs.
- [0xInuarashi/wow-forever-codex](https://github.com/0xinuarashi/wow-forever-codex) measured the client's file-loading rules.

## License

MIT. See [LICENSE](LICENSE).
