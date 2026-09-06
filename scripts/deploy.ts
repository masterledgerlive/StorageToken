/**
 * Deploy StoreToken + ShadowWeaveRouter to Base Sepolia (84532).
 *
 *   pnpm compile
 *   MODE=base_sepolia INJECTOR_PRIVATE_KEY=0x... BASE_SEPOLIA_RPC=https://sepolia.base.org pnpm deploy
 *
 * Origin contracts were not available (gamemasters/agent-genesis 404).
 * These Solidity sources reconstruct the spec: router-only mint, bytes emission,
 * dedicated store OR hitch on a REAL leftover.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";
import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function compileContracts(): {
  store: { abi: unknown[]; bytecode: string };
  router: { abi: unknown[]; bytecode: string };
} {
  const sources = {
    "StoreToken.sol": {
      content: readFileSync(join(root, "contracts/StoreToken.sol"), "utf8"),
    },
    "ShadowWeaveRouter.sol": {
      content: readFileSync(join(root, "contracts/ShadowWeaveRouter.sol"), "utf8"),
    },
  };

  const input = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  if (output.errors?.some((e: { severity: string }) => e.severity === "error")) {
    throw new Error(output.errors.map((e: { formattedMessage: string }) => e.formattedMessage).join("\n"));
  }

  const store = output.contracts["StoreToken.sol"].StoreToken;
  const router = output.contracts["ShadowWeaveRouter.sol"].ShadowWeaveRouter;
  return {
    store: { abi: store.abi, bytecode: "0x" + store.evm.bytecode.object },
    router: { abi: router.abi, bytecode: "0x" + router.evm.bytecode.object },
  };
}

async function main() {
  const rpc = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";
  const key = process.env.INJECTOR_PRIVATE_KEY;
  if (!key) throw new Error("INJECTOR_PRIVATE_KEY required to deploy");

  const provider = new ethers.JsonRpcProvider(rpc);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== 84532) {
    throw new Error(`Refusing deploy on chainId ${network.chainId}. Use Base Sepolia 84532.`);
  }

  const wallet = new ethers.Wallet(key, provider);
  const compiled = compileContracts();
  mkdirSync(join(root, "artifacts"), { recursive: true });
  writeFileSync(join(root, "artifacts/StoreToken.json"), JSON.stringify(compiled.store, null, 2));
  writeFileSync(
    join(root, "artifacts/ShadowWeaveRouter.json"),
    JSON.stringify(compiled.router, null, 2)
  );

  const sink = process.env.EMISSION_SINK || wallet.address;
  const storeFactory = new ethers.ContractFactory(
    compiled.store.abi,
    compiled.store.bytecode,
    wallet
  );
  const store = await storeFactory.deploy(wallet.address, sink, true);
  await store.waitForDeployment();
  const storeAddr = await store.getAddress();

  const routerFactory = new ethers.ContractFactory(
    compiled.router.abi,
    compiled.router.bytecode,
    wallet
  );
  const router = await routerFactory.deploy(storeAddr, wallet.address);
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();

  await (store as ethers.Contract).setRouter(routerAddr);

  const seedTo = process.env.SEED_CREDITS_TO || wallet.address;
  const seedAmt = process.env.SEED_CREDITS_AMOUNT || "1000000000000000000000";
  await (store as ethers.Contract).seedCredits(seedTo, seedAmt);

  const deployed = {
    chainId: 84532,
    storeToken: storeAddr,
    router: routerAddr,
    operator: wallet.address,
    emissionSink: sink,
    seededTo: seedTo,
    seededAmount: seedAmt,
  };
  writeFileSync(join(root, "artifacts/deployed.json"), JSON.stringify(deployed, null, 2));
  console.log(JSON.stringify(deployed, null, 2));
  console.log("Set STORE_TOKEN_ADDRESS and ROUTER_ADDRESS on Railway.");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
