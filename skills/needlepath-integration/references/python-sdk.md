# Python SDK

## Install

```bash
pip install needlepath
```

Use the repository's package manager and persist the dependency in its normal manifest and lockfile. Python 3.9+ is supported; `needlepath[httpx]` adds the optional native async transport.

## Framework-Free Text Integration

```python
import os

from needlepath import NeedlepathClient, TaskSpec


client = NeedlepathClient(
    api_key=os.environ.get("NEEDLEPATH_API_KEY"),
    base_url=os.environ.get("NEEDLEPATH_BASE_URL", "https://api.nextmoca.com"),
    operating_point=os.environ.get(
        "NEEDLEPATH_OPERATING_POINT", "np-2026-08-r4"
    ),
    shadow=True,
)


def select_model_context(*, prompt: str, original_context: str) -> tuple[str, dict]:
    result = client.select(
        text=original_context,
        task=TaskSpec(prompt=prompt),
        max_context_tokens=8000,
    )
    model_context = result.rendered_context if result.applied else original_context
    return model_context, result.metadata()
```

Keep `original_context` immutable until the model request has been constructed. Replace `shadow=True` with a configuration value; in shadow, `result.applied` remains false and the same code passes the original through.

## Typed Records

Use records when the application needs to round-trip identity or role:

```python
from needlepath import ContextRecord, TaskSpec

records = [
    ContextRecord(text=tool_output, kind="tool_result", id="tool-17"),
    ContextRecord(text=retrieved_doc, kind="external_data", id="doc-4"),
]
result = client.select(
    records=records,
    task=TaskSpec(prompt=prompt),
    max_context_tokens=8000,
)
candidate_block = result.rendered_context if result.applied else original_context
```

Do not pass both `text` and `records`. Stable ids are required when the application maps selected records back to native objects.

## Async

Use one `AsyncNeedlepathClient` in the application's lifecycle and `await client.select(...)`. Do not call the sync client from an event loop. Close the owned client on shutdown.

## Testing

Use `needlepath.testing.FakeTransport` and response builders to cover service responses without network calls. More importantly, spy on the downstream model boundary and assert that every non-applied result receives exact `original_context`. Include both sync and async tests if the application exposes both paths.

Never use `select_or_raise()` in production integration code. It is for diagnostics and benchmark harnesses.
