---
name: needlepath-integration
description: Use when integrating Needlepath into an application, AI agent, workflow, RAG pipeline, or model gateway, including context selection, shadow evaluation, fail-open handling, and selection telemetry.
---

# Integrate Needlepath

Implement Needlepath at the application's context assembly boundary. Prefer a supported framework adapter; otherwise use the Python or TypeScript SDK. Pin `np-2026-08-r3` unless the user explicitly requests another operating point.

## Non-Negotiable Contract

- Capture the exact original candidate context before calling Needlepath.
- Fail open: a Needlepath decline or failure must preserve that exact context.
- Apply a selection only when `result.applied` is true. Otherwise pass the exact original context.
- Treat `reason` and future outcome fields as open enums. Never infer safety from a reason string.
- Keep system prompts, governance policy, tool schemas, and other mandatory context outside selection.
- Start in client-side shadow mode unless the user explicitly requests live mode.
- Never use `select_or_raise()` or `selectOrThrow()` in a production request path.
- Emit metadata only. Never log prompts, record content, excerpts, credentials, or raw selection errors.

## Integration Workflow

1. Inspect the repository's language, dependencies, model-call path, context construction, async model, tests, configuration, and telemetry conventions. Use `rg` and `rg --files` first.
2. Identify the narrowest supported seam immediately before context enters the model. Do not add a second orchestration layer.
3. Read [framework-adapters.md](references/framework-adapters.md). Use an adapter when its documented seam matches the application.
4. Otherwise read [python-sdk.md](references/python-sdk.md), [typescript-sdk.md](references/typescript-sdk.md), or [http-api.md](references/http-api.md) for another language.
5. Read [integration-contract.md](references/integration-contract.md) before implementation.
6. Add the SDK dependency using the repository's existing package manager and lockfile conventions.
7. Configure `NEEDLEPATH_API_KEY`, optional `NEEDLEPATH_BASE_URL`, and an explicit `np-2026-08-r3` pin. Never commit a key.
8. Separate mandatory context from selectable candidates. Choose `text` for one document/blob and typed records when identity, provenance, or role matters.
9. Wire one long-lived client into the existing dependency/lifecycle boundary. Preserve sync/async behavior.
10. Ship shadow mode first: call Needlepath, retain full context, and record would-apply, reason, token counts, reduction, and latency.
11. Add failure and application tests. Then enable live mode through configuration, not a code fork.
12. Run the repository's focused and regression tests and summarize measured behavior.

## Required Tests

Prove all of these at the application boundary:

- an applied result sends selected context to the model
- shadow, stand-down, empty selection, unsafe selection, timeout, HTTP failure, malformed response, and unknown future reason send exact original context
- mandatory context is never selectable
- r3 is explicitly pinned and authentication stays out of logs
- metrics distinguish service token counts from provider-billed tokens
- async and streaming behavior remains unchanged where applicable

## Definition Of Done

- Needlepath is invoked at one documented context boundary.
- Disabling Needlepath restores byte-identical pre-integration model input.
- A Needlepath outage cannot become an application or model-call outage.
- Shadow and live behavior use the same integration path.
- Operators can observe calls, applied/passthrough decisions, estimated reduction, and selection latency without content leakage.
- Configuration and a minimal usage example are added to the application's existing documentation.
