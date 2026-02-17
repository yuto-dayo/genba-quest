import "dotenv/config";
import express from "express";
import cors from "cors";
import { authMiddleware } from "./middleware/authMiddleware";
import sitesRouter from "./routes/sites";
import perksRouter from "./routes/perks";
import partyRouter from "./routes/party";
import staminaRouter from "./routes/stamina";
import sherpaRouter from "./routes/sherpa";
import accountingRouter from "./routes/accounting";
import monstersRouter from "./routes/monsters";
import webhooksRouter from "./routes/webhooks";
import proposalsRouter from "./routes/proposals";
import notificationsRouter from "./routes/notifications";

const app = express();
const PORT = Number(process.env.PORT) || 4001;

// CORS設定
app.use(cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json({ limit: "10mb" }));

// リクエストログ
app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// ヘルスチェック（認証不要）
app.get("/health", (_req, res) => {
    res.json({ ok: true, app: "GENBA QUEST" });
});

// Webhooks（認証不要）
app.use("/api/v1/webhooks", webhooksRouter);

// 認証ミドルウェア
app.use(authMiddleware);

// ルーター登録
app.use("/api/v1/sites", sitesRouter);
app.use("/api/v1/perks", perksRouter);
app.use("/api/v1/party", partyRouter);
app.use("/api/v1/stamina", staminaRouter);
app.use("/api/v1/sherpa", sherpaRouter);
app.use("/api/v1/accounting", accountingRouter);
app.use("/api/v1/monsters", monstersRouter);
app.use("/api/v1/proposals", proposalsRouter);
app.use("/api/v1/notifications", notificationsRouter);

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🏗️ GENBA QUEST server listening on http://0.0.0.0:${PORT}`);
});
