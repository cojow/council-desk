# Getting started

## Your API key

Council Desk supports Anthropic API keys. Create one in the [Claude Console](https://platform.claude.com/). Usage is billed to that Console account, so set a spending limit there if you'd like one.

There are two ways to give the app your key:

1. **Paste it into the first-run screen or Settings → Anthropic API key.** It's stored encrypted in the app's settings folder, with the encryption key held in your macOS Keychain. The app gives it only to Claude Code. To remove it, use **Remove saved key** in Settings.
2. **Set `ANTHROPIC_API_KEY` in the environment you start the app from**, for example `ANTHROPIC_API_KEY=... npm start`. This takes priority over a saved key. Setting it in your shell profile doesn't reach an app opened from the Dock. A key set this way is left as you set it up, so everything started from that environment can read it.

The app's terminal doesn't get a saved key. To run `claude` there, set up its authentication in your shell as you would anywhere else.

Claude Code passes its environment on to the commands, hooks and connectors it starts, so those can read your key, whichever way you provide it. A command Claude runs could print it, or a malicious file could try to trick Claude into sending it somewhere, so review what you approve and consider a key with a low spending limit. Claude Code's [`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`](https://code.claude.com/docs/en/env-vars) strips credentials from those processes, but in the current engine it also forces every session to the default permission mode, so Auto-accept, Plan and unattended scheduled runs won't behave as selected. Council Desk leaves that setting to you.

The Browser pane holds back the values of password, card and one-time-code fields from Claude, but a page that shows such a value in its visible text or console can still reveal it.

Never commit your key or paste it into a chat.

## Other ways of authenticating

API keys are the supported setup. Council Desk leaves Claude Code's existing authentication and provider configuration (such as Amazon Bedrock or Google Vertex AI) unchanged, so billing depends on the configuration actually in use. The sidebar footer shows which one that is. Council Desk doesn't offer or manage Claude account sign-in.

## Which Claude Code settings it uses

The app reads the same files as Claude Code: `~/.claude`, or the folder in `CLAUDE_CONFIG_DIR` if you set that. So your `CLAUDE.md`, permission rules, commands and MCP servers apply here as well.

## Permissions

Before Claude first starts in a folder, the app asks whether you trust it, unless you've already trusted it in Claude Code. A folder's settings can run commands, so trust only folders you know. Connectors shared in a project's `.mcp.json` stay off until you approve them in the app, and approve them again if their configuration changes.

Each session has a permission mode, like Claude Code. Start with the default, which asks before edits and commands.

## Updating

There is no automatic updater. To update:

```bash
git pull
npm install
npm run dist
```

To get a newer Claude Code engine:

```bash
npm install @anthropic-ai/claude-agent-sdk@latest
npm run smoke
```

Then run `npm run dist` again if you use the built app. `npm run smoke` runs a couple of very short real turns to check the engine works, which costs a tiny amount. It can't read a key saved in the app, so set `ANTHROPIC_API_KEY` for it. It uses whichever authentication Claude Code selects.

## Connecting the message board (optional)

If you use [council-board](https://github.com/cojow/council-board), turn on **Start helper sessions** in Settings. The app finds its name in your `agents.json` by matching your Claude Code config folder, or from `BOARD_AGENT`. When another agent asks for help, the app asks you before starting a helper session. It starts nothing in a folder you haven't trusted.

## Removing it

Delete the app and the source folder. The app's own settings are in `~/Library/Application Support/Council Desk`. Your sessions belong to Claude Code and stay in its folder.
