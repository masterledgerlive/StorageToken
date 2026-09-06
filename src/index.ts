import dotenv from "dotenv";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

dotenv.config();

async function startServer(): Promise<void> {
  const config = loadConfig();
  const { app } = await createApp({ config });
  app.listen(config.port, config.host, () => {
    console.log(
      `[StorageToken] ${config.mode} on http://${config.host}:${config.port}`
    );
    console.log(`[StorageToken] Health: /health  Inject: POST /api/inject`);
    console.log(`[StorageToken] Default chain: base-sepolia (84532)`);
    console.log(`[StorageToken] Entry: ${config.entryPoint}  Voice: §$STORE§`);
    console.log(`[StorageToken] Payment: $STORE credits only. JWT = READ access.`);
  });
}

startServer().catch((error) => {
  console.error("[StorageToken] Failed to start:", error);
  process.exit(1);
});
