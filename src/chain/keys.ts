import { Wallet } from "ethers";

/**
 * Vault never spends save. Only the hot/risk injector key signs inject txs.
 */
export function assertNotVaultKey(
  injectorPrivateKey: string | undefined,
  vaultAddress: string | undefined
): void {
  if (!injectorPrivateKey || !vaultAddress) return;
  const hot = new Wallet(injectorPrivateKey).address.toLowerCase();
  if (hot === vaultAddress.toLowerCase()) {
    throw new Error(
      "Vault address must not be the injector key. Use a dedicated risk/hot key for inject."
    );
  }
}

export function hotAddress(injectorPrivateKey: string | undefined): string | undefined {
  if (!injectorPrivateKey) return undefined;
  try {
    return new Wallet(injectorPrivateKey).address;
  } catch {
    return undefined;
  }
}
