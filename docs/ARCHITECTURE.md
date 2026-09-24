# Architecture

WowGrok is two processes on one Windows machine. The WoW addon cannot open a socket, so the companion never talks to it directly.

```
WoW client (Lua sandbox)                         companion (Node)
┌─────────────────────────────┐                  ┌──────────────────────────────┐
│ WowGrok addon               │  pixels          │ capture.ps1                  │
│ draws a 4×4 cell strip ─────┼─────────────────▶│ decodes the top-left corner  │
│                             │                  │ jobs: session, chat, id, cwd │
│                             │                  │        │                     │
│                             │                  │        ▼                     │
│                             │                  │ grok -p / echo / xAI API     │
│ LoadAddOn(WowGrok_Sxxx)     │  Inbox.lua       │        │                     │
│ ◀───────────────────────────┼──────────────────┤ writes every slot + Inbox   │
│ PlaySoundFile(sig/ack/…)    │  wav files       │ raises a silent wav          │
└─────────────────────────────┘                  └──────────────────────────────┘
```

The addon only uses documented UI APIs. The companion screen-captures the player's own window and writes ordinary files. It does not read game memory, inject code, or generate input.

## Sandbox

Forever SavedVariables are wiped on a cold start, so the companion is the source of truth. Addons can still:

1. Draw pixels. The companion captures them.
2. Load a file that already existed at client launch, the first time that file is used. Addon Lua is read again on `/reload`. Files created after launch are invisible until a full restart.
3. Write SavedVariables, but only on `/reload` or logout. `ReloadUI()` only works from a key or click.

`setup.js` therefore creates all 200 slot addons and every signal wav before the client is started.

## Outbound pixels

`Codec.lua` builds a byte frame:

```
[0xC7 0x1A] [id hi, lo] [len hi, lo] [payload] [Fletcher-16 s1, s2]
```

The checksum covers the id, the length, and the payload (mod 255, not including the magic). Bytes are packed MSB-first into 3-bit cells. Each cell is a 4×4 square whose red, green, and blue channels are fully on or off, so gamma and contrast do not create extra levels. 200 cells per row, at most 48 rows, anchored to the top-left of `UIParent`. The strip's scale is `(768 / physicalHeight) / UIParent:GetEffectiveScale()` so one cell lands on one physical pixel. Capacity is 3200 payload bytes.

The payload is records separated by `0x1E`. Fields are separated by `0x1F`:

```
session  chat  id  cwd  flags  name  [context]  text
```

The context field is present only when flags contain `c`, so a separator inside the text cannot be mistaken for it.

| Flag | Meaning |
| --- | --- |
| `n` | Start a fresh Grok session |
| `h` | Hello. No prompt |
| `d` | This chat was deleted. Drop its transcript and session |
| `c` | A context field follows the name. Empty context clears the stored one |
| `r=N` | Resend attempt. Changes the bytes so a running capture emits again |
| `allow=A,B` | Permission rules to add before this run |

The strip stays up until the ack wav plays, or 40 seconds pass. It is shown again up to three times, then the addon writes an outbox and arms a `/reload` on the next key.

`capture.ps1` finds the game window, copies the client-area top-left (DPI-aware GDI), samples the center of each cell, and prints one JSON line per new frame. Exclusive fullscreen blocks GDI. Windowed and borderless work. HDR was not tested.

## Inbound slots

`install-slots.js` creates `WowGrok_S001` … `WowGrok_S200`, each `LoadOnDemand` with one `Inbox.lua`. The companion does not know which slot the game will load next, so every publish writes the same `WowGrok_SlotData` into all of them and into `WowGrok/Inbox.lua` (the `/reload` copy).

```lua
WowGrok_SlotData = {
  ts = "...", now = <unix seconds>, cwd = "<default folder>",
  replies = {
    { chat = "1", id = 12, status = "working"|"done"|"error",
      text = "...", cwd = "...", session = "<grok session>",
      denied = { "WebSearch" } },
  },
  restore = { token = "...", chats = { ... } }, -- only after a saved-data reset
}
```

After a send, the addon loads a fresh slot at 5, 10, 16, 24, 34, 46, 60, 80, 100, 130, 160, 200, 240, and 300 seconds, then every 60 seconds. A `sig` wav loads one immediately. `now` tells the addon when the companion last wrote. The first time a session token is seen, the next publishes that actually have history include a restore bundle (up to 16 chats, 40 messages each). The addon imports it only when its own history is empty.

## Signals

`PlaySoundFile` returns whether a wav will play. An empty file will not. A valid silent wav will. A file the client has not loaded yet is read fresh, and once it has played it stays playable for the rest of the process.

| Files | Raised when |
| --- | --- |
| `sig/NNN.wav` | Reply NNN is in the slots. Load one now |
| `ack/NNN.wav` | Message NNN was decoded. Take it off the strip |
| `act/NNN/kk.wav` | The k-th action on message NNN |
| `presence/kkkk.wav` | Every 30 seconds while the companion runs. The next 50 files are kept empty |
| `ctl/empty.wav`, `ctl/valid.wav` | Never change. Login checks that empty is silent and valid plays |

`NNN = ((id - 1) mod 200) + 1`. If that file is already playable before the addon sends (the counter wrapped, or the channel lies), the addon ignores it and uses slot polls. With the sound channel off, replies still arrive on the schedule, and an idle poll every 10 minutes keeps the status light honest. Beats make 90 seconds "quiet" and 5 minutes "down". Without beats those windows are 12 and 22 minutes. `/wow-grok diag` shows which mode is active.

## Companion

`bridge/index.js` owns I/O. `bridge/protocol.js` is pure and unit-tested. `bridge/grok-backend.js` is the model side.

Backends:

| Name | Role |
| --- | --- |
| `echo` | Tests. No Grok login, no network |
| `cli` | Default. `grok -p PROMPT --cwd DIR -s UUID` or `-r UUID --output-format streaming-json --rules "..."` |
| `api` | Optional. `POST https://api.x.ai/v1/responses` when `XAI_API_KEY` is set |

There is no ACP (`grok agent stdio`) in v1. `alwaysApprove` defaults to false, so the CLI is not passed `--always-approve`. A denial becomes an **Allow & retry** button; the accepted rules are stored and passed as `--allow`. `--rules` is the primer plus the latest game context. A prompt that would blow the Windows command-line limit is passed with `--prompt-file` instead of `-p`.

One Grok run per chat, up to `maxParallel` at once. Sessions are UUIDs stored per chat id and folder. A folder change or `/wow-grok reset` starts a new `-s` session. Tool events in the streaming JSON become progress lines and `act` wavs. The final text is the reply.

Inputs are capture lines, the SavedVariables outbox, and `--inject` for tests. Message ids are deduped per addon session token. A duplicate only rewrites the ack.

`npm start` runs the companion in the current terminal. `bridge/start.ps1` restarts it after a crash. Exit code 2 means another instance already holds the lock.

## Addon

| File | Role |
| --- | --- |
| `Codec.lua` | Frame encoder |
| `Context.lua` | `GameContext` and tooltip expansion |
| `WowGrok.lua` | Chats, strip, signals, slots, commands |
| `UI.lua` | Panel, bubbles, mini bar, popups |
| `Slash.lua` | `/wow-grok`, `/grok`, `/ai`, and the `/r` hook |
| `Inbox.lua` | Placeholder the companion overwrites |
| `bindings.xml` | Toggle / check-reply hotkey |

`GameContext()` is capped at about 1200 bytes on hello and 800 bytes beside a message. It asks, each call inside `pcall`, for client, character, position, money, professions, quests, equipment, bags, group, and target. Sections drop from the end of that list until the cap fits. Shift-click into the focused WowGrok box inserts an item, spell, quest, or talent link. On send, each link becomes `[Name]` and the tooltip is appended under `--- Linked from the game ---`.

The window is a dark vanilla frame: chat list, bubbles, edit box, status light, mini bar, Connect, and Allow & retry. Esc or the minimize button collapses it to the mini bar. Connect sends hello and leaves a typed draft in the box.

## Limits

- 200 slots per UI session. `/wow-grok reload` frees them.
- A signal file that has already played cannot be lowered until the client process exits.
- Messages longer than 3200 bytes are refused.
- Published replies are capped around 60 KB. Transcripts keep 4000 characters; restore sends the last 40 messages at 2000 characters.
- Windows and NTFS only.
