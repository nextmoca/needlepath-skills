import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const MODES = new Set(["off", "shadow", "auto", "emergency-pass-through"]);

async function ensureDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(path, 0o700);
}

async function atomicJsonWrite(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") await chmod(temporary, 0o600);
  await rename(temporary, path);
  if (process.platform !== "win32") await chmod(path, 0o600);
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sanitizeLastOutcome(value) {
  if (!value || typeof value !== "object") return undefined;
  const tokensBefore = finite(value.tokensBefore);
  const tokensAfter = finite(value.tokensAfter);
  return {
    applied: value.applied === true,
    reason: String(value.reason || "unknown").slice(0, 128),
    tokensBefore,
    tokensAfter,
    tokensSaved: Math.max(0, finite(value.tokensSaved, tokensBefore - tokensAfter)),
    reductionRatio: Math.max(
      0,
      Math.min(1, finite(value.reductionRatio, tokensBefore ? (tokensBefore - tokensAfter) / tokensBefore : 0)),
    ),
    latencyMs: Math.max(0, finite(value.latencyMs)),
    recordsAvailable: Math.max(0, finite(value.recordsAvailable)),
    recordsSelected: Math.max(0, finite(value.recordsSelected)),
  };
}

function sanitizeDoctor(value) {
  if (!value || typeof value !== "object") return undefined;
  return {
    ok: value.ok === true,
    checkedAt: String(value.checkedAt || "").slice(0, 64),
    code: String(value.code || "unknown").slice(0, 128),
    sidecarVersion: String(value.sidecarVersion || "").slice(0, 64),
  };
}

function sanitizeState(value) {
  if (!value || typeof value !== "object") return {};
  const state = {};
  if (MODES.has(value.mode)) state.mode = value.mode;
  if (typeof value.emergencyPassThrough === "boolean") {
    state.emergencyPassThrough = value.emergencyPassThrough;
  }
  const lastOutcome = sanitizeLastOutcome(value.lastOutcome);
  if (lastOutcome) state.lastOutcome = lastOutcome;
  const doctor = sanitizeDoctor(value.doctor);
  if (doctor) state.doctor = doctor;
  return state;
}

export async function readState(dataDir) {
  if (!dataDir) return {};
  try {
    return sanitizeState(JSON.parse(await readFile(join(dataDir, "state.json"), "utf8")));
  } catch {
    return {};
  }
}

export async function updateState(dataDir, patch) {
  if (!dataDir) return {};
  await ensureDirectory(dataDir);
  const current = await readState(dataDir);
  const next = sanitizeState({ ...current, ...patch });
  await atomicJsonWrite(join(dataDir, "state.json"), next);
  return next;
}
