import { isAddress, Wallet } from "ethers";

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

export function asHexPrivateKey(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const hex = trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) return undefined;
  return hex;
}

export function addressFromPrivateKey(value?: string): string | undefined {
  const hex = asHexPrivateKey(value);
  if (!hex) return undefined;
  try {
    return new Wallet(hex).address;
  } catch {
    return undefined;
  }
}

export function hotAddress(injectorPrivateKey: string | undefined): string | undefined {
  return addressFromPrivateKey(injectorPrivateKey);
}

export function resolveFundAddress(input: {
  injectorPrivateKey?: string;
  resolvedFundAddress?: string;
  coinbaseCdp?: { walletSecret?: string; address?: string };
}): string | undefined {
  if (input.resolvedFundAddress && isAddress(input.resolvedFundAddress)) {
    return input.resolvedFundAddress;
  }
  const fromCdpHex = addressFromPrivateKey(input.coinbaseCdp?.walletSecret);
  if (fromCdpHex) return fromCdpHex;
  const configured = input.coinbaseCdp?.address;
  if (configured && isAddress(configured)) return configured;
  return hotAddress(input.injectorPrivateKey);
}

export function assertFundAddressNotVault(
  fundAddress: string | undefined,
  vaultAddress: string | undefined
): void {
  if (!fundAddress || !vaultAddress) return;
  if (fundAddress.toLowerCase() === vaultAddress.toLowerCase()) {
    throw new Error(
      "Vault address must not be the injector/fund address. Use a dedicated risk/hot key."
    );
  }
}
