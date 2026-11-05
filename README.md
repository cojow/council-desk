# Council Desk

A desktop app for working with [Claude Code](https://code.claude.com/docs/en/overview) on your Mac: sessions in a sidebar, readable transcripts, a changes pane, a built-in terminal and a browser Claude can drive.

Council Desk is an independent, unofficial project. It is not affiliated with, endorsed by or sponsored by Anthropic. It runs the unmodified Claude Code engine through Anthropic's [Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview).

It can also join [council-board](https://github.com/cojow/council-board), a local message board that lets your AI coding agents share work and ask each other for help. Each works without the other.

> Status: 0.1.0, an early preview. Source only, for Apple Silicon Macs. You build it yourself; there are no downloads.

## What you need

- A Mac with Apple Silicon
- Node 22.12 or newer, and the Xcode Command Line Tools (for `node-pty`)
- An [Anthropic API key](https://platform.claude.com/). Usage is billed to your own Console account, by the token. The app adds no charges.

## Build and run

```bash
git clone https://github.com/cojow/council-desk.git
cd council-desk
npm install
npm start
```

The first run asks for your API key, or uses `ANTHROPIC_API_KEY` if it's set in the environment you start the app from. To build an app you can keep in `~/Applications`:

```bash
npm run dist
```

See [docs/getting-started.md](docs/getting-started.md) for the key, permissions and updates.

## What's in it

- **Sessions:** a searchable sidebar with pins, archiving, split view and rewind to an earlier message, undoing Claude's file changes.
- **Permissions:** the same modes and allow, ask and deny rules as Claude Code, with a screen for managing the rules and a trust prompt for new folders.
- **Your project at a glance:** a changes pane with diffs, a file viewer, `@` file suggestions, optional branch-per-session worktrees, and a terminal per project.
- **A browser pane** Claude can navigate, read and click in. Downloads, camera, microphone and location are blocked.
- **Your setup:** saved prompts, a memory editor for `CLAUDE.md`, MCP connectors, scheduled tasks that run while the app is open, themes (including your own) and voice settings.
- **Optional message board:** connect to [council-board](https://github.com/cojow/council-board) so your AI agents can ask this app for help. It's off by default, and asks you before starting anything.

## Privacy and safety

- Your prompts and the code Claude reads go to Anthropic, the same as using Claude Code. See Anthropic's [data usage docs](https://code.claude.com/docs/en/data-usage).
- The app has no telemetry, account or server of its own. Other things you use through it can contact the internet: sites in the Browser pane, MCP connectors, commands Claude runs, and the engine version check when you click it.
- A key you save in the app is stored encrypted, with the encryption key held in your macOS Keychain. The app gives it only to Claude Code, so the app's terminal, git and other helpers don't get it. Claude Code passes its environment on to the commands, hooks and connectors it starts, so those can read the key. [getting-started](docs/getting-started.md#your-api-key) explains the setting that changes this, and what it costs.
- A key in your own environment is left as you set it up, so everything started from that environment can read it.
- Claude can edit files and run commands within the permission mode you choose. Read [SECURITY.md](SECURITY.md).

## Licence

Council Desk's own code is [MIT](LICENSE). The Claude Agent SDK and Claude Code are proprietary software from Anthropic under their own terms, and aren't covered by that licence. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), especially before giving a build to someone else.

Claude and Claude Code are trademarks of Anthropic PBC.
