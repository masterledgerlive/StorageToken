/**
 * Parse POST /api/inject payload bytes.
 * Ported from masterledgerlive/injection-service PR #1
 * (cursor/base-sepolia-inject-v0-641e). Accepts even-length hex or base64.
 */

export function parseInjectionPayload(body: {
  bytes?: unknown;
  base64?: unknown;
  text?: unknown;
}): Buffer {
  if (typeof body.text === "string" && body.text.length > 0) {
    return Buffer.from(body.text, "utf8");
  }

  if (body.bytes !== undefined && body.bytes !== null && body.bytes !== "") {
    return parseBytes(body.bytes);
  }

  if (typeof body.base64 === "string" && body.base64.length > 0) {
    const buf = Buffer.from(body.base64, "base64");
    if (buf.length === 0) {
      throw new Error("Invalid base64 payload");
    }
    return buf;
  }

  throw new Error("Missing payload: provide bytes, base64, or text");
}

function parseBytes(bytes: unknown): Buffer {
  if (typeof bytes === "string") {
    const raw = bytes.trim();
    const hex = raw.startsWith("0x") || raw.startsWith("0X") ? raw.slice(2) : raw;
    if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
      throw new Error("Invalid bytes: expected even-length hex string");
    }
    return Buffer.from(hex, "hex");
  }

  if (Array.isArray(bytes)) {
    if (!bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
      throw new Error("Invalid bytes: expected array of integers 0-255");
    }
    if (bytes.length === 0) {
      throw new Error("Invalid bytes: payload must be non-empty");
    }
    return Buffer.from(bytes);
  }

  throw new Error("Invalid bytes");
}

export function parseCreditAmount(value: unknown, fallback = "0"): string {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const asString = String(value);
  if (!/^[0-9]+$/.test(asString)) {
    throw new Error("credit amount must be a non-negative integer");
  }
  return asString;
}

export function assertNotMockedHash(hash: unknown): string {
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw new Error("Refusing mocked or malformed hash");
  }
  const normalized = hash.toLowerCase();
  if (
    normalized ===
      "0x0000000000000000000000000000000000000000000000000000000000000000" ||
    /^0x([0-9a-f])\1{63}$/.test(normalized)
  ) {
    throw new Error("Refusing mocked hash");
  }
  return hash;
}

export function isLiveTxHash(hash: unknown): hash is string {
  try {
    assertNotMockedHash(hash);
    return true;
  } catch {
    return false;
  }
}
