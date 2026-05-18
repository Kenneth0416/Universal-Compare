export function extractJson(text: string): Record<string, unknown> {
  const trimmed = text.trim();

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null) return parsed;
  } catch {}

  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch {}
  }

  const braceStart = trimmed.indexOf('{');
  const braceEnd = trimmed.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      const parsed = JSON.parse(trimmed.slice(braceStart, braceEnd + 1));
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch {}
  }

  throw new Error(`Failed to extract valid JSON from response: ${trimmed.slice(0, 200)}`);
}

export function validateRequiredFields(
  data: Record<string, unknown>,
  schema: Record<string, unknown>,
): void {
  const required = schema.required;
  if (!Array.isArray(required)) return;

  const missing = required.filter(
    (field: string) => !(field in data) || data[field] === undefined,
  );
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }
}
