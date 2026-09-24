# Contributing

WowGrok is a WoW addon plus a Node companion. The addon cannot reach the network, so behavior has to be tested through the pure protocol, an echo backend, and a scripted Lua client.

## Layout

- `addon/WowGrok` is loaded by the game. `Codec.lua` and `Context.lua` avoid being tied to one UI file so they can run under the test stub.
- `bridge/protocol.js` has no I/O. `bridge/grok-backend.js` is echo, CLI, or API. `bridge/index.js` captures, publishes, and locks a single instance.
- `docs/` is the contract. If a constant in `WowGrok.lua` (`SLOTS`, `ACT_MAX`, `PRESENCE_MAX`) changes, change `bridge/config.example.json` and the docs with it.

## Tests

```
npm install
npm test
```

Node 22.2 or newer. The suite does not launch WoW and does not log into Grok. `capture.ps1 -TestImage` decodes a bitmap. The addon test loads the Lua files in Fengari against `tests/wow_stub.lua`.

Do not add gameplay automation, memory reads, or input generation. See `docs/TOS-AND-SAFETY.md`.

## Conventions

- Keep the wire format stable: magic `0xC7 0x1A`, 16-bit id, 16-bit length, payload, Fletcher-16, 3-bit cells, `0x1F` fields, `0x1E` records.
- Slot files assign `WowGrok_SlotData` and nothing else the addon has to guess.
- `alwaysApprove` stays false unless a config value says otherwise. Do not pass `--always-approve` by default, and do not add an ACP backend in this version.
- Comments explain a constraint the next reader would otherwise rediscover. They do not narrate the change.
