declare module "@coinbase/cdp-sdk" {
  export class CdpClient {
    constructor(opts?: {
      apiKeyId?: string;
      apiKeySecret?: string;
      walletSecret?: string;
    });
    evm: {
      getAccount(opts: { address?: string; name?: string }): Promise<{ address: string }>;
      getOrCreateAccount(opts: { name: string }): Promise<{ address: string }>;
      sendTransaction(opts: {
        address: string;
        network: string;
        transaction: { to: string; value: bigint; data: string };
      }): Promise<{ transactionHash: string }>;
    };
  }
}
