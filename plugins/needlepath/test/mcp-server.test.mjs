import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { createServer } from "node:http";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

async function mcpModule() {
  return import("../src/mcp-server.mjs");
}

function environment(dataDir, overrides = {}) {
  return {
    CLAUDE_PLUGIN_DATA: dataDir,
    CLAUDE_PLUGIN_OPTION_NEEDLEPATH_API_KEY: "np_test_secret",
    CLAUDE_PLUGIN_OPTION_NEEDLEPATH_MODE: "shadow",
    ...overrides,
  };
}

async function request(messages, options = {}) {
  const { runMcpServer } = await mcpModule();
  const output = [];
  await runMcpServer({
    stdin: messages.map((message) => JSON.stringify(message)).join("\n"),
    writeStdout: (line) => output.push(line),
    ...options,
  });
  return output.map((line) => JSON.parse(line));
}

function nextJsonLine(reader) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reader.off("line", onLine);
      reject(new Error("MCP server did not respond before stdin closed"));
    }, 2000);
    const onLine = (line) => {
      clearTimeout(timeout);
      resolve(JSON.parse(line));
    };
    reader.once("line", onLine);
  });
}

test("executable MCP server responds to each request before persistent stdin closes", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "needlepath-mcp-"));
  const child = spawn(process.execPath, ["src/mcp-server.mjs"], {
    cwd: fileURLToPath(ROOT),
    env: { ...process.env, ...environment(dataDir) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const reader = createInterface({ input: child.stdout });
  const close = once(child, "close");

  try {
    const initialized = nextJsonLine(reader);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
    assert.equal((await initialized).result.serverInfo.name, "needlepath");
    assert.equal(child.exitCode, null);

    const listed = nextJsonLine(reader);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
    assert.deepEqual(
      (await listed).result.tools.map((tool) => tool.name),
      ["needlepath_status", "needlepath_doctor", "needlepath_set_mode"],
    );
    assert.equal(child.exitCode, null);
  } finally {
    reader.close();
    child.stdin.end();
    await close;
  }
});

test("MCP framing initializes and advertises only the three operational tools", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "needlepath-mcp-"));
  const responses = await request([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  ], { env: environment(dataDir) });

  assert.equal(responses[0].result.serverInfo.name, "needlepath");
  assert.deepEqual(
    responses[1].result.tools.map((tool) => tool.name),
    ["needlepath_status", "needlepath_doctor", "needlepath_set_mode"],
  );
  assert.deepEqual(
    responses[1].result.tools[2].inputSchema.properties.mode.enum,
    ["off", "shadow", "auto", "emergency-pass-through"],
  );
});

test("status and doctor return metadata only and never expose the API key", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "needlepath-mcp-"));
  const responses = await request([
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "needlepath_status", arguments: {} } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "needlepath_doctor", arguments: {} } },
  ], {
    env: environment(dataDir),
    dependencies: {
      now: () => new Date("2026-09-04T00:00:00.000Z"),
      selectContext: async () => ({
        applied: true,
        reason: "ok",
        selectedText: "private selected context",
        metadata: { tokensBefore: 5000, tokensAfter: 2, latencyMs: 5 },
      }),
    },
  });

  const serialized = JSON.stringify(responses);
  assert.equal(serialized.includes("np_test_secret"), false);
  assert.equal(serialized.includes("private selected context"), false);
  assert.deepEqual(JSON.parse(responses[0].result.content[0].text), {
    mode: "shadow",
    configured: true,
    emergencyPassThrough: false,
    lastOutcome: null,
    doctor: null,
  });
  assert.deepEqual(JSON.parse(responses[1].result.content[0].text), {
    ok: true,
    code: "ok",
    outcome: "ok",
    checkedAt: "2026-09-04T00:00:00.000Z",
    sidecarVersion: "0.1.1",
  });
});

test("doctor succeeds when the service answers but returns the probe unchanged", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "needlepath-mcp-"));
  const responses = await request([
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "needlepath_doctor", arguments: {} } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "needlepath_set_mode", arguments: { mode: "auto" } } },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "needlepath_status", arguments: {} } },
  ], {
    env: environment(dataDir),
    dependencies: {
      now: () => new Date("2026-09-04T00:00:00.000Z"),
      selectContext: async () => ({
        applied: false,
        reason: "engine_fallback",
        selectedText: "",
        metadata: { serviceOk: true, tokensBefore: 1792, tokensAfter: 1792, recordsSelected: 1 },
      }),
    },
  });

  assert.deepEqual(JSON.parse(responses[0].result.content[0].text), {
    ok: true,
    code: "ok",
    outcome: "engine_fallback",
    checkedAt: "2026-09-04T00:00:00.000Z",
    sidecarVersion: "0.1.1",
  });
  assert.deepEqual(JSON.parse(responses[1].result.content[0].text), { changed: true, mode: "auto", code: "ok" });
  const status = JSON.parse(responses[2].result.content[0].text);
  assert.equal(status.mode, "auto");
  assert.equal(status.doctor.ok, true);
  assert.equal(status.doctor.outcome, "engine_fallback");
});

test("doctor fails when the service does not answer the plugin's request", async () => {
  for (const reason of ["authentication_failed", "request_mismatch", "timeout", "malformed_response", "selection_error"]) {
    const dataDir = await mkdtemp(join(tmpdir(), "needlepath-mcp-"));
    const responses = await request([
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "needlepath_doctor", arguments: {} } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "needlepath_set_mode", arguments: { mode: "auto" } } },
    ], {
      env: environment(dataDir),
      dependencies: {
        now: () => new Date("2026-09-04T00:00:00.000Z"),
        selectContext: async () => ({ applied: false, reason, selectedText: "", metadata: { serviceOk: false } }),
      },
    });

    assert.deepEqual(JSON.parse(responses[0].result.content[0].text), {
      ok: false,
      code: reason,
      outcome: reason,
      checkedAt: "2026-09-04T00:00:00.000Z",
      sidecarVersion: "0.1.1",
    }, reason);
    assert.deepEqual(JSON.parse(responses[1].result.content[0].text), {
      changed: false,
      mode: "shadow",
      code: "doctor_required",
    }, reason);
  }
});

test("auto mode requires a current successful doctor while other modes update state", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "needlepath-mcp-"));
  const autoBeforeDoctor = await request([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "needlepath_set_mode", arguments: { mode: "auto" } },
    },
  ], { env: environment(dataDir) });
  assert.equal(autoBeforeDoctor[0].result.isError, true);
  assert.deepEqual(JSON.parse(autoBeforeDoctor[0].result.content[0].text), {
    changed: false,
    mode: "shadow",
    code: "doctor_required",
  });

  const responses = await request([
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "needlepath_doctor", arguments: {} } },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "needlepath_set_mode", arguments: { mode: "auto" } },
    },
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "needlepath_set_mode", arguments: { mode: "off" } },
    },
  ], {
    env: environment(dataDir),
    dependencies: { selectContext: async () => ({ applied: true, reason: "ok", metadata: {} }) },
  });

  assert.deepEqual(JSON.parse(responses[1].result.content[0].text), {
    changed: true,
    mode: "auto",
    code: "ok",
  });
  assert.deepEqual(JSON.parse(responses[2].result.content[0].text), {
    changed: true,
    mode: "off",
    code: "ok",
  });
});

test("a stale successful doctor cannot enable auto mode", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "needlepath-mcp-"));
  let clockCalls = 0;
  const responses = await request([
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "needlepath_doctor", arguments: {} } },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "needlepath_set_mode", arguments: { mode: "auto" } },
    },
  ], {
    env: environment(dataDir),
    dependencies: {
      now: () => new Date(clockCalls++ === 0 ? "2026-08-01T00:00:00.000Z" : "2026-08-03T00:00:00.000Z"),
      selectContext: async () => ({ applied: true, reason: "ok", metadata: {} }),
    },
  });

  assert.equal(responses[1].result.isError, true);
  assert.deepEqual(JSON.parse(responses[1].result.content[0].text), {
    changed: false,
    mode: "shadow",
    code: "doctor_required",
  });
});

async function withHttpServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function readRequestJson(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return JSON.parse(body);
}

function fallbackAnswer(body) {
  const text = body.records[0].text;
  return {
    request_id: body.request_id,
    outcome: "engaged",
    policy_version: "np-2026-08-r4",
    fallback_used: true,
    selected: [{ record_id: body.records[0].id, text, reason: "full context fallback" }],
    rendered_context: text,
    tokens_before: 1792,
    tokens_after: 1792,
    tokens_saved: 0,
    reduction_ratio: 0,
    records_available: 1,
    records_selected: 1,
    engine_latency_ms: 12.5,
    selection_error: null,
    safety: { selection_safe: false, fallback_required: true },
  };
}

test("doctor judges real service answers through the client contract", async () => {
  const { selectContext } = await import("../src/needlepath-client.mjs");
  const cases = [
    ["full fallback answer", 200, fallbackAnswer, { ok: true, code: "ok", outcome: "engine_fallback" }],
    ["echo-only body", 200, (body) => ({ request_id: body.request_id }), { ok: false, code: "malformed_response", outcome: "malformed_response" }],
    ["non-200 success status", 201, fallbackAnswer, { ok: false, code: "http_201", outcome: "http_201" }],
    ["engine error", 200, (body) => ({ ...fallbackAnswer(body), selection_error: "engine unavailable" }), { ok: false, code: "selection_error", outcome: "selection_error" }],
    ["rejected key", 403, () => ({ detail: "forbidden" }), { ok: false, code: "authentication_failed", outcome: "authentication_failed" }],
  ];
  for (const [label, status, answer, expected] of cases) {
    await withHttpServer(async (incoming, response) => {
      const body = await readRequestJson(incoming);
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(answer(body)));
    }, async (baseUrl) => {
      const dataDir = await mkdtemp(join(tmpdir(), "needlepath-mcp-"));
      const responses = await request([
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "needlepath_doctor", arguments: {} } },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "needlepath_set_mode", arguments: { mode: "auto" } } },
      ], {
        env: environment(dataDir),
        dependencies: {
          now: () => new Date("2026-09-04T00:00:00.000Z"),
          selectContext: (input, config) => selectContext(input, { ...config, baseUrl }),
        },
      });
      const doctor = JSON.parse(responses[0].result.content[0].text);
      assert.deepEqual(doctor, { ...expected, checkedAt: "2026-09-04T00:00:00.000Z", sidecarVersion: "0.1.1" }, label);
      const mode = JSON.parse(responses[1].result.content[0].text);
      assert.equal(mode.changed, expected.ok, label);
      assert.equal(mode.mode, expected.ok ? "auto" : "shadow", label);
    });
  }
});

test("missing credentials fail doctor safely without attempting a diagnostic", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "needlepath-mcp-"));
  let calls = 0;
  const responses = await request([
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "needlepath_doctor", arguments: {} } },
  ], {
    env: environment(dataDir, { CLAUDE_PLUGIN_OPTION_NEEDLEPATH_API_KEY: "" }),
    dependencies: { selectContext: async () => { calls += 1; return { applied: true, reason: "ok" }; } },
  });

  assert.equal(calls, 0);
  const doctor = JSON.parse(responses[0].result.content[0].text);
  assert.match(doctor.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
  delete doctor.checkedAt;
  assert.deepEqual(doctor, {
    ok: false,
    code: "not_configured",
    outcome: null,
    sidecarVersion: "0.1.1",
  });
});
