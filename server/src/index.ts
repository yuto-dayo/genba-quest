import "./loadEnv";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import fs from "node:fs";
import path from "node:path";
import { authMiddleware } from "./middleware/authMiddleware";
import {
    globalAuthLimiter,
    heavyUploadLimiter,
    sherpaLimiter,
} from "./middleware/rateLimiters";
import sitesRouter from "./routes/sites";
import perksRouter from "./routes/perks";
import partyRouter from "./routes/party";
import staminaRouter from "./routes/stamina";
import sherpaRouter from "./routes/sherpa";
import accountingRouter from "./routes/accounting";
import payoutRouter from "./routes/payout";
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
import pathModuleRouter, { handleMonthCloseReminder } from "./routes/pathModule";
import focusItemsRouter from "./routes/focusItems";
import calendarRouter from "./routes/calendar";
import devPreviewRouter from "./routes/devPreview";
import profileViewConsentRouter from "./routes/profileViewConsent";
import memberInvoicesRouter from "./routes/memberInvoices";
import documentsRouter from "./routes/documents";
import membersRouter from "./routes/members";
import recurringExpensesRouter from "./routes/recurring-expenses";
import legalRecordsRouter from "./routes/legal-records";
import { handleAnnualLegalRecordsCron } from "./cron/annual-legal-records";
import { assertDevAuthRemoteSafety } from "./config/devAuthUsers";
import { requireCronAuth } from "./middleware/cronAuth";
import depreciationRouter from "./routes/depreciation";
import { handleMonthlyDepreciation } from "./cron/monthly-depreciation";

assertDevAuthRemoteSafety();

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

const supabaseConnectSrc: string[] = [];
const rawSupabaseUrl = process.env.SUPABASE_URL?.trim();
if (rawSupabaseUrl) {
    try {
        supabaseConnectSrc.push(new URL(rawSupabaseUrl).origin);
    } catch {
        // ignore malformed SUPABASE_URL — CSP will fall back to 'self'
    }
}

app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: false,
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            connectSrc: ["'self'", ...supabaseConnectSrc],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            frameSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            objectSrc: ["'none'"],
        },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));

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

// Most routes only need small JSON bodies; a couple of upload endpoints
// accept base64-encoded files and need a larger limit.
const LARGE_BODY_ROUTES: ReadonlySet<string> = new Set([
    "/api/v1/accounting/documents",
    "/api/v1/sites/clients/scan-business-card",
    "/api/v1/documents/office-processing-rules",
]);
const smallJsonParser = express.json({ limit: "1mb" });
const largeJsonParser = express.json({ limit: "10mb" });
app.use((req, res, next) => {
    const parser = LARGE_BODY_ROUTES.has(req.path) ? largeJsonParser : smallJsonParser;
    parser(req, res, next);
});

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

app.post("/api/v1/path/month/_remind-close", requireCronAuth, handleMonthCloseReminder);
app.post("/api/v1/depreciation/_cron/monthly", requireCronAuth, handleMonthlyDepreciation);
app.post("/api/v1/legal-records/_cron/compile-prev-year", requireCronAuth, handleAnnualLegalRecordsCron);

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
app.use("/api/v1", globalAuthLimiter);
app.use("/api/v1/sherpa", sherpaLimiter);
app.use("/api/v1/accounting/ocr", heavyUploadLimiter);
app.use("/api/v1/sites/clients/scan-business-card", heavyUploadLimiter);
app.use("/api/v1/documents/office-processing-rules", heavyUploadLimiter);

// ルーター登録
app.use("/api/v1/sites", sitesRouter);
app.use("/api/v1/perks", perksRouter);
app.use("/api/v1/party", partyRouter);
app.use("/api/v1/stamina", staminaRouter);
app.use("/api/v1/sherpa", sherpaRouter);
app.use("/api/v1/accounting", accountingRouter);
app.use("/api/v1/payout", payoutRouter);
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
app.use("/api/v1/members", membersRouter);
app.use("/api/v1/recurring-expenses", recurringExpensesRouter);
app.use("/api/v1/depreciation", depreciationRouter);
app.use("/api/v1/legal-records", legalRecordsRouter);
app.use("/api/v1", profileViewConsentRouter);
app.use("/api/v1", memberInvoicesRouter);
app.use("/api/v1/documents", documentsRouter);

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🏗️ GENBA QUEST server listening on http://0.0.0.0:${PORT}`);
    console.log(
        `[PROPOSAL] RPC fallback mode=${proposalRpcFallbackMode} (strict=${isAtomicStrictMode ? "enabled" : "disabled"})`
    );
});
