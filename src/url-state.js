export function parseSteppedNumberParam(params, key, { fallback, min, max, step }) {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;

  return clamp(Math.round(value / step) * step, min, max);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
