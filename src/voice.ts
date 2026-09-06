import { STORE_VOICE } from "./types.js";

const VOICE_BUF = Buffer.from(STORE_VOICE, "utf8");

/** Prefix payload with the secret Game voice `§$STORE§` when missing. */
export function wrapStoreVoice(payload: Buffer): Buffer {
  if (hasStoreVoice(payload)) return payload;
  return Buffer.concat([VOICE_BUF, payload]);
}

export function hasStoreVoice(payload: Buffer): boolean {
  if (payload.length < VOICE_BUF.length) return false;
  return payload.subarray(0, VOICE_BUF.length).equals(VOICE_BUF);
}

export function encodeVoiceHex(text = STORE_VOICE): string {
  return `0x${Buffer.from(text, "utf8").toString("hex")}`;
}
