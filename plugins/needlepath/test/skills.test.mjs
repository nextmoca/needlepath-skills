import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);
async function skill(name) {
  return readFile(new URL(`skills/${name}/SKILL.md`, ROOT), "utf8");
}

function assertBaseShape(name, document) {
  assert.match(document, new RegExp(`^---\\nname: needlepath-${name}\\ndescription: Use when `));
  assert.equal(document.includes("CLAUDE_PLUGIN_OPTION_NEEDLEPATH_API_KEY"), false);
  assert.equal(document.includes("Bearer "), false);
  assert.ok(document.trim().split(/\s+/).length < 220, name);
}

test("setup skill starts shadow-safe and routes credentials to the console", async () => {
  const document = await skill("setup");
  assertBaseShape("setup", document);
  assert.match(document, /https:\/\/console\.nextmoca\.com/);
  assert.match(document, /do not paste (an )?API key into Claude/i);
  assert.match(document, /needlepath_status/);
  assert.match(document, /needlepath_doctor/);
  assert.match(document, /bounded provenance from the current tool input/i);
  assert.doesNotMatch(document, /current task/i);
});

test("doctor skill runs diagnostics without requesting a pasted credential", async () => {
  const document = await skill("doctor");
  assertBaseShape("doctor", document);
  assert.match(document, /https:\/\/console\.nextmoca\.com/);
  assert.match(document, /do not paste (an )?API key into Claude/i);
  assert.match(document, /needlepath_doctor/);
});

test("status skill invokes the metadata-only status control", async () => {
  const document = await skill("status");
  assertBaseShape("status", document);
  assert.match(document, /needlepath_status/);
  assert.match(document, /https:\/\/console\.nextmoca\.com/);
  assert.match(document, /do not paste (an )?API key into Claude/i);
});

test("enable skill requires doctor before requesting auto mode", async () => {
  const enable = await skill("enable");
  assertBaseShape("enable", enable);
  assert.match(enable, /needlepath_doctor/);
  assert.match(enable, /needlepath_set_mode/);
  assert.match(enable, /"auto"/);
  assert.match(enable, /successful doctor/i);
  assert.match(enable, /https:\/\/console\.nextmoca\.com/);
  assert.match(enable, /do not paste (an )?API key into Claude/i);
});

test("disable skill returns to shadow and says how to stop calls entirely", async () => {
  const disable = await skill("disable");
  assertBaseShape("disable", disable);
  assert.match(disable, /needlepath_set_mode/);
  assert.match(disable, /"shadow"/);
  assert.match(disable, /`off`/);
});
