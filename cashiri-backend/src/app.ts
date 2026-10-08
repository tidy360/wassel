import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import authRoutes from "./routes/auth.routes";
import adminRoutes from "./routes/admin.routes";
import storeRoutes from "./routes/store.routes";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN?.split(",") ?? true,
      credentials: true,
    })
  );
  app.use(express.json({ limit: "2mb" }));

  // Basic rate limiting (spec section 21). Tune per-route later (e.g. a
  // stricter limiter on /auth/login to blunt credential stuffing).
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/auth", authRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/store", storeRoutes);

  // 404 + error handlers
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.publicMessage || "Internal server error" });
  });

  return app;
}
