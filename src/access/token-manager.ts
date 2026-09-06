import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import type { AccessToken } from "../types.js";

/**
 * JWT is strand READ access, not money.
 * $STORE ERC-20 credits are the only storage payment.
 * Ported/adapted from injection-service TokenManager (PR #1).
 */
export class TokenManager {
  constructor(
    private jwtSecret: string,
    private tokenExpiryHours = 24
  ) {}

  generateAccessToken(
    strandId: string,
    options?: { expiryHours?: number; metadata?: Record<string, unknown> }
  ): AccessToken {
    const expiryHours = options?.expiryHours || this.tokenExpiryHours;
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
    const payload = {
      strandId,
      purpose: "strand-read" as const,
      notMoney: true,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(expiresAt.getTime() / 1000),
      metadata: options?.metadata || {},
    };
    return {
      token: jwt.sign(payload, this.jwtSecret),
      strandId,
      expiresAt,
      purpose: "strand-read",
    };
  }

  verifyAccessToken(token: string): {
    valid: boolean;
    payload?: jwt.JwtPayload;
    error?: string;
  } {
    try {
      const payload = jwt.verify(token, this.jwtSecret) as jwt.JwtPayload;
      if (payload.purpose !== "strand-read") {
        return { valid: false, error: "JWT is not a money instrument" };
      }
      return { valid: true, payload };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Token verification failed",
      };
    }
  }

  decodeToken(token: string): { payload?: jwt.JwtPayload | string | null } {
    return { payload: jwt.decode(token) };
  }

  hashKey(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }
}

export default TokenManager;
