export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function previewText(value: string, maxLength = 120): string {
  const compactValue = value.replace(/\s+/g, " ").trim();

  if (compactValue.length <= maxLength) {
    return compactValue;
  }

  return `${compactValue.slice(0, maxLength - 1)}…`;
}
