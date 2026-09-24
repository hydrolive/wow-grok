Read these first:
https://github.com/chelinho139/wow-claude
https://github.com/chelinho139/wow-claude/blob/main/docs/ARCHITECTURE.md
https://docs.x.ai/build/overview

Build Wow-Grok in the current directory. Grok-native counterpart of wow-claude. Do not copy that repo file-for-file. Rename everything WowGrok.

In-game WoW Forever addon + local companion. Player types /grok or /wow-grok, asks about quests, inventory, gear, zone, or sends a coding task to Grok Build CLI, keeps playing, gets pinged when the reply lands. No alt-tab. No /reload per message. Shift-click items/spells/quests/talents into the box; expand tooltips on send.

Sandbox: addons have no network and cannot read arbitrary files. They can draw pixels, play sounds, and LoadAddOn a LoadOnDemand addon. Forever SavedVariables wipe on cold start — companion is source of truth.

IPC:
- OUT: 4x4 px 3-bit color cells, top-left. Magic 0xC7 0x1A, length, Fletcher-16. Fields 0x1F-separated: session, chat, id, cwd, flags, name, optional context, text.
- IN: 200 LoadOnDemand slots WowGrok_S001..S200 + WowGrok/Inbox.lua. Same WowGrok_SlotData on every slot (ts, now, replies[{chat,id,status,text,cwd,session,denied}], restore).
- SIGNAL: empty vs valid wavs via PlaySoundFile (sig, ack, act, presence, ctl). Fallback slot poll, then /reload mode.
Windows NTFS, windowed or borderless. One companion instance.

Grok CLI:
grok -p PROMPT --cwd DIR -s UUID -r UUID --output-format streaming-json --rules "primer + game context"
Backends: echo (tests), cli (default), api (optional XAI_API_KEY). No ACP in v1. alwaysApprove default false.

GameContext() cap ~1200 hello / ~800 with message: client, character, position, money, professions, quests, equipment, bags, group, target. pcall every API.

UI: vanilla frames, dark panel, chat list, bubbles, edit box, status light, mini bar, Connect, Allow & retry. Commands: /wow-grok /grok /ai /r plus new, chat, cd, reset, context, rename, delete, clear, echo, longchat, bind, cancel, resend, reload, mode, diag, slots, about, help.

Layout: README LICENSE CHANGELOG CONTRIBUTING AGENTS.md package.json setup.js addon/WowGrok/{WowGrok.toc,WowGrok.lua,Codec.lua,Context.lua,UI.lua,Slash.lua,Inbox.lua,bindings.xml} bridge/{index.js,protocol.js,grok-backend.js,capture.ps1,install-slots.js,config.example.json,start.ps1,start-window.cmd} docs/{ARCHITECTURE.md,INSTALL-WINDOWS.md,CONFIGURATION.md,WOW-GROK-PRIMER.md,TOS-AND-SAFETY.md} tests/

setup.js --project DIR [--wow CLIENT] copies addon, writes config, generates slots+wavs. npm start runs companion. npm test uses echo backend and must pass without WoW or grok login.

TOC 16001. No bots, no memory reads, no input generation. Credit wow-claude as inspiration. Not affiliated with Blizzard or xAI.

Implement in this order and finish the tree: docs -> protocol tests -> install-slots -> Lua addon -> companion/backends -> setup.js -> gitignore + npm test green.
