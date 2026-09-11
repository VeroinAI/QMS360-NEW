const credentialAssignment = /\b(?:password|passwd|passcode|passphrase|pin|secret(?:[\s_-]*key)?|token|api[\s_-]*key)\b\s*(?:[:=])\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;)\]}]+)/gi;

/**
 * Redacts credential-looking assignment values from feedback for administrative
 * displays and exports. This is intentionally limited to assignment syntax so
 * ordinary references such as "I forgot my password" remain readable.
 */
export function redactFeedbackText(text: string): string {
  return text.replace(credentialAssignment, (match) => {
    const separator = match.match(/[:=]/)?.[0] ?? ":";
    const keyAndSeparator = match.slice(0, match.indexOf(separator) + 1);
    return `${keyAndSeparator} [REDACTED]`;
  });
}