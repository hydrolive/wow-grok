# WowGrok

In-game addon plus a local companion. The player types `/grok` or `/wow-grok`. Pixels go out, load-on-demand slots and wavs come back. The companion calls Grok. It is not a bot.

## Read first

- `docs/ARCHITECTURE.md` for the wire format and process split
- `docs/CONFIGURATION.md` for backends and flags
- `docs/TOS-AND-SAFETY.md` before changing anything that touches the game

## Check

```
npm test
```

Tests use the echo backend. They must pass without WoW and without a Grok login. Do not require `XAI_API_KEY`.

## Do not

- Copy wow-claude file-for-file. Names are WowGrok / `WowGrok_SlotData` / `WowGrok_S001`.
- Add ACP (`grok agent stdio`) in v1.
- Default `alwaysApprove` to true or pass `--always-approve` unless config says so.
- Read process memory, generate input, or automate gameplay.
- Claim affiliation with Blizzard or xAI.

## Map

| Path | Role |
| --- | --- |
| `addon/WowGrok/Codec.lua` | Pixel encoder |
| `addon/WowGrok/Context.lua` | Game context and link tooltips |
| `addon/WowGrok/WowGrok.lua` | Transport and commands |
| `addon/WowGrok/UI.lua` | Panel |
| `addon/WowGrok/Slash.lua` | Slash commands and `/r` |
| `bridge/protocol.js` | Pure codec, Lua slots, argv |
| `bridge/grok-backend.js` | echo, cli, api |
| `bridge/index.js` | Companion |
| `bridge/capture.ps1` | Screen decoder |
| `bridge/install-slots.js` | Slot pool and wavs |
| `setup.js` | Copy addon, write config, build slots |
