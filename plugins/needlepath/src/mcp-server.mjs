#!/usr/bin/env node

import { createInterface } from "node:readline";
import { hasRecentSuccessfulDoctor, loadConfig } from "./config.mjs";
import { selectContext as defaultSelectContext } from "./needlepath-client.mjs";
import { readState, updateState } from "./state.mjs";

const MODES = ["off", "shadow", "auto", "emergency-pass-through"];
const SIDECAR_VERSION = "0.1.1";

const TOOLS = [
  {
    name: "needlepath_status",
    description: "Show Needlepath configuration and metadata-only operational state.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "needlepath_doctor",
    description: "Run a metadata-only Needlepath connectivity diagnostic.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "needlepath_set_mode",
    description: "Set the local Needlepath operating mode.",
    inputSchema: {
      type: "object",
      properties: { mode: { type: "string", enum: MODES } },
      required: ["mode"],
      additionalProperties: false,
    },
  },
];

function content(value, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], ...(isError ? { isError } : {}) };
}

function error(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function result(id, value) {
  return { jsonrpc: "2.0", id, result: value };
}

function status(config, state) {
  return {
    mode: config.mode,
    configured: Boolean(config.apiKey),
    emergencyPassThrough: state.emergencyPassThrough === true,
    lastOutcome: state.lastOutcome || null,
    doctor: state.doctor || null,
  };
}

function diagnosticProjection() {
  return {
    candidate: "Needlepath diagnostic text. ".repeat(256),
    original: "",
    strategy: { type: "string" },
    toolName: "NeedlepathDoctor",
    toolUseId: "needlepath-doctor",
    title: "Needlepath connectivity diagnostic",
    source: "needlepath://doctor",
    kind: "tool_result",
  };
}

async function runDoctor(env, dependencies) {
  const state = await readState(env.CLAUDE_PLUGIN_DATA);
  const config = loadConfig(env, state);
  const now = dependencies.now?.() || new Date();
  let code = "not_configured";
  let outcome = null;
  let ok = false;

  if (config.apiKey) {
    try {
      const selector = dependencies.selectContext || defaultSelectContext;
      const selection = await selector(
        { projection: diagnosticProjection(), task: "Needlepath connectivity diagnostic" },
        config,
      );
      // The diagnostic checks that the service answers this plugin's request with the
      // configured key. What the engine decides about the probe (applied, returned
      // unchanged, escalated) is reported as the outcome and does not fail the check.
      outcome = String(selection?.reason || "diagnostic_failed").slice(0, 128);
      ok = selection?.applied === true || selection?.metadata?.serviceOk === true;
      code = ok ? "ok" : outcome;
    } catch {
      code = "diagnostic_failed";
      outcome = code;
    }
  }

  const doctor = { ok, checkedAt: now.toISOString(), code, outcome, sidecarVersion: SIDECAR_VERSION };
  await updateState(env.CLAUDE_PLUGIN_DATA, { doctor });
  return { ok, code, outcome, checkedAt: doctor.checkedAt, sidecarVersion: SIDECAR_VERSION };
}

async function callTool(name, args, env, dependencies) {
  if (name === "needlepath_status") {
    const state = await readState(env.CLAUDE_PLUGIN_DATA);
    return content(status(loadConfig(env, state), state));
  }
  if (name === "needlepath_doctor") return content(await runDoctor(env, dependencies));
  if (name !== "needlepath_set_mode") return null;

  const mode = args?.mode;
  if (!MODES.includes(mode)) return content({ changed: false, mode: "shadow", code: "invalid_mode" }, true);
  const state = await readState(env.CLAUDE_PLUGIN_DATA);
  const config = loadConfig(env, state);
  const now = (dependencies.now?.() || new Date()).getTime();
  if (mode === "auto" && !hasRecentSuccessfulDoctor(state.doctor, now)) {
    return content({ changed: false, mode: config.mode, code: "doctor_required" }, true);
  }
  await updateState(env.CLAUDE_PLUGIN_DATA, {
    mode,
    emergencyPassThrough: mode === "emergency-pass-through",
  });
  return content({ changed: true, mode, code: "ok" });
}

export async function handleMcpRequest(request, env = process.env, dependencies = {}) {
  if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") return null;
  const { id, method, params = {} } = request;
  if (method === "notifications/initialized") return null;
  if (method === "initialize") {
    return result(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "needlepath", version: SIDECAR_VERSION },
    });
  }
  if (method === "tools/list") return result(id, { tools: TOOLS });
  if (method === "tools/call") {
    const value = await callTool(params.name, params.arguments || {}, env, dependencies);
    return value ? result(id, value) : error(id, -32602, "Unknown tool");
  }
  return error(id, -32601, "Method not found");
}

async function processMcpLine(line, env, writeStdout, dependencies) {
  if (!line.trim()) return;
  try {
    const response = await handleMcpRequest(JSON.parse(line), env, dependencies);
    if (response != null) writeStdout(JSON.stringify(response));
  } catch {
    // A malformed local request has no safe, useful diagnostic payload.
  }
}

export async function runMcpStream(lines, {
  env = process.env,
  writeStdout = (line) => process.stdout.write(`${line}\n`),
  dependencies = {},
} = {}) {
  for await (const line of lines) await processMcpLine(String(line), env, writeStdout, dependencies);
  return 0;
}

export async function runMcpServer({ stdin = "", ...options } = {}) {
  return runMcpStream(String(stdin).split(/\r?\n/), options);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runMcpStream(createInterface({ input: process.stdin, crlfDelay: Infinity }));
}
