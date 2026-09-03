const CREDENTIAL_PATTERNS = [
  /(?:api[_-]?key|access[_-]?key|token|password|secret|authorization)\s*(?:=|:)/i,
  /\bbearer\s+\S+/i,
  /\bnp_(?:live|prod)_[A-Za-z0-9_-]{8,}\b/,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

export function sanitizeProvenanceValue(field, value, maxChars) {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized === "." || normalized === "/") return "";
  if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(normalized))) return "";
  if (field === "url") {
    try {
      const parsed = new URL(normalized);
      if (parsed.username || parsed.password) return "";
    } catch {
      return "";
    }
  }
  return normalized.slice(0, maxChars);
}
