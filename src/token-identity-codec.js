/** Bounded ERC-20 metadata decoding. No provider or wallet access. */
export class TokenIdentityError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "TokenIdentityError";
    this.code = code;
  }
}

export function identityFail(code, message) {
  throw new TokenIdentityError(code, message);
}

export const UINT256_MAX = (1n << 256n) - 1n;
export const METADATA_TEXT_BYTES = 128;
export const METADATA_FIELDS = Object.freeze({
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
  totalSupply: "0x18160ddd",
});

export function identityObject(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    identityFail("IDENTITY_SHAPE");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) {
    identityFail("IDENTITY_SHAPE");
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) identityFail("IDENTITY_SHAPE");
  }
  return value;
}

export function identityUnits(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value) ||
      BigInt(value) > UINT256_MAX) identityFail("IDENTITY_AMOUNT");
  return value;
}

export function identityAddress(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value) ||
      /^0x0{40}$/i.test(value)) identityFail("IDENTITY_ADDRESS");
  return value.toLowerCase();
}

export function metadataText(value) {
  if (typeof value !== "string" || !value.length ||
      new TextEncoder().encode(value).length > METADATA_TEXT_BYTES ||
      /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(value) ||
      /[\ud800-\udfff]/u.test(value) || value.trim() !== value) {
    identityFail("IDENTITY_METADATA_TEXT");
  }
  return value;
}

export function metadataDecimals(value) {
  // This display accepts the full uint8 ERC-20 decimals range exactly.
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    identityFail("IDENTITY_DECIMALS");
  }
  return value;
}

export function decodeMetadataWord(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    identityFail("IDENTITY_ABI_WORD");
  }
  return BigInt(value);
}

export function decodeMetadataString(value) {
  // Exact ABI layout: offset=32, bounded length and zero padding. bytes32
  // fallback is intentionally unsupported rather than guessed as a string.
  if (typeof value !== "string" || value.length > 2 + (64 + 128) * 2 ||
      !/^0x(?:[0-9a-fA-F]{2})+$/.test(value) || value.length < 194) {
    identityFail("IDENTITY_ABI_STRING");
  }
  const raw = value.slice(2);
  if (decodeMetadataWord("0x" + raw.slice(0, 64)) !== 32n) {
    identityFail("IDENTITY_ABI_STRING");
  }
  const length = decodeMetadataWord("0x" + raw.slice(64, 128));
  if (length < 1n || length > BigInt(METADATA_TEXT_BYTES)) identityFail("IDENTITY_ABI_STRING");
  const size = Number(length);
  const padded = Math.ceil(size / 32) * 32;
  if (raw.length !== 128 + padded * 2 || /[^0]/.test(raw.slice(128 + size * 2))) {
    identityFail("IDENTITY_ABI_STRING");
  }
  const bytes = Uint8Array.from(raw.slice(128, 128 + size * 2).match(/../g), hex => parseInt(hex, 16));
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { identityFail("IDENTITY_ABI_STRING"); }
  return metadataText(text);
}

export function decodeMetadataField(field, value) {
  if (!Object.hasOwn(METADATA_FIELDS, field)) identityFail("IDENTITY_FIELD");
  if (field === "name" || field === "symbol") return decodeMetadataString(value);
  const word = decodeMetadataWord(value);
  if (field === "decimals") {
    if (word > 255n) identityFail("IDENTITY_DECIMALS");
    return Number(word);
  }
  return word.toString();
}

export function validateTokenMetadata(value) {
  identityObject(value, ["name", "symbol", "decimals", "totalSupply"]);
  return Object.freeze({
    name: metadataText(value.name),
    symbol: metadataText(value.symbol),
    decimals: metadataDecimals(value.decimals),
    totalSupply: identityUnits(value.totalSupply),
  });
}

/** Decimal placement only: never Number(raw), rounding, grouping or fiat value. */
export function formatTokenUnits(raw, decimals) {
  const value = identityUnits(raw);
  const places = metadataDecimals(decimals);
  if (!places) return value;
  const digits = value.padStart(places + 1, "0");
  const fraction = digits.slice(-places).replace(/0+$/, "");
  return digits.slice(0, -places) + (fraction ? "." + fraction : "");
}

/** User entry parser, with no exponent notation and no loss of small units. */
export function parseTokenUnits(text, decimals) {
  const places = metadataDecimals(decimals);
  if (typeof text !== "string" || text.length > 335 ||
      !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(text)) identityFail("IDENTITY_DECIMAL_TEXT");
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > places) identityFail("IDENTITY_PRECISION");
  const digits = (whole + fraction.padEnd(places, "0")).replace(/^0+(?=\d)/, "");
  return identityUnits(digits);
}
