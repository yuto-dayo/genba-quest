ALTER TABLE public.monthly_evaluation_forms
  ADD COLUMN IF NOT EXISTS work_days integer NOT NULL DEFAULT 0 CHECK (work_days >= 0),
  ADD COLUMN IF NOT EXISTS a_score smallint NOT NULL DEFAULT 1 CHECK (a_score BETWEEN 0 AND 2),
  ADD COLUMN IF NOT EXISTS r_score smallint NOT NULL DEFAULT 1 CHECK (r_score BETWEEN 0 AND 2),
  ADD COLUMN IF NOT EXISTS q_score smallint NOT NULL DEFAULT 1 CHECK (q_score BETWEEN 0 AND 2),
  ADD COLUMN IF NOT EXISTS current_level text
    CHECK (current_level IN ('L1', 'L2', 'L3', 'L4'));
