-- Profile onboarding additions:
-- - nickname (UI display name, 1..5 chars)
-- - onboarding_completed_at (NULL = onboarding required)

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS nickname text,
    ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'profiles_nickname_length_check'
    ) THEN
        ALTER TABLE public.profiles
            ADD CONSTRAINT profiles_nickname_length_check
            CHECK (nickname IS NULL OR char_length(nickname) BETWEEN 1 AND 5);
    END IF;
END$$;

-- Existing users are treated as onboarding-complete.
UPDATE public.profiles
SET
    nickname = COALESCE(nickname, LEFT(COALESCE(full_name, username, 'メンバー'), 5)),
    onboarding_completed_at = COALESCE(onboarding_completed_at, updated_at, now())
WHERE onboarding_completed_at IS NULL;

COMMENT ON COLUMN public.profiles.nickname IS
    'UI表示専用の現場呼称（1〜5字）。請求書・税務書類には full_name を使う。';
COMMENT ON COLUMN public.profiles.onboarding_completed_at IS
    'NULL = 初回オンボーディング未完了。';
