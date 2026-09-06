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

/** Portal API-key wallet address from COINBASE_CDP_ADDRESS / CDP_ADDRESS. */
export function configuredCdpAddress(input: {
  coinbaseCdp?: { address?: string };
}): string | undefined {
  const configured = input.coinbaseCdp?.address?.trim();
  if (configured && isAddress(configured)) return configured;
  return undefined;
}

export function resolveFundAddress(input: {
  injectorPrivateKey?: string;
  resolvedFundAddress?: string;
  coinbaseCdp?: { walletSecret?: string; address?: string };
  entryPoint?: string;
}): string | undefined {
  const configured = configuredCdpAddress(input);
  const fromCdpHex = addressFromPrivateKey(input.coinbaseCdp?.walletSecret);
  const cached =
    input.resolvedFundAddress && isAddress(input.resolvedFundAddress)
      ? input.resolvedFundAddress
      : undefined;
  const injector = hotAddress(input.injectorPrivateKey);
  const preferConfiguredCdp =
    !input.entryPoint || input.entryPoint === "coinbase_onchain";

  // coinbase_onchain (and unspecified): funded CDP portal wallet beats INJECTOR.
  if (preferConfiguredCdp && configured) return configured;
  if (cached) return cached;
  if (fromCdpHex) return fromCdpHex;
  if (configured) return configured;
  return injector;
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
