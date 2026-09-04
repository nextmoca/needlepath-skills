import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function hookModule() {
  try {
    return await import("../src/hook.mjs");
  } catch {
    return {};
  }
}

async function stateModule() {
  return import("../src/state.mjs");
}

function environment(dataDir, overrides = {}) {
  return {
    CLAUDE_PLUGIN_DATA: dataDir,
    CLAUDE_PLUGIN_OPTION_NEEDLEPATH_API_KEY: "np_test_secret",
    CLAUDE_PLUGIN_OPTION_NEEDLEPATH_MODE: "shadow",
    CLAUDE_PLUGIN_OPTION_NEEDLEPATH_MIN_TOKENS: "256",
    ...overrides,
  };
}

function postToolEvent(response = "A".repeat(4096)) {
  return {
    session_id: "session-hook",
    hook_event_name: "PostToolUse",
    tool_name: "Read",
    tool_input: { file_path: "/repo/app.js" },
    tool_response: response,
    tool_use_id: "toolu_hook",
  };
}

function appliedSelection(text = "selected line") {
  return {
    applied: true,
    reason: "ok",
    selectedText: text,
    metadata: {
      applied: true,
      reason: "ok",
      tokensBefore: 1024,
      tokensAfter: 3,
      tokensSaved: 1021,
      reductionRatio: 0.997,
      latencyMs: 12,
      recordsAvailable: 1,
      recordsSelected: 1,
      attempts: 1,
      requestBytes: 5000,
    },
  };
}

test("plugin registers no UserPromptSubmit hook or prompt persistence path", async () => {
  const root = await mkdtemp(join(tmpdir(), "needlepath-hook-"));
  const { handleUserPromptSubmit, runSidecar } = await hookModule();
  const hooks = JSON.parse(await readFile(new URL("../hooks/hooks.json", import.meta.url), "utf8"));

  assert.equal(Object.hasOwn(hooks.hooks, "UserPromptSubmit"), false);
  assert.equal(handleUserPromptSubmit, undefined);
  await runSidecar?.(
    {
      argv: ["hook", "user-prompt-submit"],
      stdin: JSON.stringify({ session_id: "session-hook", prompt: "private Claude prompt" }),
      env: environment(root),
    },
  );
  assert.deepEqual(await readdir(root), []);
});

test("shadow sends a bounded task from current tool input without persisting prompt data", async () => {
  const root = await mkdtemp(join(tmpdir(), "needlepath-hook-"));
  const { handlePostToolUse } = await hookModule();
  const { readState } = await stateModule();
  const original = {
    ...postToolEvent(),
    tool_name: "Grep",
    tool_input: {
      query: "needlepath doctor",
      path: "/repo/src",
      prompt: "private Claude prompt",
      session_id: "session-hook",
    },
  };
  let request;

  const output = await handlePostToolUse?.(original, environment(root), {
    selectContext: async (input) => {
      request = input;
      return appliedSelection();
    },
  });

  assert.equal(output, null);
  assert.equal(original.tool_response, "A".repeat(4096));
  assert.ok(request);
  assert.equal(request.task, "Grep | query: needlepath doctor | path: /repo/src");
  assert.equal(JSON.stringify(request).includes("private Claude prompt"), false);
  assert.deepEqual(await readdir(root), ["state.json"]);
  assert.deepEqual((await readState(root)).lastOutcome, {
    applied: false,
    reason: "shadow",
    tokensBefore: 1024,
    tokensAfter: 3,
    tokensSaved: 1021,
    reductionRatio: 0.997,
    latencyMs: 12,
    recordsAvailable: 1,
    recordsSelected: 1,
  });
});

test("credential-bearing tool input never becomes record source when safe provenance enables selection", async () => {
  const root = await mkdtemp(join(tmpdir(), "needlepath-hook-"));
  const { handlePostToolUse } = await hookModule();
  let request;
  const credential = ["np", "live", "secret-for-test-only"].join("_");
  const authorization = ["Authorization", `Bearer ${credential}`].join(": ");

  await handlePostToolUse?.(
    {
      ...postToolEvent(),
      tool_name: "Bash",
      tool_input: {
        command: `curl -H '${authorization}' https://example.test`,
        provenance: "check dependency status",
      },
    },
    environment(root),
    {
      selectContext: async (input) => {
        request = input;
        return appliedSelection();
      },
    },
  );

  assert.equal(request?.task, "Bash | provenance: check dependency status");
  assert.equal(request?.projection.source, "Bash");
  assert.equal(JSON.stringify(request).includes(credential), false);
});

test("a raw Needlepath key in tool input is excluded from task and record provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "needlepath-hook-"));
  const { handlePostToolUse } = await hookModule();
  let request;
  const credential = ["np", "live", "abcdefghijklmno"].join("_");

  await handlePostToolUse?.(
    {
      ...postToolEvent(),
      tool_name: "Bash",
      tool_input: {
        command: `needlepath ping ${credential}`,
        provenance: "check connectivity",
      },
    },
    environment(root),
    {
      selectContext: async (input) => {
        request = input;
        return appliedSelection();
      },
    },
  );

  assert.equal(request?.task, "Bash | provenance: check connectivity");
  assert.equal(request?.projection.source, "Bash");
  assert.equal(JSON.stringify(request).includes(credential), false);
});

test("auto returns only a schema-valid replacement for a fully applied selection", async () => {
  const root = await mkdtemp(join(tmpdir(), "needlepath-hook-"));
  const { handlePostToolUse } = await hookModule();
  const { updateState } = await stateModule();
  await updateState(root, {
    doctor: { ok: true, code: "ok", checkedAt: new Date().toISOString(), sidecarVersion: "0.1.0" },
  });

  const output = await handlePostToolUse?.(
    postToolEvent({
      stdout: "A".repeat(4096),
      stderr: "warning",
      interrupted: false,
      isImage: false,
    }),
    environment(root, { CLAUDE_PLUGIN_OPTION_NEEDLEPATH_MODE: "auto" }),
    { selectContext: async () => appliedSelection("selected stdout") },
  );

  assert.deepEqual(output, {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      updatedToolOutput: {
        stdout: "selected stdout",
        stderr: "warning",
        interrupted: false,
        isImage: false,
      },
    },
  });
  assert.equal(JSON.stringify(output).includes("A".repeat(100)), false);
});

test("direct auto configuration shadows eligible output until doctor succeeds", async () => {
  const root = await mkdtemp(join(tmpdir(), "needlepath-hook-"));
  const { handlePostToolUse } = await hookModule();
  const { readState } = await stateModule();

  const output = await handlePostToolUse?.(
    postToolEvent(),
    environment(root, { CLAUDE_PLUGIN_OPTION_NEEDLEPATH_MODE: "auto" }),
    { selectContext: async () => appliedSelection("selected") },
  );

  assert.equal(output, null);
  assert.equal((await readState(root)).lastOutcome?.reason, "shadow");
});

test("unusable task input and local gates return exact pass-through", async () => {
  const root = await mkdtemp(join(tmpdir(), "needlepath-hook-"));
  const { handlePostToolUse } = await hookModule();
  const { updateState } = await stateModule();
  const throwsIfCalled = async () => {
    throw new Error("selector should not be called");
  };
  const cases = [
    [postToolEvent(), environment(root, { CLAUDE_PLUGIN_OPTION_NEEDLEPATH_MODE: "off" })],
    [postToolEvent(), environment(root, { CLAUDE_PLUGIN_OPTION_NEEDLEPATH_API_KEY: "" })],
    [postToolEvent("small"), environment(root)],
    [{ ...postToolEvent(), tool_name: "Write" }, environment(root)],
    [postToolEvent(), environment(root, { CLAUDE_CODE_VERSION: "3.0.0" })],
    [{ ...postToolEvent(), tool_input: { prompt: "private Claude prompt" } }, environment(root)],
  ];
  for (const [event, env] of cases) {
    assert.equal(await handlePostToolUse?.(event, env, { selectContext: throwsIfCalled }), null);
  }

  await updateState(root, { emergencyPassThrough: true });
  assert.equal(
    await handlePostToolUse?.(postToolEvent(), environment(root), { selectContext: throwsIfCalled }),
    null,
  );

  await updateState(root, { emergencyPassThrough: false, mode: "auto" });
  const output = await handlePostToolUse?.(postToolEvent(), environment(root), {
    selectContext: async () => {
      throw new Error("private prompt: do not expose");
    },
  });
  assert.equal(output, null);
});

test("sidecar dispatch writes JSON only for a replacement and stays silent on malformed input", async () => {
  const root = await mkdtemp(join(tmpdir(), "needlepath-hook-"));
  const { runSidecar } = await hookModule();
  const { updateState } = await stateModule();
  await updateState(root, {
    doctor: { ok: true, code: "ok", checkedAt: new Date().toISOString(), sidecarVersion: "0.1.0" },
  });

  const chunks = [];
  const code = await runSidecar?.({
    argv: ["hook", "post-tool-use"],
    stdin: JSON.stringify(postToolEvent()),
    env: environment(root, { CLAUDE_PLUGIN_OPTION_NEEDLEPATH_MODE: "auto" }),
    writeStdout: (value) => chunks.push(value),
    dependencies: { selectContext: async () => appliedSelection("selected") },
  });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(chunks.join("")), {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      updatedToolOutput: "selected",
    },
  });

  const silent = [];
  assert.equal(
    await runSidecar?.({
      argv: ["hook", "post-tool-use"],
      stdin: "not-json",
      env: environment(root),
      writeStdout: (value) => silent.push(value),
    }),
    0,
  );
  assert.deepEqual(silent, []);
});
