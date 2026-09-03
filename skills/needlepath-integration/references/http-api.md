# HTTP API

Use the HTTP contract when the application is not Python or TypeScript and no official adapter matches. Prefer a generated client from the published OpenAPI document over hand-maintained wire models.

## Request

Send `POST /v1/context/select` with TLS and Bearer authentication:

```http
Authorization: Bearer $NEEDLEPATH_API_KEY
Content-Type: application/json
```

For one raw context block:

```json
{
  "request_id": "req-application-correlation-id",
  "text": "candidate context",
  "task": {"prompt": "the current model task"},
  "budget": {
    "max_context_tokens": 8000,
    "operating_point": "np-2026-08-r3"
  },
  "render": true,
  "return_per_record": false
}
```

For typed state, replace `text` with `records`; never send both. Give every record stable `id`, truthful `kind`, `text`, and optional `title`/`source`. Keep the exact original context or native objects locally before sending the request.

## Apply Or Pass Through

Treat a response as applicable only when all structural checks succeed:

- HTTP status is 2xx and the JSON contract is valid
- response `request_id` matches the request
- `fallback_used` is false, `selection_error` is empty, and the response does not require fallback
- at least one record and non-empty `rendered_context` were returned
- applying it produces a real reduction

For every other condition, including timeout, non-2xx, malformed JSON, unknown future outcome, and client error, send the exact original context. Do not return an empty or partial block. The SDKs implement exactly this rule as `result.applied`; prefer an SDK where one exists so raw-HTTP clients cannot drift from it.

## Transport

- Keep the total deadline below the downstream model-call budget.
- Retry `429`, `502`, `503`, `504`, and transient transport failures with bounded jitter. Do not retry deterministic `500` responses.
- Guard the serialized request below the hosted 6 MB ceiling.
- Reuse HTTP clients and connection pools.
- Preserve caller cancellation.
- Never log authorization headers, request bodies, response excerpts, or raw error strings that may contain input.

## Shadow

Shadow is an application decision: make the real selection call and record its metadata, but always send exact original context to the model. Use the same request construction and response parser in shadow and live modes; only the final application decision changes.
