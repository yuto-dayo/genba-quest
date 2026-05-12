import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { supabaseAdmin } from "../lib/supabaseClient";

const router = Router();

type EmploymentKind = "employee" | "sole_proprietor" | "helper";
type AccountType = "ordinary" | "checking";

const PROFILE_COLUMNS = [
    "id",
    "username",
    "nickname",
    "full_name",
    "avatar_url",
    "onboarding_completed_at",
    "phone",
    "job_type",
    "employment_kind",
    "trade_name",
    "invoice_registration_number",
    "bank_name",
    "branch_name",
    "account_type",
    "account_number",
    "account_holder_kana",
    "postal_code",
    "prefecture",
    "city",
    "address_line1",
    "address_line2",
    "emergency_contact_name",
    "emergency_phone",
].join(",");

interface ProfileRecord {
    id: string;
    username: string | null;
    nickname: string | null;
    full_name: string | null;
    avatar_url: string | null;
    onboarding_completed_at: string | null;
    phone: string | null;
    job_type: string | null;
    employment_kind: EmploymentKind;
    trade_name: string | null;
    invoice_registration_number: string | null;
    bank_name: string | null;
    branch_name: string | null;
    account_type: AccountType | null;
    account_number: string | null;
    account_holder_kana: string | null;
    postal_code: string | null;
    prefecture: string | null;
    city: string | null;
    address_line1: string | null;
    address_line2: string | null;
    emergency_contact_name: string | null;
    emergency_phone: string | null;
}

const EMPLOYMENT_KINDS: readonly EmploymentKind[] = ["employee", "sole_proprietor", "helper"];
const ACCOUNT_TYPES: readonly AccountType[] = ["ordinary", "checking"];
const INVOICE_NUMBER_PATTERN = /^T[0-9]{13}$/;
const POSTAL_CODE_PATTERN = /^[0-9]{3}-?[0-9]{4}$/;
const NICKNAME_MAX_LENGTH = 5;

function normalizeText(value: unknown, maxLength: number): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    return trimmed.slice(0, maxLength);
}

function normalizeDigits(value: unknown, maxLength: number): string | null {
    const text = normalizeText(value, maxLength);
    if (text === null) {
        return null;
    }
    return text.replace(/[^0-9]/g, "") || null;
}

interface ValidationError {
    code: string;
}

function buildUpdates(body: Record<string, unknown>): Record<string, string | null> | ValidationError {
    const updates: Record<string, string | null> = {};

    if ("onboarding_completed_at" in body) {
        return { code: "PROFILE_ONBOARDING_COMPLETED_AT_FORBIDDEN" };
    }

    if ("nickname" in body) {
        if (typeof body.nickname !== "string") {
            return { code: "PROFILE_NICKNAME_REQUIRED" };
        }
        const nickname = body.nickname.trim();
        if (!nickname) {
            return { code: "PROFILE_NICKNAME_REQUIRED" };
        }
        if (nickname.length > NICKNAME_MAX_LENGTH) {
            return { code: "PROFILE_NICKNAME_TOO_LONG" };
        }
        updates.nickname = nickname;
    }

    if ("full_name" in body) {
        updates.full_name = normalizeText(body.full_name, 80);
    }

    if ("username" in body) {
        const username = normalizeText(body.username, 40);
        if (username !== null && username.length < 3) {
            return { code: "PROFILE_USERNAME_TOO_SHORT" };
        }
        updates.username = username;
    }

    if ("phone" in body) {
        updates.phone = normalizeText(body.phone, 32);
    }

    if ("job_type" in body) {
        updates.job_type = normalizeText(body.job_type, 40);
    }

    if ("employment_kind" in body) {
        const kind = typeof body.employment_kind === "string" ? body.employment_kind : "";
        if (!EMPLOYMENT_KINDS.includes(kind as EmploymentKind)) {
            return { code: "PROFILE_EMPLOYMENT_KIND_INVALID" };
        }
        updates.employment_kind = kind;
    }

    if ("trade_name" in body) {
        updates.trade_name = normalizeText(body.trade_name, 80);
    }

    if ("invoice_registration_number" in body) {
        const value = normalizeText(body.invoice_registration_number, 14);
        if (value !== null && !INVOICE_NUMBER_PATTERN.test(value)) {
            return { code: "PROFILE_INVOICE_NUMBER_INVALID" };
        }
        updates.invoice_registration_number = value;
    }

    if ("bank_name" in body) {
        updates.bank_name = normalizeText(body.bank_name, 40);
    }
    if ("branch_name" in body) {
        updates.branch_name = normalizeText(body.branch_name, 40);
    }
    if ("account_type" in body) {
        if (body.account_type === null || body.account_type === "") {
            updates.account_type = null;
        } else if (typeof body.account_type === "string" && ACCOUNT_TYPES.includes(body.account_type as AccountType)) {
            updates.account_type = body.account_type;
        } else {
            return { code: "PROFILE_ACCOUNT_TYPE_INVALID" };
        }
    }
    if ("account_number" in body) {
        updates.account_number = normalizeDigits(body.account_number, 16);
    }
    if ("account_holder_kana" in body) {
        updates.account_holder_kana = normalizeText(body.account_holder_kana, 80);
    }

    if ("postal_code" in body) {
        const value = normalizeText(body.postal_code, 8);
        if (value !== null && !POSTAL_CODE_PATTERN.test(value)) {
            return { code: "PROFILE_POSTAL_CODE_INVALID" };
        }
        updates.postal_code = value;
    }
    if ("prefecture" in body) {
        updates.prefecture = normalizeText(body.prefecture, 16);
    }
    if ("city" in body) {
        updates.city = normalizeText(body.city, 64);
    }
    if ("address_line1" in body) {
        updates.address_line1 = normalizeText(body.address_line1, 128);
    }
    if ("address_line2" in body) {
        updates.address_line2 = normalizeText(body.address_line2, 128);
    }

    if ("emergency_contact_name" in body) {
        updates.emergency_contact_name = normalizeText(body.emergency_contact_name, 80);
    }
    if ("emergency_phone" in body) {
        updates.emergency_phone = normalizeText(body.emergency_phone, 32);
    }

    if ("complete_onboarding" in body) {
        if (typeof body.complete_onboarding !== "boolean") {
            return { code: "PROFILE_COMPLETE_ONBOARDING_INVALID" };
        }
        if (body.complete_onboarding) {
            updates.onboarding_completed_at = new Date().toISOString();
        }
    }

    return updates;
}

router.get("/me", async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.userId) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        const { data, error } = await supabaseAdmin
            .from("profiles")
            .select(PROFILE_COLUMNS)
            .eq("id", req.userId)
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!data) {
            const { data: inserted, error: upsertError } = await supabaseAdmin
                .from("profiles")
                .upsert({ id: req.userId }, { onConflict: "id" })
                .select(PROFILE_COLUMNS)
                .single();

            if (upsertError) {
                throw upsertError;
            }

            res.json({ profile: inserted as unknown as ProfileRecord });
            return;
        }

        res.json({ profile: data as unknown as ProfileRecord });
    } catch (err) {
        console.error("[PROFILE] read failed:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.patch("/me", async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.userId) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
        const updatesOrError = buildUpdates(body);
        if ("code" in updatesOrError) {
            res.status(400).json({ error: updatesOrError.code });
            return;
        }

        const updates = updatesOrError;
        if (Object.keys(updates).length === 0) {
            res.status(400).json({ error: "PROFILE_NO_FIELDS" });
            return;
        }

        const { data, error } = await supabaseAdmin
            .from("profiles")
            .update(updates)
            .eq("id", req.userId)
            .select(PROFILE_COLUMNS)
            .single();

        if (error) {
            if (error.code === "23505") {
                res.status(409).json({ error: "PROFILE_USERNAME_TAKEN" });
                return;
            }
            throw error;
        }

        res.json({ profile: data as unknown as ProfileRecord });
    } catch (err) {
        console.error("[PROFILE] update failed:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;
