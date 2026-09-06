declare module "@coinbase/cdp-sdk" {
  export class CdpClient {
    constructor(opts?: {
      apiKeyId?: string;
      apiKeySecret?: string;
      walletSecret?: string;
    });
    evm: {
      getOrCreateAccount(opts: { name: string }): Promise<{ address: string }>;
      sendTransaction(opts: {
        address: string;
        network: string;
        transaction: { to: string; value: bigint; data: string };
      }): Promise<{ transactionHash: string }>;
    };
  }
}
