import express, { Express } from "express";
import cors from "cors";
import routes from "./routes/index.route.js";
import { mountSwagger } from "./docs/swagger.js";
import { errorHandler } from "./middleware/errorHandler.js";

export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.use("/", routes);
  mountSwagger(app);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use(errorHandler);
  return app;
}
