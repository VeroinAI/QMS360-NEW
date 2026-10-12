/** DOM selections use UTF-16 offsets, matching String.slice (including emoji). */
export function insertEmailPlaceholder(
  text: string,
  token: string,
  start = text.length,
  end = start,
  maxLength = Infinity,
) {
  const from = Math.max(0, Math.min(text.length, start));
  const to = Math.max(from, Math.min(text.length, end));
  const value = text.slice(0, from) + token + text.slice(to);
  if (value.length > maxLength) return null;
  return { value, caret: from + token.length };
}
