# Terms and safety

WowGrok is a chat window between the player and a local Grok companion. It is not a bot. It does not read process memory, scan other players, inject code, or generate keyboard or mouse input. Every message is typed or shift-clicked by the player. The companion answers, and the player decides what to do with the answer.

The addon uses documented frame, event, tooltip, and sound APIs. The companion captures the top-left of the player's own game window because that is where the addon draws its message, and it writes reply files the game loads on purpose. One companion instance runs at a time. `alwaysApprove` defaults to false so tool calls are not silently accepted. Allow & retry adds a rule only after a click.

This project is not affiliated with Blizzard Entertainment or xAI. World of Warcraft is Blizzard's. Grok is xAI's. Using a third-party addon can still conflict with a game's terms even when it does not automate play. Read the terms for the client you run, and stop if they forbid this kind of tool. Nothing here is designed to evade detection.

`XAI_API_KEY`, if you set it for the optional API backend, stays in your environment. The companion does not write it into config, logs, or slot files. Screen captures and transcripts stay on this machine (`bridge/state.json`, `bridge/transcripts.json`, the companion log).

Do not point the companion at an account or window that is not yours.
