# TypeScript SDK

## Install

```bash
npm install @nextmoca/needlepath-sdk
```

Use the repository's package manager and lockfile. The SDK supports Node 20.19+, workerd, and Vercel Edge with zero runtime dependencies.

## Framework-Free Integration

```typescript
import {
  NeedlepathClient,
  metadata,
} from "@nextmoca/needlepath-sdk";

const client = new NeedlepathClient({
  apiKey: process.env.NEEDLEPATH_API_KEY,
  baseUrl: process.env.NEEDLEPATH_BASE_URL ?? "https://api.nextmoca.com",
  operatingPoint:
    process.env.NEEDLEPATH_OPERATING_POINT ?? "np-2026-08-r4",
  shadow: true,
});

export async function selectModelContext(
  prompt: string,
  originalContext: string,
): Promise<{ context: string; needlepath: Record<string, unknown> }> {
  const result = await client.select({
    text: originalContext,
    task: { prompt },
    maxContextTokens: 8000,
  });

  return {
    context: result.applied
      ? result.response!.renderedContext
      : originalContext,
    needlepath: metadata(result),
  };
}
```

Make `shadow: true` configuration-driven. Edge runtimes may not expose `process`; inject API key, base URL, operating point, and shadow state through the application's existing environment/configuration seam.

## Typed Records

Pass `records` instead of `text` when the application needs to round-trip source identity and role. Use stable ids and honest kinds. Preserve the exact native message/context representation separately; that is the fail-open value. Never pass both shapes.

## Cancellation And Streaming

Forward the caller's `AbortSignal` to `select`. Keep Needlepath before the provider streaming call; it changes input only and must not buffer or alter provider output. Preserve the application's existing stream and cancellation behavior.

## Testing

Inject a deterministic `fetch` implementation or use the SDK's test seam. Assert at the provider/model client boundary that every non-applied result receives exact `originalContext`. Cover applied, shadow, timeout, abort, 429/5xx, malformed response, empty selection, and an unknown future reason.

Never use `selectOrThrow()` in production integration code.
