# Security policy

## Supported versions

Only the latest release gets security fixes. Council Desk is an early preview.

## Reporting a vulnerability

Please report it privately through GitHub: on this repository, open **Security → Report a vulnerability**. Don't open a public issue for a security problem.

Include what you found, how to reproduce it, and the impact you expect. You should get a reply within a week. This is a volunteer project with no bounty.

## Worth knowing

Council Desk runs an AI agent that can read files, edit files and run commands on your computer, within the permission mode you choose. Treat its permission prompts the way you would treat Claude Code's. Vulnerabilities in Claude Code itself should go to [Anthropic](https://code.claude.com/docs/en/legal-and-compliance#security-vulnerability-reporting).

Especially useful reports: ways for a page in the Browser pane or a Markdown transcript to reach the app's privileged API, ways for a project folder to run code before you trust it, and ways for a saved API key to reach anything the app starts other than the Claude Code process. Claude Code's own subprocesses inherit its environment, as [getting started](docs/getting-started.md#your-api-key) describes.
