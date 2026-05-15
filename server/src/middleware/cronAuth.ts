import { timingSafeEqual } from "crypto";
import { NextFunction, Request, Response } from "express";

function readBearerToken(value: string | string[] | undefined): string | null {
  const header = Array.isArray(value) ? value[0] : value;
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function safeTokenEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function requireCronAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    res.status(500).json({ error: "CRON_SECRET is not configured" });
    return;
  }

  const token = readBearerToken(req.headers.authorization);
  if (!token || !safeTokenEquals(token, secret)) {
    res.status(401).json({ error: "Invalid cron token" });
    return;
  }

  next();
}
