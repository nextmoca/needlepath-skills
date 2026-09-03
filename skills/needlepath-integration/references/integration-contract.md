# Integration Contract

## Boundary

Integrate after the application has assembled candidate context and immediately before that context is rendered into the model request:

```text
mandatory context + (Needlepath selected candidates OR exact original candidates) -> model
```

Do not put Needlepath in front of authentication, policy enforcement, user authorization, or tool execution. It selects evidence; it does not authorize actions.

## Candidate Shapes

Use exactly one shape per call:

- `text`: one document, transcript, or already-rendered context block, sent as one block.
- `records`: state with identity or role, such as tool results, retrieved documents, artifacts, errors, or prior model messages.

For records, use stable ids and truthful kinds: `user_input`, `llm_response`, `tool_call`, `tool_result`, `external_data`, `error`, or `artifact`. Tool schemas are mandatory context, never candidates. Preserve the application's original rendering separately for fail-open.

## Mandatory Context

Keep these outside candidates and concatenate them around the applied or original candidate block:

- system and developer instructions
- governance and safety policy
- tool/function schemas and output contracts
- current user request when it is itself mandatory model input
- records the application cannot safely omit

## Application Rule

`result.applied` is the sole authority:

```text
if applied:     use rendered selection
if not applied: use exact original candidate context
```

Never branch on `reason`, other diagnostic fields, or a hard-coded outcome list. They are open enums. Never apply an empty result. Do not add an application-side fallback that drops or summarizes context.

## Operating Point And Budget

- Pin `np-2026-08-r4`; do not inherit `latest` or the server default.
- Set the budget from the downstream model/input capacity available for selectable context, after mandatory context is reserved.
- Do not confuse context budget with maximum output tokens.
- Keep the operating point configurable for future migrations, but give it the explicit r3 default.

## Rollout

1. Shadow: call the same service and collect the same response, but always send original context to the model.
2. Evaluate: compare downstream quality, task success, context sufficiency, token reduction, and latency by workload.
3. Live: flip configuration so `result.applied` controls the candidate block.
4. Rollback: set shadow or disabled without changing the model-call code path.

## Observability

Record metadata only:

- request/selection correlation id
- operating point
- applied or passthrough
- open-enum reason
- records available/selected
- Needlepath tokens before/after/saved and reduction ratio
- engine and client latency
- shadow/live state

Needlepath token counts are deterministic service measurements, not provider billing. Label them accordingly. Never log prompts, record text, excerpts, model output, API keys, or raw exception messages that may contain input.

## Security And Lifecycle

- Read `NEEDLEPATH_API_KEY` from the platform's secret manager or environment.
- Use HTTPS except for loopback development.
- Reuse clients rather than constructing one per request; close owned async clients during application shutdown.
- Preserve cancellation and request deadlines.
- Keep Needlepath timeout below the model-call latency budget; fail-open handles expiration.

## Verification Matrix

Test applied, shadow, disabled, stood-down, empty, timeout, transport error, 429/5xx, malformed contract, oversized request, and unknown future reason. Assert on the final model input, not merely the SDK result.
