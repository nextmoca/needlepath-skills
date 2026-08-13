# Framework Adapters

Prefer an official adapter when its supported seam matches the application. Do not imitate an adapter around an unsupported protocol.

## Decision Table

| Application seam | Package | Integration point | Important limit |
|---|---|---|---|
| LangChain `create_agent` | `needlepath-langchain` | `NeedlepathMiddleware` | Preserve tool-call/message pairing |
| LangGraph `create_react_agent` | `needlepath-langchain` | `needlepath_pre_model_hook` | Prefer LangChain middleware for new work |
| LiteLLM proxy, OpenAI chat format | `needlepath-litellm` | pre-call `CustomGuardrail` | Only `/chat/completions` message shape is selected today |
| LlamaIndex query engine | `llama-index-postprocessor-needlepath` | `BaseNodePostprocessor` | Retrieved chunks are often already small/ranked |
| Custom Python | `needlepath` | immediately before model call | Application owns rendering and lifecycle |
| Custom TypeScript/JavaScript | `@nextmoca/needlepath-sdk` | immediately before model call | Application owns rendering and lifecycle |

## LangChain And LangGraph

```bash
pip install needlepath-langchain
```

```python
from langchain.agents import create_agent
from needlepath_langchain import NeedlepathMiddleware

agent = create_agent(
    model,
    tools,
    middleware=[
        NeedlepathMiddleware(
            operating_point="np-2026-08-r3",
            shadow=True,
            select_history=False,
        )
    ],
)
```

Start with tool-result selection, where large structured outputs create the clearest value. Enable accumulated-history selection only after shadow evidence for that agentic workload. A ReAct loop can need records that are not predictable from the current step; do not assume retrieval benchmark behavior transfers to long-horizon agents.

For an existing LangGraph `create_react_agent`, use `needlepath_pre_model_hook(operating_point="np-2026-08-r3", shadow=True)`. Do not remove messages from graph state; selection must be per model call and non-destructive.

## LiteLLM Proxy

```bash
pip install needlepath-litellm
```

```yaml
guardrails:
  - guardrail_name: needlepath
    litellm_params:
      guardrail: needlepath_litellm.NeedlepathGuardrail
      mode: pre_call
      default_on: true
      operating_point: np-2026-08-r3
      shadow: true
      history_max_tokens: 8000
      preserve_recent: 2
```

This adapter mutates only OpenAI-format `/chat/completions` messages. Native Anthropic `/v1/messages`, OpenAI Responses API input, embeddings, images, audio, and pass-through routes stand down. If those are the application's primary routes, use a supported SDK seam instead of claiming proxy coverage.

## LlamaIndex

```bash
pip install llama-index-postprocessor-needlepath
```

```python
from llama_index.postprocessor.needlepath import NeedlepathPostprocessor

query_engine = index.as_query_engine(
    node_postprocessors=[
        NeedlepathPostprocessor(
            operating_point="np-2026-08-r3",
            shadow=True,
        )
    ]
)
```

Preserve input node identity, provenance, and retriever scores. Measure value honestly: post-retrieval chunks may offer less headroom than tool outputs or long state.

## Unsupported Or Ambiguous Seams

If no adapter matches, use the core SDK at the application's own pre-model boundary. Do not rewrite native Anthropic content blocks, OpenAI Responses input, multimodal blocks, or tool-call pairings as plain chat messages without a tested reversible mapping. When the mapping is uncertain, leave that path unchanged and document the unsupported coverage.
