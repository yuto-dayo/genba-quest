-- Extend public.profiles with contact, employment, payment, tax, and address fields.
-- Purpose: enable 黒字可視化 by capturing 振込先 + インボイス番号 + 雇用区分 for
-- members who are paid (一人親方 / 応援 / 社員). マイナンバー is intentionally excluded
-- (special handling required under 特定個人情報の安全管理措置).

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS phone text,
    ADD COLUMN IF NOT EXISTS job_type text,
    ADD COLUMN IF NOT EXISTS employment_kind text NOT NULL DEFAULT 'employee',
    ADD COLUMN IF NOT EXISTS trade_name text,
    ADD COLUMN IF NOT EXISTS invoice_registration_number text,
    ADD COLUMN IF NOT EXISTS bank_name text,
    ADD COLUMN IF NOT EXISTS branch_name text,
    ADD COLUMN IF NOT EXISTS account_type text,
    ADD COLUMN IF NOT EXISTS account_number text,
    ADD COLUMN IF NOT EXISTS account_holder_kana text,
    ADD COLUMN IF NOT EXISTS postal_code text,
    ADD COLUMN IF NOT EXISTS prefecture text,
    ADD COLUMN IF NOT EXISTS city text,
    ADD COLUMN IF NOT EXISTS address_line1 text,
    ADD COLUMN IF NOT EXISTS address_line2 text,
    ADD COLUMN IF NOT EXISTS emergency_contact_name text,
    ADD COLUMN IF NOT EXISTS emergency_phone text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'profiles_employment_kind_check'
    ) THEN
        ALTER TABLE public.profiles
            ADD CONSTRAINT profiles_employment_kind_check
            CHECK (employment_kind IN ('employee', 'sole_proprietor', 'helper'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'profiles_account_type_check'
    ) THEN
        ALTER TABLE public.profiles
            ADD CONSTRAINT profiles_account_type_check
            CHECK (account_type IS NULL OR account_type IN ('ordinary', 'checking'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'profiles_invoice_number_format_check'
    ) THEN
        ALTER TABLE public.profiles
            ADD CONSTRAINT profiles_invoice_number_format_check
            CHECK (invoice_registration_number IS NULL OR invoice_registration_number ~ '^T[0-9]{13}$');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'profiles_postal_code_format_check'
    ) THEN
        ALTER TABLE public.profiles
            ADD CONSTRAINT profiles_postal_code_format_check
            CHECK (postal_code IS NULL OR postal_code ~ '^[0-9]{3}-?[0-9]{4}$');
    END IF;
END$$;

COMMENT ON COLUMN public.profiles.employment_kind IS 'employee | sole_proprietor | helper. Drives tax treatment and required fields in UI.';
COMMENT ON COLUMN public.profiles.invoice_registration_number IS '適格請求書発行事業者番号 (T + 13 digits). Required for 消費税仕入税額控除 when paying 一人親方.';
COMMENT ON COLUMN public.profiles.trade_name IS '屋号 — sole proprietors may use this as their billing name.';
COMMENT ON COLUMN public.profiles.account_type IS 'ordinary (普通) | checking (当座).';

-- TODO Phase 2 hardening — defense in depth:
-- The existing RLS policy lets any authenticated user SELECT * from profiles,
-- so the new financial / tax / address columns are technically visible if a
-- caller queries via the anon key + their user JWT. We do NOT exploit this in
-- the frontend (which goes through /api/v1/profile/me using service_role on
-- the server), but a proper fix is to swap the table-level SELECT grant for a
-- column-level whitelist. That requires auditing every RLS policy / view /
-- SECURITY INVOKER function that reads profiles to ensure it only touches the
-- granted columns. Deferred to Phase 2 because the audit surface is large
-- (admin-check policies on many tables reference profiles.role / id) and a
-- mistake here would break unrelated features.
--
-- Current practical risk for dogfood / small-org usage: low. Re-evaluate when
-- the org count grows or before any external integration is exposed.

