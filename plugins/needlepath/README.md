# Needlepath for Claude Code

Select what Claude reads from large tool results. Verbatim.

This plugin adds a PostToolUse hook to Claude Code. When a tool result is large, the hook sends its text to Needlepath, a hosted context selection service, and Needlepath returns excerpts of that text for the current task, assembled into one block. In `auto` mode Claude reads that block instead of the full output. Excerpts are extractive: taken from the original text, never paraphrased or rewritten. They may be non-contiguous, and whitespace may be normalised. On any problem, Claude reads the original output unchanged.

A new install starts in `shadow` mode: the same request runs and its outcome is recorded as metadata, but Claude keeps every original tool result. Nothing changes what Claude reads until you run the diagnostic and enable `auto`.

The plugin sends eligible tool output to the Needlepath API and applies what the API returns. It keeps only metadata on your machine.

## Requirements

- Claude Code 2.1.207 or later in the 2.x line, as the CLI or a local Desktop Code session that runs the Claude Code plugin runtime. On any other major version the plugin sends nothing.
- Node.js 20.19 or later on the machine where Claude Code runs.
- A Needlepath API key from https://console.nextmoca.com.

Hosted Claude sessions without a local plugin runtime cannot load this plugin. Over SSH, the plugin runs on the remote machine with that machine's Node.js, key and network.

## What leaves your machine

For each eligible tool result, one HTTPS POST goes to `/v1/context/select` on the configured API URL, by default `https://api.nextmoca.com`, authenticated with your API key as a bearer token. A transient status (429, 502, 503, 504) is retried once inside the same deadline, so a single tool result produces at most two requests. The request carries:

- the tool result text, when its size is at least the minimum (default 4000 tokens, estimated locally at 4 characters per token, so roughly 16 KB of text);
- the tool name, and a source string taken from the tool input (file path, path, URL, query or command, up to 1024 characters);
- a task line built from the same tool-input fields plus any `provenance` field, up to 512 characters per field and 2048 in total;
- a record id (a hash of the tool name, the tool-use id and the text), the selection settings (token budget, the operating point `np-2026-08-r4`), and a random request id.

A local pattern check drops tool-input values that look like a credential (`key=` or `token:` assignments, bearer tokens, `sk-`, `AKIA` and `np_live` key shapes, URLs with embedded credentials) before they can become a source or task string. It is a pattern check, not a scanner: a command line or URL that carries a secret in another form is sent as provenance, so keep secrets out of the command lines and URLs you run through Claude. Tool inputs are chosen by Claude for the tool call and can echo words from your request.

Eligible tools are Read, Grep, Search, Bash, PowerShell, WebFetch, WebSearch, and MCP tools whose result is text. A result is only sent when its tool input carries at least one of `query`, `command`, `file_path`, `path`, `url` or `provenance`; without one there is nothing to describe the task, and the plugin stands down.

The plugin refuses to send to a non-TLS URL. The only exception is a loopback address, for local testing.

## What never leaves your machine

- Your prompts and the conversation. The plugin subscribes to no prompt event and does not read transcripts. What can echo part of a request is the tool input described above.
- System prompts, tool schemas, permissions, or the current user request.
- Results of Write and Edit, failed tool results, images, and any other non-text output.
- Tool results below the minimum size.
- Anything at all while the mode is `off` or `emergency-pass-through`, no key is configured, or the Claude Code version is unsupported.

Local state (`state.json` in the plugin's data directory) holds metadata only: the mode, the emergency flag, the last outcome (whether it was applied, its reason, token counts before and after, tokens saved, reduction ratio, latency, and record counts), and the last diagnostic result (ok, code, time, sidecar version). It never holds tool text, selected text, request or response bodies, or the key.

What the service keeps is documented at https://docs.nextmoca.com/retention-and-trust. Record content sent to `/v1/context/select` is never stored and never logged, and metadata-only service logs are kept for 14 days.

## Fail-open: Claude keeps the original on any problem

Claude receives the original tool result, unchanged, whenever any of these happens: a timeout (default 3 seconds for the whole call), a transport error, an HTTP error, a malformed response, a response for a different request, the service reporting a fallback or an unsafe selection, an empty selection, a selection that does not reference the record sent, a selection that is not smaller than the original, or any exception inside the hook. In each case the hook exits 0 and writes nothing, which is how Claude Code keeps the original result.

Transient HTTP statuses (429, 502, 503, 504) are retried once inside the same deadline. Authentication failures are not retried.

In `shadow` mode the same request runs and the outcome is recorded as metadata. The original is always kept.

## Install

### From the marketplace

In Claude Code:

```text
/plugin marketplace add nextmoca/needlepath-skills
/plugin install needlepath@needlepath
```

From a shell:

```sh
claude plugin marketplace add nextmoca/needlepath-skills
claude plugin install needlepath@needlepath --scope user
```

Scopes: `user` (the default, every project on this machine), `project` (shared with collaborators through `.claude/settings.json`), `local` (this checkout only, in `.claude/settings.local.json`).

### From the Desktop Code plugin manager

In a local or SSH session in the Claude Desktop app's Code tab, register the marketplace once by sending `/plugin marketplace add nextmoca/needlepath-skills` from the prompt box. Then click the + button next to the prompt box, choose Plugins, then Add plugin, and pick `needlepath` from the plugin browser. Scope it to your user account, the project, or local only. Manage plugins in the same menu enables, disables and uninstalls it. Desktop and the CLI share the same plugin configuration for local sessions. The plugin browser is not available in cloud sessions or WSL sessions.

### Manual

```sh
git clone https://github.com/nextmoca/needlepath-skills.git
claude --plugin-dir ./needlepath-skills/plugins/needlepath
```

That loads the plugin for one session without installing it. For a persistent install from the clone, register the clone as a marketplace and install from it:

```sh
claude plugin marketplace add ./needlepath-skills
claude plugin install needlepath@needlepath
```

## Configure

After installing, set these values with `/plugin configure needlepath@needlepath` in Claude Code. The key is marked sensitive: Claude Code masks it and stores it in secure storage, and the plugin reads it only from that setting. Do not paste the key into a conversation, a shell command, or a settings file. The CLI's `--config KEY=VALUE` flag works for the other settings; do not use it for the key, because a command line lands in shell history.

| Setting | Default | Meaning |
|---|---|---|
| Needlepath API key | none | Create one at https://console.nextmoca.com. Without a key the plugin sends nothing. |
| Selection mode | `shadow` | `shadow`, `auto` or `off`. See below. |
| Needlepath API URL | `https://api.nextmoca.com` | Must be `https`, except a loopback address. |
| Minimum candidate tokens | 4000 | Smaller tool results are not sent. |
| Maximum selected tokens | 8000 | Ceiling on the selected subset. The budget requested is the smaller of this and 60 percent of the result's size. |
| Selection timeout | 3000 ms | Total deadline for the call, including the one retry. |
| Metadata telemetry | on | Write the last outcome's metadata to local state. Off means no outcome is written. |

### Modes

- `shadow`, the default: the request runs, the outcome is recorded, Claude keeps the original.
- `auto`: Claude reads the selected subset when the service returns one. Auto requires a successful diagnostic in the last 24 hours. Without one, the plugin runs as `shadow` until you run the diagnostic again.
- `off`: nothing is sent.
- `emergency-pass-through`: the same as `off`, and it overrides every other setting until you set another mode.

A mode set from the conversation with the skills below overrides the configured value.

## Use

The plugin ships five skills and an MCP server with three tools. All of them report metadata only: mode, configuration state, diagnostic result, token counts and outcome reasons. None of them prints tool text, selected text, request or response bodies, or the key.

| Skill | What it does |
|---|---|
| `/needlepath:needlepath-setup` | Checks configuration, explains what is sent, runs the diagnostic, leaves the mode in `shadow`. |
| `/needlepath:needlepath-doctor` | Runs a connectivity diagnostic against the API with a fixed test string, never your data. Required before `auto`. |
| `/needlepath:needlepath-enable` | Switches to `auto` after a successful diagnostic. |
| `/needlepath:needlepath-status` | Reports mode, configuration state, the last diagnostic and the last outcome. |
| `/needlepath:needlepath-disable` | Sets the mode to `off`. |

The MCP tools behind them are `needlepath_status`, `needlepath_doctor` and `needlepath_set_mode`.

Token counts in the status output are Needlepath's own measurements of the request, not Claude's billed usage.

## Uninstall

In Claude Code:

```text
/plugin uninstall needlepath@needlepath
```

From a shell, with the scope you installed at:

```sh
claude plugin uninstall needlepath@needlepath --scope user
```

Claude Code deletes the plugin's data directory when the last scope is removed, unless you pass `--keep-data`. Remove the API key from the plugin's configuration separately if you want the credential gone, and revoke it at https://console.nextmoca.com.

## Versioning

Every request pins the operating point `np-2026-08-r4`. A new operating point never arrives in an update: changing the pinned label is a new major version of the plugin, so an update cannot silently change what is selected.

## Tests

```sh
cd plugins/needlepath
npm test
```

Node's built-in test runner, no dependencies, Node.js 20.19 or later.

## Security

Report a suspected vulnerability to support@nextmoca.com with a minimal reproduction. Do not include production credentials or tool output.

## License

Apache-2.0. See [LICENSE](LICENSE).
