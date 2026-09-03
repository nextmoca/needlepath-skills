import assert from "node:assert/strict";
import test from "node:test";

async function outputModule() {
  try {
    return await import("../src/tool-output.mjs");
  } catch {
    return {};
  }
}

test("Bash projection replaces stdout and preserves execution metadata", async () => {
  const { projectToolOutput, reconstructToolOutput } = await outputModule();
  const response = {
    stdout: "line one\nline two\n",
    stderr: "warning",
    interrupted: false,
    isImage: false,
  };
  const projection = projectToolOutput?.({
    tool_name: "Bash",
    tool_input: { command: "npm test" },
    tool_response: response,
    tool_use_id: "toolu_1",
  });

  assert.equal(projection?.candidate, response.stdout);
  assert.deepEqual(reconstructToolOutput?.(projection, "line two\n"), {
    stdout: "line two\n",
    stderr: "warning",
    interrupted: false,
    isImage: false,
  });
  assert.deepEqual(response, {
    stdout: "line one\nline two\n",
    stderr: "warning",
    interrupted: false,
    isImage: false,
  });
});

test("string and common content fields preserve their native output shape", async () => {
  const { projectToolOutput, reconstructToolOutput } = await outputModule();
  const stringProjection = projectToolOutput?.({
    tool_name: "Read",
    tool_input: { file_path: "/repo/app.js" },
    tool_response: "1: alpha\n2: beta",
    tool_use_id: "toolu_2",
  });
  const objectProjection = projectToolOutput?.({
    tool_name: "WebFetch",
    tool_input: { url: "https://example.test" },
    tool_response: { content: "long page", statusCode: 200, url: "https://example.test" },
    tool_use_id: "toolu_3",
  });

  assert.equal(reconstructToolOutput?.(stringProjection, "2: beta"), "2: beta");
  assert.deepEqual(reconstructToolOutput?.(objectProjection, "selected page"), {
    content: "selected page",
    statusCode: 200,
    url: "https://example.test",
  });
});

test("MCP text blocks are selected together while non-content metadata survives", async () => {
  const { projectToolOutput, reconstructToolOutput } = await outputModule();
  const projection = projectToolOutput?.({
    tool_name: "mcp__github__search_code",
    tool_input: { query: "needlepath" },
    tool_response: {
      content: [
        { type: "text", text: "result one" },
        { type: "text", text: "result two" },
      ],
      isError: false,
      traceId: "trace-1",
    },
    tool_use_id: "toolu_4",
  });

  assert.equal(projection?.candidate, "result one\n\nresult two");
  assert.deepEqual(reconstructToolOutput?.(projection, "result two"), {
    content: [{ type: "text", text: "result two" }],
    isError: false,
    traceId: "trace-1",
  });
});

test("unsupported tools, multimodal blocks, failed results, and ambiguous fields stand down", async () => {
  const { projectToolOutput } = await outputModule();
  const cases = [
    { tool_name: "Write", tool_response: { content: "changed file" } },
    { tool_name: "Bash", tool_response: { stdout: "x", stderr: "", isImage: true } },
    {
      tool_name: "mcp__media__inspect",
      tool_response: { content: [{ type: "image", data: "base64" }] },
    },
    { tool_name: "WebFetch", tool_response: { content: "a", text: "b" } },
    { tool_name: "mcp__db__query", tool_response: { content: "error", isError: true } },
  ];

  for (const event of cases) {
    assert.equal(projectToolOutput?.({ ...event, tool_input: {}, tool_use_id: "x" }), null);
  }
});
