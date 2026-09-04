import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

async function clientModule() {
  try {
    return await import("../src/needlepath-client.mjs");
  } catch {
    return {};
  }
}

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return JSON.parse(body);
}

function projection(candidate = "A".repeat(20_000)) {
  return {
    candidate,
    original: candidate,
    strategy: { type: "string" },
    toolName: "Read",
    toolUseId: "toolu_needlepath",
    title: "Read",
    source: "/repo/large.txt",
    kind: "tool_result",
  };
}

function config(baseUrl, overrides = {}) {
  return {
    apiKey: "np_test_secret",
    mode: "auto",
    baseUrl,
    minTokens: 4000,
    maxContextTokens: 8000,
    timeoutMs: 1000,
    telemetry: true,
    autochunk: true,
    operatingPoint: "np-2026-08-r4",
    maxRequestBytes: 5_500_000,
    ...overrides,
  };
}

function applicable(body, overrides = {}) {
  const recordId = body.records[0].id;
  return {
    request_id: body.request_id,
    rendered_context: "selected evidence",
    policy_version: "np-2026-08-r4",
    selected: [{ record_id: recordId, text: "selected evidence" }],
    tokens_before: 5000,
    tokens_after: 4,
    tokens_saved: 4996,
    records_available: 1,
    records_selected: 1,
    outcome: "engaged",
    fallback_used: false,
    selection_error: null,
    engine_latency_ms: 18,
    budget_tokens: body.budget.max_context_tokens,
    attempted_budget_tokens: [body.budget.adaptive.initial_tokens],
    reduction_ratio: 0.9992,
    safety: { selection_safe: true, fallback_required: false },
    gate: { reason: "future-open-enum" },
    format_metrics: {},
    task_kind: "coding",
    selection_trace: null,
    ...overrides,
  };
}

test("selection sends a stable typed record with r4 adaptive auto budget and applies a safe reduction", async () => {
  const { selectContext } = await clientModule();
  await withServer(async (request, response) => {
    const body = await readJson(request);
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/context/select");
    assert.equal(request.headers.authorization, "Bearer np_test_secret");
    assert.equal(body.records.length, 1);
    assert.deepEqual(body.records[0], {
      id: body.records[0].id,
      kind: "tool_result",
      text: "A".repeat(20_000),
      title: "Read",
      source: "/repo/large.txt",
    });
    assert.match(body.records[0].id, /^tool_result:[a-f0-9]{32}$/);
    assert.deepEqual(body.task, { prompt: "Find the retry bug", tool_name: "Read" });
    assert.deepEqual(body.budget, {
      max_context_tokens: 3000,
      operating_point: "np-2026-08-r4",
      mode: "adaptive",
      autochunk: true,
      adaptive: {
        initial_tokens: 1500,
        escalation_tokens: [3000],
        allow_full_context_fallback: true,
      },
    });
    assert.equal(body.render, true);
    assert.equal(body.return_per_record, true);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(applicable(body)));
  }, async (baseUrl) => {
    const result = await selectContext?.(
      { projection: projection(), task: "Find the retry bug", sessionId: "session-1" },
      config(baseUrl),
    );
    assert.equal(result?.applied, true);
    assert.equal(result?.reason, "ok");
    assert.equal(result?.selectedText, "selected evidence");
    assert.equal(result?.metadata.tokensBefore, 5000);
    assert.equal(result?.metadata.tokensAfter, 4);
    assert.equal(result?.metadata.recordsSelected, 1);
  });
});

test("autochunk can be switched off, and then the request does not mention it", async () => {
  const { selectContext } = await clientModule();
  let budget;
  await withServer(async (request, response) => {
    const body = await readJson(request);
    budget = body.budget;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(applicable(body)));
  }, async (baseUrl) => {
    await selectContext?.({ projection: projection(), task: "task" }, config(baseUrl, { autochunk: false }));
    assert.equal("autochunk" in budget, false);
    await selectContext?.({ projection: projection(), task: "task" }, config(baseUrl));
    assert.equal(budget.autochunk, true);
  });
});

test("envelope validation follows the published required fields", async () => {
  const { selectContext } = await clientModule();
  const required = [
    "rendered_context",
    "tokens_before",
    "tokens_after",
    "tokens_saved",
    "records_available",
    "records_selected",
    "fallback_used",
    "engine_latency_ms",
  ];
  const cases = [];
  for (const field of required) {
    cases.push([`missing ${field}`, (answer) => { delete answer[field]; }, "malformed_response", false]);
  }
  cases.push(["missing request_id", (answer) => { delete answer.request_id; }, "request_mismatch", false]);
  cases.push(["required field of the wrong type", (answer) => { answer.tokens_before = "5000"; }, "malformed_response", false]);
  cases.push(["optional outcome of the wrong type", (answer) => { answer.outcome = 5; }, "malformed_response", false]);
  cases.push(["optional policy_version of the wrong type", (answer) => { answer.policy_version = 4; }, "malformed_response", false]);
  cases.push(["optional selected of the wrong type", (answer) => { answer.selected = "record"; }, "malformed_response", false]);
  cases.push(["non-string selection_error", (answer) => { answer.selection_error = { code: "engine" }; }, "selection_error", false]);
  cases.push(["only the required fields", (answer) => {
    for (const field of Object.keys(answer)) {
      if (!required.includes(field) && field !== "request_id") delete answer[field];
    }
  }, "empty_selection", true]);
  cases.push(["null optional fields", (answer) => { answer.outcome = null; answer.policy_version = null; answer.selected = null; }, "empty_selection", true]);
  let index = 0;
  await withServer(async (request, response) => {
    const body = await readJson(request);
    const answer = applicable(body);
    cases[index++][1](answer);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(answer));
  }, async (baseUrl) => {
    for (const [label, , reason, serviceOk] of cases) {
      const result = await selectContext?.(
        { projection: projection(), task: "task", sessionId: "session" },
        config(baseUrl),
      );
      assert.equal(result?.applied, false, label);
      assert.equal(result?.reason, reason, label);
      assert.equal(result?.metadata.serviceOk, serviceOk, label);
    }
  });
});

test("contract declines and unknown outcomes never apply selected output", async () => {
  const { selectContext } = await clientModule();
  const mutations = [
    ["engine_fallback", { fallback_used: true }],
    ["selection_error", { selection_error: "ValueError: private record" }],
    ["selection_unsafe", { safety: { selection_safe: false, fallback_required: true } }],
    ["empty_selection", { records_selected: 0, selected: [], rendered_context: "" }],
    ["request_mismatch", { request_id: "someone-elses-request" }],
    ["unknown_outcome", { outcome: "future-maybe-applied" }],
    ["escalated", { outcome: "escalated", selected: [], records_selected: 0, rendered_context: "", tokens_after: 0 }],
    ["unknown_selection", { selected: [{ record_id: "unknown", text: "x" }] }],
    ["no_reduction", { rendered_context: "A".repeat(20_000), tokens_after: 5000, tokens_saved: 0 }],
  ];
  let index = 0;
  await withServer(async (request, response) => {
    const body = await readJson(request);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(applicable(body, mutations[index++][1])));
  }, async (baseUrl) => {
    for (const [reason] of mutations) {
      const result = await selectContext?.(
        { projection: projection(), task: "task", sessionId: "session" },
        config(baseUrl),
      );
      assert.equal(result?.applied, false, reason);
      assert.equal(result?.reason, reason);
      assert.equal(result?.selectedText, "");
      const envelopeInvalid = ["selection_error", "request_mismatch"].includes(reason);
      assert.equal(result?.metadata.serviceOk, !envelopeInvalid, reason);
    }
  });
});

test("transient failures retry once while deterministic 500 and authentication failures do not", async () => {
  const { selectContext } = await clientModule();
  let calls = 0;
  await withServer(async (request, response) => {
    calls += 1;
    const body = await readJson(request);
    if (calls === 1) {
      response.writeHead(503).end("unavailable");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(applicable(body)));
  }, async (baseUrl) => {
    const result = await selectContext?.(
      { projection: projection(), task: "task", sessionId: "session" },
      config(baseUrl),
    );
    assert.equal(result?.applied, true);
    assert.equal(result?.metadata.serviceOk, true);
    assert.equal(result?.metadata.attempts, 2);
    assert.equal(calls, 2);
  });

  for (const [status, reason] of [[500, "http_500"], [401, "authentication_failed"], [400, "http_400"], [413, "http_413"]]) {
    calls = 0;
    await withServer(async (_request, response) => {
      calls += 1;
      const privateResponse = ["Authorization", "Bearer np_test_secret"].join(": ");
      response.writeHead(status).end(privateResponse);
    }, async (baseUrl) => {
      const result = await selectContext?.(
        { projection: projection(), task: "task", sessionId: "session" },
        config(baseUrl),
      );
      assert.equal(result?.applied, false);
      assert.equal(result?.reason, reason);
      assert.equal(result?.metadata.serviceOk, false);
      assert.equal(calls, 1);
      assert.equal(JSON.stringify(result).includes("np_test_secret"), false);
    });
  }
});

test("request guard and total deadline return metadata-only passthrough results", async () => {
  const { selectContext } = await clientModule();
  let calls = 0;
  await withServer(async (_request, response) => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 100));
    response.writeHead(200, { "content-type": "application/json" }).end("{}");
  }, async (baseUrl) => {
    const tooLarge = await selectContext?.(
      { projection: projection(), task: "task", sessionId: "session" },
      config(baseUrl, { maxRequestBytes: 100 }),
    );
    assert.equal(tooLarge?.reason, "request_too_large");
    assert.equal(calls, 0);

    const timedOut = await selectContext?.(
      { projection: projection(), task: "task", sessionId: "session" },
      config(baseUrl, { timeoutMs: 25 }),
    );
    assert.equal(timedOut?.applied, false);
    assert.equal(timedOut?.reason, "timeout");
    assert.equal(typeof timedOut?.metadata.latencyMs, "number");
    assert.equal(Object.hasOwn(timedOut || {}, "error"), false);
  });
});

test("malformed JSON and transport failures return non-throwing passthrough results", async () => {
  const { selectContext } = await clientModule();
  await withServer(async (_request, response) => {
    response.writeHead(200, { "content-type": "application/json" }).end("not-json");
  }, async (baseUrl) => {
    const malformed = await selectContext?.(
      { projection: projection(), task: "task", sessionId: "session" },
      config(baseUrl),
    );
    assert.equal(malformed?.reason, "malformed_response");
  });

  const transport = await selectContext?.(
    { projection: projection(), task: "task", sessionId: "session" },
    config("http://127.0.0.1:1", { timeoutMs: 100 }),
  );
  assert.equal(transport?.applied, false);
  assert.equal(transport?.reason, "transport_error");
});
