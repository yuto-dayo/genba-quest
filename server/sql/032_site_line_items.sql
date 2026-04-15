-- 032: Site line items — 現場の工事項目（見積/作業内容）
-- 売上登録時にプリフィルされ、誰がいつ登録・変更したかを追跡

CREATE TABLE IF NOT EXISTS public.site_line_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  item_name text NOT NULL,
  quantity numeric,
  unit_name text,
  unit_price numeric,
  sort_order int DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.site_line_items IS '現場の工事項目（見積/作業内容）';
COMMENT ON COLUMN public.site_line_items.item_name IS '工事名';
COMMENT ON COLUMN public.site_line_items.quantity IS '数量（任意）';
COMMENT ON COLUMN public.site_line_items.unit_name IS '単位（任意）';
COMMENT ON COLUMN public.site_line_items.unit_price IS '単価（任意）';
COMMENT ON COLUMN public.site_line_items.sort_order IS '表示順';
COMMENT ON COLUMN public.site_line_items.created_by IS '登録者';
COMMENT ON COLUMN public.site_line_items.updated_by IS '最終変更者';

CREATE INDEX IF NOT EXISTS site_line_items_site_id_idx
  ON public.site_line_items (site_id);
