# Install on Windows

WowGrok needs a windowed or borderless WoW client, Node.js 22.2 or newer, and a logged-in `grok` CLI if you want real answers. Tests do not need the game or a login.

## 1. Get the files

```
git clone https://github.com/hydrolive/wow-grok
cd wow-grok
```

## 2. Point it at the game and a project

```
node setup.js --project "C:\path\to\the\project\you\want\to\work\on"
```

Pass `--wow "D:\Games\World of Warcraft\_forever_"` if setup cannot find the client. Pass `--account ACCOUNT_NAME` when more than one account folder exists.

`setup.js` copies `addon/WowGrok` into `Interface\AddOns\WowGrok`, writes `bridge/config.json`, and generates the slot pool plus signal wavs. That is thousands of tiny files. The client only discovers addon files at launch, so they have to exist up front.

## 3. Restart WoW and enable the addon

Fully quit the client. A `/reload` is not enough the first time. On the AddOns screen enable **WowGrok** and leave the **WowGrok slot** entries enabled.

## 4. Start the companion

```
npm start
```

That runs in the current terminal. `bridge\start.ps1` is the same companion with a restart loop. `bridge\start-window.cmd` opens its own window so Ctrl+C is not swallowed by a batch prompt.

Only one companion can run. A second start exits with "already running".

From another project folder, after `npm link` in this repo:

```
cd C:\path\to\realms
wow-grok
```

Chats that have not chosen a folder work in `realms`. `wow-grok --project C:\other` names it explicitly. `npm start` inside this repo uses `defaultCwd` from `bridge/config.json`.

## 5. In game

`/wow-grok` or `/grok` opens the window. Until the light is green, the button says **Connect**. Start the companion, click Connect, then type and press Enter. The reply pings in the game chat. Shift-click an item, spell, quest, or talent while the box is focused to attach it.

## If something is quiet

- **Connect says nothing and the light stays red.** Is the companion running? Is the game window on screen and not minimized? Exclusive fullscreen blocks capture. The companion log shows `message chat ...` when a strip decodes, and capture prints `strip seen but rejected` when a frame fails the checksum.
- **The log says done but the window does not.** `/wow-grok slots`. If the pool is empty, `/wow-grok reload` frees it and reads `Inbox.lua`.
- **Reply slots not installed.** `node bridge/install-slots.js`, then fully restart WoW.
- **Chats vanished after a restart.** Forever can wipe SavedVariables. The companion keeps `transcripts.json` and sends the chats back on the next hello.
- **`/wow-grok diag` says signals are off.** Readiness wavs are disabled for this session. Replies still arrive on the slot timer. If a valid wav reports as unplayable, WoW has not been restarted since the files were created.
- **`grok` is not found.** Set `grokPath` in `bridge/config.json` to the full path of `grok.exe` or `grok.cmd`.

## Develop

```
npm install
npm test
```

`npm test` uses the echo backend. It does not launch WoW and it does not log into Grok.
