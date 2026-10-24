/** Preflight untrusted JSON before native parsing or schema/checksum validation. */
export class SecurityJsonError extends Error {
  constructor(code) {
    super(code);
    this.name = "SecurityJsonError";
    this.code = code;
  }
}

export const JSON_SECURITY_LIMITS = Object.freeze({
  bytes: 96 * 1024 * 1024,
  depth: 64,
  nodes: 1_000_000,
  keyCharacters: 256,
  stringCharacters: 32 * 1024 * 1024,
  numberCharacters: 128,
});
const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
const fail = code => { throw new SecurityJsonError(code); };

/** UTF-8 size without allocating a second copy of a potentially large input. */
export function boundedUtf8Length(text, limit) {
  if (typeof text !== "string" || !Number.isSafeInteger(limit) || limit < 1) {
    fail("JSON_SIZE");
  }
  if (text.length > limit) fail("JSON_SIZE");
  let size = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) size++;
    else if (code < 0x800) size += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length &&
        text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
      size += 4;
      i++;
    } else size += 3;
    if (size > limit) fail("JSON_SIZE");
  }
  return size;
}

function limits(options) {
  const result = { ...JSON_SECURITY_LIMITS };
  if (!options || typeof options !== "object" || Array.isArray(options)) fail("JSON_OPTIONS");
  for (const key of Reflect.ownKeys(options)) {
    if (!Object.hasOwn(result, key)) fail("JSON_OPTIONS");
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (!descriptor || !("value" in descriptor)) fail("JSON_OPTIONS");
    const value = descriptor.value;
    if (!Number.isSafeInteger(value) || value < 1 || value > result[key]) fail("JSON_OPTIONS");
    result[key] = value;
  }
  return result;
}

/**
 * Object member names are compared after JSON escape decoding. Both literal
 * duplicate names and names such as "a" / "\u0061" are rejected. A checksum
 * calculated after JSON.parse alone would otherwise miss the discarded value.
 * Error messages intentionally contain neither values nor property names.
 */
export function inspectSecurityJson(text, options = {}) {
  const bound = limits(options);
  const bytes = boundedUtf8Length(text, bound.bytes);
  if (!bytes) fail("JSON_SYNTAX");
  let cursor = 0;
  let nodes = 0;
  let maximumDepth = 0;
  let members = 0;
  const whitespace = () => {
    while (cursor < text.length && /[\x20\t\r\n]/.test(text[cursor])) cursor++;
  };
  function string(key = false) {
    const start = cursor++;
    let characters = 0;
    const maximum = key ? bound.keyCharacters : bound.stringCharacters;
    while (cursor < text.length) {
      const code = text.charCodeAt(cursor++);
      if (code === 34) {
        if (!key) return;
        let result;
        try { result = JSON.parse(text.slice(start, cursor)); }
        catch { fail("JSON_SYNTAX"); }
        if (forbiddenKeys.has(result)) fail("JSON_UNSAFE_KEY");
        return result;
      }
      if (code < 32) fail("JSON_SYNTAX");
      if (++characters > maximum) fail("JSON_STRING_LIMIT");
      if (code === 92) {
        const escape = text[cursor++];
        if (escape === "u") {
          const hex = text.slice(cursor, cursor + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("JSON_SYNTAX");
          cursor += 4;
        } else if (!['"', "\\", "/", "b", "f", "n", "r", "t"].includes(escape)) {
          fail("JSON_SYNTAX");
        }
      }
    }
    fail("JSON_SYNTAX");
  }
  function number() {
    const start = cursor;
    while (cursor < text.length && /[0-9eE+.\-]/.test(text[cursor])) {
      cursor++;
      if (cursor - start > bound.numberCharacters) fail("JSON_NUMBER_LIMIT");
    }
    const raw = text.slice(start, cursor);
    if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(raw)) fail("JSON_SYNTAX");
    if (!Number.isFinite(Number(raw))) fail("JSON_NUMBER_LIMIT");
  }
  function value(depth) {
    if (++nodes > bound.nodes) fail("JSON_NODE_LIMIT");
    if (depth > bound.depth) fail("JSON_DEPTH_LIMIT");
    maximumDepth = Math.max(maximumDepth, depth);
    whitespace();
    const char = text[cursor];
    if (char === '"') return string();
    if (char === "{" || char === "[") {
      const object = char === "{";
      const closing = object ? "}" : "]";
      const keys = object ? new Set() : null;
      cursor++;
      whitespace();
      if (text[cursor] === closing) { cursor++; return; }
      while (true) {
        whitespace();
        if (object) {
          if (text[cursor] !== '"') fail("JSON_SYNTAX");
          const key = string(true);
          if (keys.has(key)) fail("JSON_DUPLICATE_KEY");
          keys.add(key);
          members++;
          whitespace();
          if (text[cursor++] !== ":") fail("JSON_SYNTAX");
        }
        value(depth + 1);
        whitespace();
        const next = text[cursor++];
        if (next === closing) return;
        if (next !== ",") fail("JSON_SYNTAX");
      }
    }
    for (const literal of ["true", "false", "null"]) {
      if (text.startsWith(literal, cursor)) { cursor += literal.length; return; }
    }
    if (char === "-" || (char >= "0" && char <= "9")) return number();
    fail("JSON_SYNTAX");
  }
  value(0);
  whitespace();
  if (cursor !== text.length) fail("JSON_SYNTAX");
  return Object.freeze({ bytes, nodes, members, maximumDepth });
}

/** Existing format validators still enforce their own fields and limits. */
export function parseSecurityJson(text, options) {
  inspectSecurityJson(text, options);
  try { return JSON.parse(text); }
  catch { fail("JSON_SYNTAX"); }
}
