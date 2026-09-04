import { loadConfig } from "./config.mjs";
import { selectContext as defaultSelectContext } from "./needlepath-client.mjs";
import { sanitizeProvenanceValue } from "./provenance.mjs";
import { readState, updateState } from "./state.mjs";
import { estimateTokens, projectToolOutput, reconstructToolOutput } from "./tool-output.mjs";

const MAX_HOOK_INPUT_BYTES = 8_000_000;
const MAX_TASK_FIELD_CHARS = 512;
const MAX_TASK_CHARS = 2048;
const TASK_FIELDS = [
  ["query", "query"],
  ["command", "command"],
  ["file_path", "path"],
  ["path", "path"],
  ["url", "url"],
  ["provenance", "provenance"],
];

function claudeVersionSupported(value) {
  if (!value) return true;
  const match = String(value).match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return true;
  const [, majorText, minorText, patchText] = match;
  const [major, minor, patch] = [majorText, minorText, patchText].map(Number);
  if (major !== 2) return false;
  if (minor < 1) return false;
  return minor > 1 || patch >= 207;
}

function outcomeForState(selection, mode) {
  const metadata = selection?.metadata || {};
  return {
    ...metadata,
    applied: mode === "auto" && selection?.applied === true,
    reason: mode === "shadow" && selection?.applied === true ? "shadow" : selection?.reason || "unknown",
  };
}

export function deriveTask(event) {
  const toolName = String(event?.tool_name || "").trim();
  const input = event?.tool_input;
  if (!toolName || !input || typeof input !== "object" || Array.isArray(input)) return "";
  const parts = TASK_FIELDS.flatMap(([field, label]) => {
    const value = sanitizeProvenanceValue(field, input[field], MAX_TASK_FIELD_CHARS);
    return value ? [`${label}: ${value}`] : [];
  });
  return parts.length ? `${toolName} | ${parts.join(" | ")}`.slice(0, MAX_TASK_CHARS) : "";
}

export async function handlePostToolUse(event, env = process.env, dependencies = {}) {
  try {
    const state = await readState(env.CLAUDE_PLUGIN_DATA);
    const config = loadConfig(env, state);
    if (["off", "emergency-pass-through"].includes(config.mode) || !config.apiKey) return null;
    if (!claudeVersionSupported(env.CLAUDE_CODE_VERSION)) return null;

    const projection = projectToolOutput(event);
    if (!projection || estimateTokens(projection.candidate) < config.minTokens) return null;
    const task = deriveTask(event);
    if (!task) return null;

    const selector = dependencies.selectContext || defaultSelectContext;
    let selection;
    try {
      selection = await selector(
        { projection, task },
        config,
      );
    } catch {
      return null;
    }

    if (config.telemetry) {
      await updateState(env.CLAUDE_PLUGIN_DATA, {
        lastOutcome: outcomeForState(selection, config.mode),
      });
    }
    if (config.mode !== "auto" || selection?.applied !== true) return null;
    const replacement = reconstructToolOutput(projection, selection.selectedText);
    if (replacement == null) return null;
    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedToolOutput: replacement,
      },
    };
  } catch {
    return null;
  }
}

export async function runSidecar({
  argv = [],
  stdin = "",
  env = process.env,
  writeStdout = (value) => process.stdout.write(value),
  dependencies = {},
} = {}) {
  try {
    if (Buffer.byteLength(stdin) > MAX_HOOK_INPUT_BYTES) return 0;
    const event = JSON.parse(stdin);
    let output = null;
    if (argv[0] === "hook" && argv[1] === "post-tool-use") {
      output = await handlePostToolUse(event, env, dependencies);
    }
    if (output != null) writeStdout(JSON.stringify(output));
  } catch {
    // Exit zero with no output so Claude uses the original event behavior.
  }
  return 0;
}
