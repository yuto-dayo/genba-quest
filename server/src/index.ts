import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
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
import principlesRouter from "./routes/principles";
import communicationsRouter from "./routes/communications";
import appEntryRouter from "./routes/appEntry";
import orgRouter from "./routes/org";
import profileRouter from "./routes/profile";
import systemRouter from "./routes/system";
import luqoRouter from "./routes/luqo";
import pathEvaluationsRouter from "./routes/pathEvaluations";
import pathRewardsRouter from "./routes/pathRewards";
import pathModuleRouter from "./routes/pathModule";
import focusItemsRouter from "./routes/focusItems";
import calendarRouter from "./routes/calendar";
import devPreviewRouter from "./routes/devPreview";
import profileViewConsentRouter from "./routes/profileViewConsent";

const app = express();
const PORT = Number(process.env.PORT) || 4001;
const proposalRpcFallbackMode = (process.env.PROPOSAL_RPC_FALLBACK_MODE || "allow").toLowerCase();
const isAtomicStrictMode = ["disabled", "deny", "off"].includes(proposalRpcFallbackMode);
const frontendDistCandidates = [
    path.resolve(__dirname, "../../frontend/dist"),
    path.resolve(__dirname, "../frontend/dist"),
    path.resolve(process.cwd(), "../frontend/dist"),
    path.resolve(process.cwd(), "frontend/dist"),
];
const frontendDistPath = frontendDistCandidates.find((candidate) =>
    fs.existsSync(path.join(candidate, "index.html"))
);

// CORS設定
const configuredAllowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
    : [];

const defaultAllowedOrigins = ["http://localhost:5173"];

function isLocalDevOrigin(origin: string): boolean {
    return /^http:\/\/localhost:\d+$/.test(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);
}

app.use(cors({
    origin(origin, callback) {
        if (!origin) {
            return callback(null, true);
        }

        if (configuredAllowedOrigins.length > 0) {
            return callback(null, configuredAllowedOrigins.includes(origin));
        }

        if (defaultAllowedOrigins.includes(origin) || process.env.NODE_ENV !== "production" && isLocalDevOrigin(origin)) {
            return callback(null, true);
        }

        return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-org-id"],
}));

app.use(express.json({ limit: "10mb" }));

// リクエストログ
app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// ヘルスチェック（認証不要）
app.get("/health", (_req, res) => {
    res.json({
        ok: true,
        app: "GENBA QUEST",
        proposal_rpc_fallback_mode: proposalRpcFallbackMode,
        proposal_atomic_strict: isAtomicStrictMode,
    });
});

// Webhooks（認証不要）
app.use("/api/v1/webhooks", webhooksRouter);

// 開発用プレビュー（認証不要・NODE_ENV!=productionでのみ動作）
app.use("/api/v1/dev", devPreviewRouter);

if (frontendDistPath) {
    app.use(express.static(frontendDistPath));
    app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
        res.sendFile(path.join(frontendDistPath, "index.html"));
    });
}

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
app.use("/api/v1/principles", principlesRouter);
app.use("/api/v1/app-entry-state", appEntryRouter);
app.use("/api/v1/org", orgRouter);
app.use("/api/v1/profile", profileRouter);
app.use("/api/v1/system", systemRouter);
app.use("/api/v1/communications", communicationsRouter);
app.use("/api/v1/luqo", luqoRouter);
app.use("/api/v1/path/evaluations", pathEvaluationsRouter);
app.use("/api/v1/path/rewards", pathRewardsRouter);
app.use("/api/v1/path/module", pathModuleRouter);
app.use("/api/v1/focus-items", focusItemsRouter);
app.use("/api/v1/calendar", calendarRouter);
app.use("/api/v1", profileViewConsentRouter);

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🏗️ GENBA QUEST server listening on http://0.0.0.0:${PORT}`);
    console.log(
        `[PROPOSAL] RPC fallback mode=${proposalRpcFallbackMode} (strict=${isAtomicStrictMode ? "enabled" : "disabled"})`
    );
});
