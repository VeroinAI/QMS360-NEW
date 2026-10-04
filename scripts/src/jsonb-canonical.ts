/** Lossless JSONB comparison: parse strings, but never convert numbers to JS Number. */
export function canonicalJsonb(text: string): string {
  const lexer = /"(?:\\["\\/bfnrt]|\\u[0-9a-fA-F]{4}|[^"\\\u0000-\u001f])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/y;
  let position = 0;
  let next: string | undefined;
  const advance = () => {
    while (/\s/.test(text[position] ?? "") && position < text.length) position++;
    if (position === text.length) { next = undefined; return; }
    lexer.lastIndex = position;
    const match = lexer.exec(text);
    if (!match) throw new Error("Invalid JSON token");
    position = lexer.lastIndex;
    next = match[0];
  };
  const take = (token: string) => {
    if (next !== token) throw new Error(`Expected JSON ${token}`);
    advance();
  };
  const number = (token: string): unknown => {
    const match = token.match(/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/)!;
    const fraction = match[3] ?? "";
    let digits = (match[2]! + fraction).replace(/^0+/, "");
    if (!digits) return ["number", "0", "0"];
    const trailing = digits.match(/0+$/)?.[0].length ?? 0;
    digits = digits.slice(0, digits.length - trailing);
    const exponent = BigInt(match[4] ?? "0") - BigInt(fraction.length) + BigInt(trailing);
    return ["number", match[1] + digits, exponent.toString()];
  };
  const value = (): unknown => {
    const token = next;
    if (!token) throw new Error("Missing JSON value");
    if (token === "{") {
      take("{");
      const entries = new Map<string, unknown>();
      if (next !== "}") {
        while (true) {
          if (!next?.startsWith('"')) throw new Error("Expected JSON object key");
          const key = JSON.parse(next) as string;
          advance(); take(":");
          entries.set(key, value()); // JSONB keeps the last duplicate key.
          if (next !== ",") break;
          take(",");
        }
      }
      take("}");
      return ["object", [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)];
    }
    if (token === "[") {
      take("[");
      const values: unknown[] = [];
      if (next !== "]") {
        while (true) {
          values.push(value());
          if (next !== ",") break;
          take(",");
        }
      }
      take("]");
      return ["array", values];
    }
    advance();
    if (token.startsWith('"')) return ["string", JSON.parse(token)];
    if (/^-?\d/.test(token)) return number(token);
    if (token === "true" || token === "false" || token === "null") return ["literal", token];
    throw new Error("Invalid JSON value");
  };
  advance();
  const result = value();
  if (next !== undefined) throw new Error("Trailing JSON data");
  return JSON.stringify(result);
}