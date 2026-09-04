const MODES = new Set(["off", "shadow", "auto", "emergency-pass-through"]);
const DEFAULT_BASE_URL = "https://api.nextmoca.com";

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function booleanValue(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  return fallback;
}

function safeBaseUrl(value) {
  try {
    const url = new URL(value || DEFAULT_BASE_URL);
    const loopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    if (url.username || url.password) return DEFAULT_BASE_URL;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
      return DEFAULT_BASE_URL;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_BASE_URL;
  }
}

// A successful diagnostic is required before automatic selection, and it does not
// expire. Each response is contract-validated on its own, and an unreachable service,
// a rejected key, a timeout or an unusable response keeps the original tool result, so
// re-checking the diagnostic on a clock would stop selection without adding a check.
export function hasSuccessfulDoctor(doctor) {
  return doctor?.ok === true && doctor.code === "ok";
}

export function loadConfig(env = process.env, state = {}) {
  const configuredMode = env.CLAUDE_PLUGIN_OPTION_NEEDLEPATH_MODE;
  const requestedMode = state.emergencyPassThrough
    ? "emergency-pass-through"
    : state.mode || configuredMode || "shadow";

  const mode = MODES.has(requestedMode) ? requestedMode : "shadow";
  const downgraded = mode === "auto" && !hasSuccessfulDoctor(state.doctor);

  return {
    apiKey: env.CLAUDE_PLUGIN_OPTION_NEEDLEPATH_API_KEY || "",
    mode: downgraded ? "shadow" : mode,
    modeReason: downgraded ? "doctor_required" : null,
    baseUrl: safeBaseUrl(env.CLAUDE_PLUGIN_OPTION_NEEDLEPATH_BASE_URL),
    minTokens: boundedNumber(
      env.CLAUDE_PLUGIN_OPTION_NEEDLEPATH_MIN_TOKENS,
      4000,
      256,
      1_000_000,
    ),
    maxContextTokens: boundedNumber(
      env.CLAUDE_PLUGIN_OPTION_NEEDLEPATH_MAX_CONTEXT_TOKENS,
      8000,
      256,
      65_536,
    ),
    timeoutMs: boundedNumber(
      env.CLAUDE_PLUGIN_OPTION_NEEDLEPATH_TIMEOUT_MS,
      3000,
      250,
      10_000,
    ),
    telemetry: booleanValue(env.CLAUDE_PLUGIN_OPTION_NEEDLEPATH_TELEMETRY, true),
    operatingPoint: "np-2026-08-r4",
    maxRequestBytes: 5_500_000,
  };
}
