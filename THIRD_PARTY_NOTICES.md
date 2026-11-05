# Third-party notices

The MIT licence in [LICENSE](LICENSE) covers Council Desk's own code. It does not cover the packages below, which keep their own terms. This repository contains source code only and ships no built app and no copy of these packages; `npm install` downloads them from npm.

## Claude Agent SDK and Claude Code

`@anthropic-ai/claude-agent-sdk` and its platform packages include the Claude Code binary. They are proprietary software of Anthropic PBC, not open source. Your use of them is governed by [Anthropic's legal agreements](https://code.claude.com/docs/en/legal-and-compliance). If you build the app, your build contains that binary, so check those terms before giving a build to anyone else.

## Other runtime dependencies

| Package | Licence |
|---|---|
| `@highlightjs/cdn-assets` | BSD-3-Clause |
| `@xterm/xterm`, `@xterm/addon-fit` | MIT |
| `dompurify` | MPL-2.0 or Apache-2.0 |
| `marked` | MIT |
| `node-pty` | MIT |
| `zod` | MIT |

## Build tools

`electron` and `electron-builder` are MIT. `sharp` is Apache-2.0, and its prebuilt `libvips` binaries are LGPL-3.0-or-later. Electron bundles Chromium and other components with their own licences, listed in the `LICENSES.chromium.html` file of any Electron build.

For the full list, including packages these depend on, see `package-lock.json` or run `npx license-checker --summary`.

## Trademarks

Claude, Claude Code and Anthropic are trademarks of Anthropic PBC. Council Desk is an independent project. It is not affiliated with, endorsed by or sponsored by Anthropic.
