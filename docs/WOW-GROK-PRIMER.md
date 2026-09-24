# WowGrok primer

Short reference for addons and macros on this client (TOC 16001). The companion appends it to `--rules` when `primerFile` is set. Check anything uncertain against the live UI source before shipping it.

Sandbox: addon Lua cannot open sockets, read arbitrary files, or run programs. No `io`, no `os.execute`, no network. Draw with frames, react to events, and save data in SavedVariables (flushed on `/reload` or logout). `ReloadUI()` needs a hardware event.

TOC: `## Interface: 16001`, then `## Title`, `## Notes`, `## Version`, `## SavedVariables: Name`. List files after the headers. `## LoadOnDemand: 1` loads only when `C_AddOns.LoadAddOn` or `LoadAddOn` is called. New files must exist before the client launches.

Events: one frame, `RegisterEvent`, handle `OnEvent`. Wrap every API in `pcall`. Names differ between classic and the Forever client (`C_Container` vs `GetContainerItemInfo`, `C_QuestLog` vs `GetQuestLogTitle`, `C_Map` vs `GetPlayerMapPosition`).

Frames: `CreateFrame`, `SetPoint`, `SetSize`, textures via `SetColorTexture`. Prefer explicit textures over `SetBackdrop`. Font: `Fonts\\FRIZQT__.TTF`. `UISpecialFrames` closes a named frame on Esc. Do not click secure buttons or cast spells from addon code. Macros stay under 255 characters unless the client raises the cap. `/click` and `SecureActionButtonTemplate` are for the player, not for unsecured addon clicks.

Links look like `|Hitem:123|h[Name]|h`. Tooltips: hidden `GameTooltip`, `SetHyperlink`, read `TextLeft` lines.

WowGrok itself is a chat window. Do not turn it into a bot, a memory reader, or an input generator. Write code the player can read and run on purpose.
