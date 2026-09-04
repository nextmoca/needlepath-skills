import { createHash, randomUUID } from "node:crypto";

const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);
const APPLICABLE_OUTCOMES = new Set(["engaged", "selected"]);

function nowMs() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function metadataFrom(payload, startedAt, attempts, requestBytes) {
  return {
    applied: false,
    reason: "unknown",
    serviceOk: false,
    tokensBefore: Math.max(0, number(payload?.tokens_before)),
    tokensAfter: Math.max(0, number(payload?.tokens_after)),
    tokensSaved: Math.max(0, number(payload?.tokens_saved)),
    reductionRatio: Math.max(0, Math.min(1, number(payload?.reduction_ratio))),
    latencyMs: Math.max(0, nowMs() - startedAt),
    engineLatencyMs: Math.max(0, number(payload?.engine_latency_ms)),
    recordsAvailable: Math.max(0, number(payload?.records_available)),
    recordsSelected: Math.max(0, number(payload?.records_selected)),
    attempts,
    requestBytes,
  };
}

function result(reason, startedAt, attempts, requestBytes, payload = null) {
  const metadata = metadataFrom(payload, startedAt, attempts, requestBytes);
  metadata.reason = reason;
  return { applied: false, reason, selectedText: "", metadata };
}

function buildRecordId(projection) {
  const identity = `${projection.toolName}\u0000${projection.toolUseId}\u0000${projection.candidate}`;
  return `tool_result:${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

function buildRequest(input, config) {
  const candidateTokens = Math.ceil(input.projection.candidate.length / 4);
  const maxContextTokens = Math.max(
    256,
    Math.min(config.maxContextTokens, Math.floor(candidateTokens * 0.6)),
  );
  const initialTokens = Math.max(256, Math.floor(maxContextTokens / 2));
  const recordId = buildRecordId(input.projection);
  const requestId = randomUUID();
  return {
    requestId,
    recordId,
    body: {
      request_id: requestId,
      records: [
        {
          id: recordId,
          kind: "tool_result",
          text: input.projection.candidate,
          title: input.projection.title,
          source: input.projection.source,
        },
      ],
      task: {
        prompt: String(input.task || "").slice(0, 16_384),
        tool_name: input.projection.toolName,
      },
      budget: {
        max_context_tokens: maxContextTokens,
        operating_point: config.operatingPoint,
        mode: "adaptive",
        adaptive: {
          initial_tokens: initialTokens,
          escalation_tokens: initialTokens < maxContextTokens ? [maxContextTokens] : [],
          allow_full_context_fallback: true,
        },
      },
      render: true,
      render_format: "plain",
      return_per_record: true,
    },
  };
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// Fields the published response contract requires, with their types. Everything else
// is optional and is type-checked only when present.
const REQUIRED_FIELDS = {
  rendered_context: (value) => typeof value === "string",
  tokens_before: isFiniteNumber,
  tokens_after: isFiniteNumber,
  tokens_saved: isFiniteNumber,
  records_available: isFiniteNumber,
  records_selected: isFiniteNumber,
  fallback_used: (value) => typeof value === "boolean",
  engine_latency_ms: isFiniteNumber,
};
const OPTIONAL_FIELDS = {
  outcome: (value) => typeof value === "string",
  policy_version: (value) => typeof value === "string",
  selected: Array.isArray,
};

// The envelope is valid when the service answered this request with the configured key
// and the documented response fields. Engine outcomes (fallback, escalation, no
// reduction) are classified separately: they are valid answers that the hook must not apply.
function envelopeReason(payload, request) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "malformed_response";
  }
  if (payload.request_id !== request.requestId) return "request_mismatch";
  if (payload.selection_error != null && payload.selection_error !== "") {
    return "selection_error";
  }
  for (const [field, valid] of Object.entries(REQUIRED_FIELDS)) {
    if (!valid(payload[field])) return "malformed_response";
  }
  for (const [field, valid] of Object.entries(OPTIONAL_FIELDS)) {
    if (payload[field] != null && !valid(payload[field])) return "malformed_response";
  }
  return null;
}

function classify(payload, request, candidate) {
  const envelope = envelopeReason(payload, request);
  if (envelope) return envelope;
  if (payload.fallback_used === true) return "engine_fallback";
  if (payload.outcome != null && !APPLICABLE_OUTCOMES.has(String(payload.outcome))) {
    return payload.outcome === "escalated" ? "escalated" : "unknown_outcome";
  }
  if (
    payload.safety &&
    (payload.safety.fallback_required === true || payload.safety.selection_safe === false)
  ) {
    return "selection_unsafe";
  }
  if (!Array.isArray(payload.selected) || number(payload.records_selected) <= 0) {
    return "empty_selection";
  }
  if (!payload.selected.some((item) => item?.record_id === request.recordId)) {
    return "unknown_selection";
  }
  if (typeof payload.rendered_context !== "string" || !payload.rendered_context.trim()) {
    return "empty_selection";
  }
  const tokensBefore = number(payload.tokens_before);
  const tokensAfter = number(payload.tokens_after);
  if (
    tokensBefore <= 0 ||
    tokensAfter < 0 ||
    tokensAfter >= tokensBefore ||
    payload.rendered_context.length >= candidate.length
  ) {
    return "no_reduction";
  }
  return "ok";
}

async function cancelBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // Connection cleanup is best-effort and never changes fail-open behavior.
  }
}

export async function selectContext(input, config, dependencies = {}) {
  const startedAt = nowMs();
  let attempts = 0;
  let requestBytes = 0;
  try {
    if (!input?.projection?.candidate || !config?.apiKey) {
      return result("not_configured", startedAt, attempts, requestBytes);
    }
    const request = buildRequest(input, config);
    const serialized = JSON.stringify(request.body);
    requestBytes = Buffer.byteLength(serialized);
    if (requestBytes > config.maxRequestBytes) {
      return result("request_too_large", startedAt, attempts, requestBytes);
    }

    const fetchImpl = dependencies.fetch || globalThis.fetch;
    const deadline = startedAt + config.timeoutMs;
    while (attempts < 2) {
      attempts += 1;
      const remainingMs = Math.floor(deadline - nowMs());
      if (remainingMs <= 0) return result("timeout", startedAt, attempts - 1, requestBytes);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), remainingMs);
      try {
        const response = await fetchImpl(`${config.baseUrl}/v1/context/select`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
          },
          body: serialized,
          signal: controller.signal,
        });
        if (response.status !== 200) {
          await cancelBody(response);
          if (TRANSIENT_STATUSES.has(response.status) && attempts < 2) continue;
          const reason = [401, 403].includes(response.status)
            ? "authentication_failed"
            : `http_${response.status}`;
          return result(reason, startedAt, attempts, requestBytes);
        }
        let payload;
        try {
          payload = await response.json();
        } catch {
          return result("malformed_response", startedAt, attempts, requestBytes);
        }
        const reason = classify(payload, request, input.projection.candidate);
        if (reason !== "ok") {
          const declined = result(reason, startedAt, attempts, requestBytes, payload);
          declined.metadata.serviceOk = envelopeReason(payload, request) === null;
          return declined;
        }
        const metadata = metadataFrom(payload, startedAt, attempts, requestBytes);
        metadata.applied = true;
        metadata.reason = "ok";
        metadata.serviceOk = true;
        return {
          applied: true,
          reason: "ok",
          selectedText: payload.rendered_context,
          metadata,
        };
      } catch (error) {
        if (controller.signal.aborted || error?.name === "AbortError") {
          return result("timeout", startedAt, attempts, requestBytes);
        }
        if (attempts >= 2) return result("transport_error", startedAt, attempts, requestBytes);
      } finally {
        clearTimeout(timeout);
      }
    }
    return result("transport_error", startedAt, attempts, requestBytes);
  } catch {
    return result("client_error", startedAt, attempts, requestBytes);
  }
}
