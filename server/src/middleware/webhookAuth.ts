import { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "crypto";

const BEARER_PREFIX = "Bearer ";

function readBearerToken(req: Request): string | null {
    const header = req.headers["authorization"];
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw || typeof raw !== "string" || !raw.startsWith(BEARER_PREFIX)) {
        return null;
    }
    const token = raw.slice(BEARER_PREFIX.length).trim();
    return token.length > 0 ? token : null;
}

function constantTimeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) {
        return false;
    }
    return timingSafeEqual(bufA, bufB);
}

export function requireGmailWebhookAuth(req: Request, res: Response, next: NextFunction): void {
    const expected = process.env.GMAIL_WEBHOOK_SECRET;
    if (!expected) {
        console.error("[WEBHOOK] GMAIL_WEBHOOK_SECRET is not configured");
        res.status(500).json({ error: "WEBHOOK_SECRET_NOT_CONFIGURED" });
        return;
    }

    const token = readBearerToken(req);
    if (!token || !constantTimeEquals(token, expected)) {
        res.status(401).json({ error: "WEBHOOK_AUTH_REQUIRED" });
        return;
    }

    next();
}
