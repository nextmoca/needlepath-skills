import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function stateModule() {
  try {
    return await import("../src/state.mjs");
  } catch {
    return {};
  }
}

test("persistent state has no prompt or session content storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "needlepath-state-"));
  const { captureTask, readTask, updateState } = await stateModule();

  await updateState?.(root, { mode: "shadow", prompt: "private Claude prompt" });

  assert.equal(captureTask, undefined);
  assert.equal(readTask, undefined);
  assert.deepEqual(await readdir(root), ["state.json"]);
  assert.equal((await readFile(join(root, "state.json"), "utf8")).includes("private Claude prompt"), false);
});

test("persistent state keeps metadata and drops content and credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "needlepath-state-"));
  const { readState, updateState } = await stateModule();
  const credential = ["np", "live", "secret"].join("_");
  const authorization = ["Authorization", `Bearer ${credential}`].join(": ");

  await updateState?.(root, {
    mode: "auto",
    emergencyPassThrough: false,
    lastOutcome: {
      applied: true,
      reason: "ok",
      tokensBefore: 5000,
      tokensAfter: 1800,
      latencyMs: 42,
      selectedText: "customer secret",
      rawError: authorization,
    },
    apiKey: credential,
    prompt: "private prompt",
  });

  const state = await readState?.(root);
  const raw = await readFile(join(root, "state.json"), "utf8").catch(() => "");
  assert.deepEqual(state, {
    mode: "auto",
    emergencyPassThrough: false,
    lastOutcome: {
      applied: true,
      reason: "ok",
      tokensBefore: 5000,
      tokensAfter: 1800,
      tokensSaved: 3200,
      reductionRatio: 0.64,
      latencyMs: 42,
      recordsAvailable: 0,
      recordsSelected: 0,
    },
  });
  assert.equal(raw.includes("customer secret"), false);
  assert.equal(raw.includes(credential), false);
  assert.equal(raw.includes("private prompt"), false);
});

test("malformed state is treated as an empty shadow-safe state", async () => {
  const root = await mkdtemp(join(tmpdir(), "needlepath-state-"));
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { readState } = await stateModule();
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "state.json"), "not-json", "utf8");

  assert.deepEqual(await readState?.(root), {});
});
