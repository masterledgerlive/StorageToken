/**
 * Hitch-on-real-tx helpers from guardian bitstorage-orchestrator /
 * bitstorage-strand-assembler — storage only, not the trading loop.
 *
 * Append LIBM bytes onto leftover swap calldata. The DEX router reads its
 * own prefix; appended bytes ride the mined leftover. Never invent a swap.
 */

export const LIBM_MAGIC = Buffer.from("4c49424d", "hex"); // "LIBM"
export const HEADER_SIZE = 4 + 8 + 4 + 32; // magic + strandId + index + nextHash
export const CALLDATA_GAS_PER_BYTE = 16;
export const MAX_PAYLOAD_BYTES = 24 * 1024;
export const DEFAULT_PAYLOAD_BYTES = 10 * 1024;

export function appendToCalldata(swapCalldata: string, fragment: Buffer): string {
  if (typeof swapCalldata !== "string" || !swapCalldata.startsWith("0x")) {
    throw new Error("appendToCalldata requires leftover swap calldata 0x… from a real tx");
  }
  const hex = swapCalldata.slice(2);
  if (hex.length % 2 !== 0 || (hex.length > 0 && !/^[0-9a-fA-F]+$/.test(hex))) {
    throw new Error("leftover swap calldata is not even-length hex");
  }
  const swapBuf = Buffer.from(hex, "hex");
  return `0x${Buffer.concat([swapBuf, fragment]).toString("hex")}`;
}

export function buildLibmHeader(
  strandId: Buffer,
  index: number,
  nextHash?: Buffer
): Buffer {
  if (strandId.length !== 8) {
    throw new Error("LIBM strandId must be 8 bytes");
  }
  if (!Number.isInteger(index) || index < 0) {
    throw new Error("LIBM fragment index must be a non-negative integer");
  }
  const header = Buffer.alloc(HEADER_SIZE, 0);
  LIBM_MAGIC.copy(header, 0);
  strandId.copy(header, 4);
  header.writeUInt32BE(index >>> 0, 12);
  if (nextHash) {
    if (nextHash.length !== 32) {
      throw new Error("LIBM nextHash must be 32 bytes");
    }
    nextHash.copy(header, 16);
  }
  return header;
}

export function hitchCalldataGas(payloadBytes: number): number {
  if (!Number.isInteger(payloadBytes) || payloadBytes < 0) {
    throw new Error("payloadBytes must be a non-negative integer");
  }
  return payloadBytes * CALLDATA_GAS_PER_BYTE;
}
