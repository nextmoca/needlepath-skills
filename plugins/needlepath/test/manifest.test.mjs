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

test("direct auto configuration downgrades to shadow without a current doctor", async () => {
  const { loadConfig } = await importConfig();
  const env = {
    CLAUDE_PLUGIN_OPTION_NEEDLEPATH_API_KEY: "np_test_secret",
    CLAUDE_PLUGIN_OPTION_NEEDLEPATH_MODE: "auto",
  };

  assert.equal(loadConfig?.(env, {}).mode, "shadow");
  assert.equal(loadConfig?.(env, {
    doctor: { ok: true, code: "ok", checkedAt: "2020-01-01T00:00:00.000Z" },
  }).mode, "shadow");
  assert.equal(loadConfig?.(env, {
    doctor: { ok: true, code: "ok", checkedAt: new Date().toISOString() },
  }).mode, "auto");
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
