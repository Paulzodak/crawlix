import { createServer } from "node:http";
import { createApp } from "./app.js";
import { config } from "./config/index.js";
import { closeSharedBrowser } from "./services/website/browser.service.js";

async function startServer() {
  const app = createApp();
  const httpServer = createServer(app);

  const shutdown = async (signal: string) => {
    console.log(`Shutting down (${signal})...`);
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    await closeSharedBrowser();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  httpServer.listen(config.port, config.host, () => {
    console.log(`Scraper listening on http://${config.host}:${config.port}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
