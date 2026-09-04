import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

async function readJson(path) {
  try {
    return JSON.parse(await readFile(new URL(path, ROOT), "utf8"));
  } catch {
    return {};
  }
}

async function importConfig() {
  try {
    return await import("../src/config.mjs");
  } catch {
    return {};
  }
}

test("a new install starts in shadow with a sensitive optional API key", async () => {
  const manifest = await readJson(".claude-plugin/plugin.json");
  const key = manifest.userConfig?.needlepath_api_key;

  assert.equal(manifest.name, "needlepath");
  assert.equal(manifest.defaultEnabled, true);
  assert.deepEqual(key, {
    type: "string",
    title: "Needlepath API key",
    description:
      "Don't have a key? Create an account at https://console.nextmoca.com, generate an API key, and enter it here.",
    sensitive: true,
    required: false,
  });
  assert.equal(manifest.userConfig?.needlepath_mode?.default, "shadow");
});

test("configuration is bounded and pins the production operating point", async () => {
  const { loadConfig } = await importConfig();
  const config = loadConfig?.(
    {
      CLAUDE_PLUGIN_OPTION_NEEDLEPATH_API_KEY: "np_test_secret",
      CLAUDE_PLUGIN_OPTION_NEEDLEPATH_MODE: "auto",
      CLAUDE_PLUGIN_OPTION_NEEDLEPATH_BASE_URL: "https://selector.example/base/",
      CLAUDE_PLUGIN_OPTION_NEEDLEPATH_MIN_TOKENS: "1",
      CLAUDE_PLUGIN_OPTION_NEEDLEPATH_MAX_CONTEXT_TOKENS: "999999",
      CLAUDE_PLUGIN_OPTION_NEEDLEPATH_TIMEOUT_MS: "999999",
      CLAUDE_PLUGIN_OPTION_NEEDLEPATH_TELEMETRY: "false",
    },
    {},
  );

  assert.deepEqual(config, {
    apiKey: "np_test_secret",
    mode: "shadow",
    modeReason: "doctor_required",
    baseUrl: "https://selector.example/base",
    minTokens: 256,
    maxContextTokens: 65536,
    timeoutMs: 10000,
    telemetry: false,
    operatingPoint: "np-2026-08-r4",
    maxRequestBytes: 5_500_000,
  });

  assert.equal(Object.hasOwn(await readJson(".claude-plugin/plugin.json"), "metadata"), false);
});

test("auto needs a successful doctor, which does not expire", async () => {
  const { loadConfig } = await importConfig();
  const env = {
    CLAUDE_PLUGIN_OPTION_NEEDLEPATH_API_KEY: "np_test_secret",
    CLAUDE_PLUGIN_OPTION_NEEDLEPATH_MODE: "auto",
  };

  const never = loadConfig?.(env, {});
  assert.equal(never.mode, "shadow");
  assert.equal(never.modeReason, "doctor_required");

  const failed = loadConfig?.(env, { doctor: { ok: false, code: "authentication_failed", checkedAt: new Date().toISOString() } });
  assert.equal(failed.mode, "shadow");
  assert.equal(failed.modeReason, "doctor_required");

  for (const checkedAt of ["2020-01-01T00:00:00.000Z", new Date().toISOString()]) {
    const config = loadConfig?.(env, { doctor: { ok: true, code: "ok", checkedAt } });
    assert.equal(config.mode, "auto", checkedAt);
    assert.equal(config.modeReason, null, checkedAt);
  }
});

test("off in the settings outranks whatever a skill last wrote to state", async () => {
  const { loadConfig } = await importConfig();
  const env = {
    CLAUDE_PLUGIN_OPTION_NEEDLEPATH_API_KEY: "np_test_secret",
    CLAUDE_PLUGIN_OPTION_NEEDLEPATH_MODE: "off",
  };
  const doctor = { ok: true, code: "ok", checkedAt: new Date().toISOString() };

  for (const state of [{}, { mode: "shadow" }, { mode: "auto", doctor }]) {
    assert.equal(loadConfig?.(env, state).mode, "off", JSON.stringify(state));
  }
  // Emergency pass-through still wins, because it is the remote stop control.
  assert.equal(loadConfig?.(env, { emergencyPassThrough: true }).mode, "emergency-pass-through");
});

test("invalid modes and non-TLS remote endpoints fail closed to shadow defaults", async () => {
  const { loadConfig } = await importConfig();
  const config = loadConfig?.(
    {
      CLAUDE_PLUGIN_OPTION_NEEDLEPATH_MODE: "delete-everything",
      CLAUDE_PLUGIN_OPTION_NEEDLEPATH_BASE_URL: "http://selector.example",
      CLAUDE_PLUGIN_OPTION_NEEDLEPATH_MIN_TOKENS: "not-a-number",
    },
    { mode: "also-invalid" },
  );

  assert.equal(config?.mode, "shadow");
  assert.equal(config?.baseUrl, "https://api.nextmoca.com");
  assert.equal(config?.minTokens, 4000);
  assert.equal(config?.apiKey, "");

  const credentialUrl = loadConfig?.({
    CLAUDE_PLUGIN_OPTION_NEEDLEPATH_BASE_URL: "https://user:password@selector.example",
  }, {});
  assert.equal(credentialUrl?.baseUrl, "https://api.nextmoca.com");
});

test("the MCP server declares every option it reads", async () => {
  const [mcp, manifest] = await Promise.all([
    readFile(new URL(".mcp.json", ROOT), "utf8").then(JSON.parse),
    readFile(new URL(".claude-plugin/plugin.json", ROOT), "utf8").then(JSON.parse),
  ]);
  const source = await readFile(new URL("src/config.mjs", ROOT), "utf8");
  // Claude Code passes an MCP server only the environment its .mcp.json declares,
  // so every option the server reads has to be mapped here or it is never configured.
  const read = [...new Set(source.match(/CLAUDE_PLUGIN_OPTION_[A-Z_]+/g) || [])].sort();
  const declared = mcp.mcpServers?.needlepath?.env || {};
  assert.ok(read.length > 0);
  for (const name of read) {
    const key = name.replace("CLAUDE_PLUGIN_OPTION_", "").toLowerCase();
    assert.equal(declared[name], `\${user_config.${key}}`, name);
    assert.ok(manifest.userConfig?.[key], `${key} must be a declared option`);
  }
  for (const [name, value] of Object.entries(declared)) {
    assert.ok(read.includes(name), `${name} is passed but never read`);
    assert.match(value, /^\$\{user_config\.[a-z_]+\}$/, name);
  }
});
