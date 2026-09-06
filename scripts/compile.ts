import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileContracts } from "./deploy.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const compiled = compileContracts();
mkdirSync(join(root, "artifacts"), { recursive: true });
writeFileSync(join(root, "artifacts/StoreToken.json"), JSON.stringify(compiled.store, null, 2));
writeFileSync(
  join(root, "artifacts/ShadowWeaveRouter.json"),
  JSON.stringify(compiled.router, null, 2)
);
console.log("compiled StoreToken + ShadowWeaveRouter → artifacts/");
