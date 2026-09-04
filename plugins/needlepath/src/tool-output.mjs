import { sanitizeProvenanceValue } from "./provenance.mjs";

const BUILTIN_TOOLS = new Set([
  "read",
  "grep",
  "search",
  "bash",
  "powershell",
  "webfetch",
  "websearch",
]);
const TEXT_FIELDS = ["stdout", "content", "text", "output"];

function supportedTool(name) {
  const normalized = String(name || "").toLowerCase();
  return normalized.startsWith("mcp__") || BUILTIN_TOOLS.has(normalized);
}

function sourceFor(input, toolName) {
  if (!input || typeof input !== "object") return String(toolName || "tool");
  for (const key of ["file_path", "path", "url", "query", "command"]) {
    const source = sanitizeProvenanceValue(key, input[key], 1024);
    if (source) return source;
  }
  return String(toolName || "tool");
}

function baseProjection(event, candidate, strategy) {
  return {
    candidate,
    original: event.tool_response,
    strategy,
    toolName: String(event.tool_name || ""),
    toolUseId: String(event.tool_use_id || ""),
    title: String(event.tool_name || "tool"),
    source: sourceFor(event.tool_input, event.tool_name),
    kind: "tool_result",
  };
}

export function projectToolOutput(event) {
  if (!event || !supportedTool(event.tool_name)) return null;
  const response = event.tool_response;
  if (typeof response === "string") {
    return response ? baseProjection(event, response, { type: "string" }) : null;
  }
  if (!response || typeof response !== "object" || Array.isArray(response)) return null;
  if (response.isError === true || response.isImage === true) return null;

  if (Array.isArray(response.content)) {
    if (
      response.content.length === 0 ||
      response.content.some(
        (block) => !block || typeof block !== "object" || block.type !== "text" || typeof block.text !== "string",
      )
    ) {
      return null;
    }
    const candidate = response.content.map((block) => block.text).join("\n\n");
    return candidate ? baseProjection(event, candidate, { type: "text-blocks" }) : null;
  }

  const populated = TEXT_FIELDS.filter(
    (field) => typeof response[field] === "string" && response[field].length > 0,
  );
  if (populated.length !== 1) return null;
  const field = populated[0];
  return baseProjection(event, response[field], { type: "field", field });
}

export function reconstructToolOutput(projection, selectedText) {
  if (!projection || typeof selectedText !== "string" || !selectedText) return null;
  if (projection.strategy.type === "string") return selectedText;
  if (projection.strategy.type === "field") {
    return { ...projection.original, [projection.strategy.field]: selectedText };
  }
  if (projection.strategy.type === "text-blocks") {
    return {
      ...projection.original,
      content: [{ ...projection.original.content[0], text: selectedText }],
    };
  }
  return null;
}

export function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}
