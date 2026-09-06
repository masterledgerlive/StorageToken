import { costForBytes } from "./pricing.js";

/**
 * Honor $STORE credits. No silent skim of strangers' txs.
 * Mirrors StoreToken.sol when on-chain addresses are unset (paper / pre-deploy).
 */
export class CreditLedger {
  private balances = new Map<string, bigint>();

  seed(address: string, amount: bigint): void {
    const key = norm(address);
    this.balances.set(key, (this.balances.get(key) ?? 0n) + amount);
  }

  balanceOf(address: string): bigint {
    return this.balances.get(norm(address)) ?? 0n;
  }

  payForStorage(payer: string, byteCount: number): bigint {
    const cost = costForBytes(byteCount);
    const key = norm(payer);
    const bal = this.balances.get(key) ?? 0n;
    if (bal < cost) {
      throw new Error(
        `Insufficient $STORE credits: have ${bal.toString()} need ${cost.toString()}`
      );
    }
    this.balances.set(key, bal - cost);
    return cost;
  }

  snapshot(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of this.balances) out[k] = v.toString();
    return out;
  }
}

function norm(address: string): string {
  return address.toLowerCase();
}
