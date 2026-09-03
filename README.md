# Needlepath integration skills

A drop-in skill that tells your coding agent how to add
[Needlepath](https://docs.nextmoca.com) context selection to an application,
agent, RAG pipeline or model gateway.

It is a **build-time author**, not a run-time component. The agent reads it,
inspects your repository, and writes the integration. You review a diff. Once it
has run, your code depends on a Needlepath SDK or on the HTTP API, not on this
skill.

It is not an SDK, not an MCP server, and not a model proxy. See
[the comparison table](https://docs.nextmoca.com/integrations/agent-skills).

## The Claude Code plugin is the run-time counterpart

`plugins/needlepath/` is a Claude Code plugin, not a skill. It sends large tool
results through Needlepath and hands Claude excerpts of the original text, never
a rewrite, and keeps the original output on any problem. It starts in shadow mode.

```text
/plugin marketplace add nextmoca/needlepath-skills
/plugin install needlepath@needlepath
```

What it sends, what it never sends, configuration and uninstall are in
[plugins/needlepath/README.md](plugins/needlepath/README.md).

## Install

```bash
# Claude Code and Codex, and 20+ other agents
npx skills add nextmoca/needlepath-skills

# Claude Code, native, with version pinning
/plugin marketplace add nextmoca/needlepath-skills
/plugin install needlepath-integration@needlepath
```

Manual install: copy `skills/needlepath-integration/` into `.claude/skills/`
for Claude Code, or `.agents/skills/` for Codex, Gemini CLI, and Google
Antigravity. Codex reads `.agents/skills`, **not** `.codex/skills`; a skill in
the latter is silently never loaded. For Claude.ai, Claude Desktop, and Cowork,
zip the `needlepath-integration/` folder and upload it under Customize > Skills.

## Then ask

```text
Integrate Needlepath r4 into this application with shadow rollout,
fail-open behavior, metrics, and tests.
```

## What it holds to

The skill treats these as non-negotiable, and the contract tests assert that it
still says so:

- pins `np-2026-08-r4` rather than inheriting the server default;
- starts in shadow mode, so nothing reaches your model differently until you
  turn selection on in configuration;
- fails open exactly: your original context is preserved byte for byte on a
  stand-down, a shadow run, a timeout, an HTTP failure, a malformed response,
  and on any outcome it does not recognise;
- keeps system prompts, governance policy and tool schemas out of selection;
- emits metadata only, never prompts, record content, excerpts or credentials.

## One skill, both agents

This repository ships a single skill. Codex additionally reads
`agents/openai.yaml` for its display metadata; Claude Code ignores that file.
Keeping one copy is deliberate, because `npx skills add` installs the same
source into both `.claude/skills/` and `.agents/skills/`, and two copies would
be two things to keep in sync.

## Versioning

**1.0.0 (2026-09-03):** the pinned operating point is `np-2026-08-r4`, the label
the published figures are measured on. Per the rule
below this is a major version: nothing an existing install pinned changes until
you update.

A skill release names the SDK range it writes against and the operating point it
pins. **A new operating point never arrives in an update.** Changing the pinned
label is a new major version, so an update cannot silently move your selection
behaviour.
