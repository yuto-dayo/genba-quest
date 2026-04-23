# ADR: Org Membership Auth Boundary Plan

## Status

Proposed

## Context

現状のコードベースは `org_id` を多くの業務テーブルで扱っている一方、認証・認可の正本がまだ揃っていない。

- 認証ミドルウェアは JWT の `app_metadata.org_id` / `user_metadata.org_id` を読んで `req.orgId` を決め、無ければ `DEFAULT_ORG_ID` にフォールバックしている。
  - `server/src/middleware/authMiddleware.ts`
- `sites` の member API は `profiles` 全件を返しており、org 境界を考慮していない。
  - `server/src/routes/sites.ts`
  - `frontend/src/lib/api.ts`
  - `frontend/src/components/SiteFormModal.tsx`
  - `frontend/src/components/SiteDetailModal.tsx`
  - `frontend/src/components/calendar/CalendarScheduleModal.tsx`
  - `frontend/src/pages/Communications.tsx`
  - `frontend/src/pages/Settings.tsx`
  - `frontend/src/components/luqo/pathTab/usePathTabState.ts`
- `party` `stamina` `communications` `accounting` `badges` `monsters` `webhooks` でも `profiles` を直接参照しており、role/status を profile に持つ前提が残っている。
  - `server/src/routes/party.ts`
  - `server/src/routes/stamina.ts`
  - `server/src/routes/communications.ts`
  - `server/src/routes/accounting.ts`
  - `server/src/routes/badges.ts`
  - `server/src/routes/monsters.ts`
  - `server/src/routes/webhooks.ts`
- 既存 RLS は多くのテーブルで `auth.jwt() -> ... ->> 'org_id'` に依存している。
  - `server/sql/034_clients_org_scope.sql`
  - `server/sql/040_communication_conversations.sql`
  - `server/sql/041_sites_org_scope.sql`
  - `server/sql/049_proposal_execution_and_posting_groups.sql`
  - `server/sql/051_reward_run_canonical_tables.sql`
- `profiles` は初期 migration から `role` `approval_limit` を直接持っている。
  - `server/sql/001_core_tables.sql`
  - `server/sql/000_fix_profiles.sql`

このまま Google ログインを先行すると、認証入口だけ広がって org 境界が閉じないままになる。

## Decision

所属の正本を `org` とし、認可の正本を `org_memberships` に寄せる。

- `profiles` はグローバルな個人情報だけを持つ
- role / status / title / approval_limit のような org 固有属性は membership 側へ移す
- `active_org_id` は JWT の正本にしない
- API は毎回 `resolveActiveOrg(req)` と `requireOrgMembership(userId, orgId, minRole?)` を通す
- member picker は共通の `listOrgMembers(orgId)` だけを使う
- 招待状態の正本は `org_invites` とし、`org_memberships` に `invited` は持たせない
- RLS は段階的に JWT 依存から membership existence 依存へ寄せる

## Phase Plan

### Phase 1: Org 境界の正本を追加

最優先。Google ログインより先に実施する。

#### 1. Schema

新規 migration を追加する。

想定ファイル:

- `server/sql/056_org_membership_foundation.sql`

追加テーブル:

```sql
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  name text not null,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.org_memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  status text not null check (status in ('active', 'suspended', 'removed')),
  title text,
  approval_limit numeric,
  joined_at timestamptz,
  suspended_at timestamptz,
  suspended_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create table public.org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email_normalized text not null,
  role text not null check (role in ('admin', 'member')),
  status text not null check (status in ('pending', 'accepted', 'revoked', 'expired')),
  token_hash text not null,
  expires_at timestamptz not null,
  invited_by uuid references public.profiles(id) on delete set null,
  accepted_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

必要 index:

```sql
create index on public.org_memberships (org_id, status);
create index on public.org_memberships (user_id, status);
create index on public.org_memberships (org_id, role, status);
create index on public.org_invites (org_id, email_normalized, status);
```

有効招待を 1 件に寄せるため、`pending` の partial unique index を検討する。

```sql
create unique index org_invites_active_email_idx
  on public.org_invites (org_id, email_normalized)
  where status = 'pending';
```

招待の state machine は `org_invites` 側に閉じる。

- `org_invites.status`: `pending | accepted | revoked | expired`
- `org_memberships.status`: `active | suspended | removed`

pending を管理画面に表示したい場合も、members API に混ぜず invites API を別で持つ。

#### 2. Seed / Backfill

既存の単一 org 運用を壊さないため、移行時に以下を行う。

- 既定 org を `organizations` に 1 件投入
- 既存 `profiles` を `org_memberships` に backfill
- `profiles.role` と `profiles.approval_limit` を membership へコピー
- `status = 'active'`

`profiles` の `role` `approval_limit` はすぐに drop しなくてよい。Phase 1 では read path を membership に切り替え、後続 phase で削除する。

#### 3. RLS helper

migration で membership 判定関数を作る。RLS helper は `public` ではなく非公開 schema に寄せる。

想定:

```sql
create schema if not exists private;

create function private.is_active_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.org_memberships m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;
```

管理ロール判定も用意する。

```sql
create function private.has_org_role(p_org_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.org_memberships m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any (p_roles)
  );
$$;
```

policy からは fully qualified で呼ぶ。

```sql
using (private.is_active_member(org_id))
```

`org_memberships` 自身の policy は自己参照を避ける。membership table は helper を使い回さず、必要なら `user_id = auth.uid()` を直接使う policy と管理用 service-role 経路を分ける。

Phase 1 で最低限差し替える対象:

- `sites`
- `clients`
- `communication_*`

既存の `auth.jwt().*.org_id` ベース policy は、この helper に順次置換する。

### Phase 2: API の入口統一

想定追加ファイル:

- `server/src/lib/orgAccess.ts`
- `server/src/services/OrgMemberDirectoryService.ts`

責務:

```ts
export async function resolveActiveOrg(req: AuthenticatedRequest): Promise<string>
export async function requireOrgMembership(input: {
  userId: string;
  orgId: string;
  minRole?: "member" | "admin";
}): Promise<OrgMembership>
export async function listOrgMembers(orgId: string): Promise<MemberDirectoryRow[]>
```

実装方針:

- `authMiddleware` は user identity のみ確定する
- active org の候補は `x-org-id` header または path parameter から受け取る
- query parameter は常用しない
- candidate 未指定時の挙動は固定する
  - active membership 0 件: `ORG_SELECTION_REQUIRED` ではなく onboarding / waiting 扱い
  - active membership 1 件: 自動選択
  - active membership 2 件以上: `ORG_SELECTION_REQUIRED`
- JWT metadata の `org_id` はヒントに留め、最終認可には使わない
- `DEFAULT_ORG_ID` は backfill 期間の暫定 escape hatch とし、Google ログイン公開前に除去する

修正対象:

- `server/src/middleware/authMiddleware.ts`
  - `resolveOrgIdFromUser()` を廃止
  - `req.orgId` の埋め込みを middleware の責務から外す
- `server/src/lib/org.ts`
  - `DEFAULT_ORG_ID` fallback utility から `resolveActiveOrg` 呼び出しの façade に置換
- `server/src/index.ts`
  - 認証後に org 解決 middleware を差し込むか、各 route 冒頭で helper を呼ぶ

### Phase 3: Member API の一本化

最初の具体的な漏れ止め。

新規 endpoint:

- `GET /api/v1/org/members`

返却 shape 案:

```ts
type OrgMemberRecord = {
  user_id: string;
  org_id: string;
  role: "admin" | "member";
  status: "active" | "suspended" | "removed";
  display_name: string | null;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
};
```

参照元:

- `org_memberships`
- `profiles`

置換対象:

- `server/src/routes/sites.ts`
  - `GET /members` は削除または `GET /api/v1/org/members` への proxy のみ残す
- `frontend/src/lib/api.ts`
  - `fetchMembers()` を `/api/v1/org/members` に差し替える
- `frontend/src/components/SiteFormModal.tsx`
- `frontend/src/components/SiteDetailModal.tsx`
- `frontend/src/components/calendar/CalendarScheduleModal.tsx`
- `frontend/src/pages/Communications.tsx`
- `frontend/src/pages/Settings.tsx`
- `frontend/src/components/luqo/pathTab/usePathTabState.ts`

補足:

PATH の `fetchPathProfiles()` は別概念なので温存してよい。ただし member selector の基準データは `fetchMembers()` に統一する。

招待管理は別 endpoint に分離する。

- `GET /api/v1/org/invites`
- `POST /api/v1/org/invites`
- `POST /api/v1/org/invites/:id/revoke`

### Phase 4: Profiles 直参照の解消

以下は `listOrgMembers()` か membership join へ置換する。

- `server/src/routes/party.ts`
  - 全員集計を `profiles` 全件ではなく active membership ベースにする
- `server/src/routes/stamina.ts`
  - 対象 user が active membership を持つか確認する
- `server/src/routes/communications.ts`
  - `loadProfilesByIds()` `resolveProfile()` に org membership existence を追加する
- `server/src/routes/accounting.ts`
  - `ensureInvoiceSettingsManager()` と承認権限判定を `org_memberships` へ移す
- `server/src/routes/badges.ts`
  - 過半数判定母数を active membership count に変える
- `server/src/routes/monsters.ts`
  - worker 取得を active membership + profile に制限する
- `server/src/routes/webhooks.ts`
  - 通知先 admin 抽出を membership role で行う

### Phase 5: Google ログイン

ここで初めて OAuth を広げる。

必要変更:

- frontend の Supabase Auth UI / login flow
- server 側の profile upsert endpoint または login callback 処理

ルール:

- ログイン成功時に `profiles` を upsert
- 招待が無ければ `org_memberships` は作らない
- `org_invites.email_normalized` と Google email が一致しない場合は参加させない

### Phase 6: Team Management Read UI

Settings に以下の閲覧 UI を追加する。

- active members 一覧
- pending invites 一覧
- active org の表示

まだ書き込み操作は出さない。

### Phase 7: Team Management Write + Audit + Suspension Guarantees

管理 write を出すなら、この phase で監査ログと停止 guarantees を同時に入れる。

追加するもの:

- 招待作成
- ロール変更
- 停止
- 再有効化
- 監査ログ
- 停止時の session / membership enforcement

最初は `admin` / `member` の 2 ロールだけでよい。

停止時の正確な意味:

停止時の server-side guarantees:

- `org_memberships.status = 'suspended'`
- refresh token 失効
- 既存 access token は expiry までは残り得る前提で扱う
- 全 API で membership status を確認
- RLS でも `status = 'active'` だけ許可

つまり「即時停止」は sign out のみでは成立しない。毎回の membership status 確認と RLS によって実効的に止める。高リスク操作には `session_id` 検証または再認証を要求できる余地を残す。

監査ログは管理機能と同時に追加する。

最低限記録するイベント:

- invite_created
- invite_revoked
- membership_created
- membership_role_changed
- membership_suspended
- membership_reactivated
- active_org_changed

### Phase 8: Active Org 切替

- active org の保持
- 前回 org の復元
- 複数 org 所属時の選択導線

## Concrete File Plan

### Backend

1. `server/sql/056_org_membership_foundation.sql`
   - organizations / memberships / invites / private helper functions / RLS
2. `server/src/lib/orgAccess.ts`
   - active org 解決と membership 認可
3. `server/src/services/OrgMemberDirectoryService.ts`
   - member picker 正本 API
4. `server/src/routes/org.ts`
   - `/api/v1/org/members` `/api/v1/org/invites`
5. `server/src/middleware/authMiddleware.ts`
   - user identity のみ担当
6. `server/src/routes/sites.ts`
   - `/members` の置換
7. `server/src/routes/communications.ts`
   - profile 解決の org 制約追加
8. `server/src/routes/party.ts`
9. `server/src/routes/stamina.ts`
10. `server/src/routes/accounting.ts`
11. `server/src/routes/badges.ts`
12. `server/src/routes/monsters.ts`
13. `server/src/routes/webhooks.ts`

### Frontend

1. `frontend/src/lib/api.ts`
   - `fetchMembers()` の endpoint / response 更新
2. `frontend/src/components/SiteFormModal.tsx`
3. `frontend/src/components/SiteDetailModal.tsx`
4. `frontend/src/components/calendar/CalendarScheduleModal.tsx`
5. `frontend/src/pages/Communications.tsx`
6. `frontend/src/pages/Settings.tsx`
7. `frontend/src/components/luqo/pathTab/usePathTabState.ts`

## Test Plan

最低限追加する。

### SQL / integration

- active membership が無い user は `sites` を読めない
- suspended membership は `sites` `clients` `communications` を読めない
- org A member は org B の members list を取得できない
- org A member は org B の invites list を取得できない
- 招待 email 不一致では membership 作成されない
- active membership 2 件以上で active org 未指定なら `ORG_SELECTION_REQUIRED`

### Route unit tests

- `GET /api/v1/org/members` は active membership のみ返す
- `GET /api/v1/org/invites` は pending/accepted/revoked/expired を invite 正本として返す
- `sites` の member API が全 profiles を返さない
- `accounting` の approval 権限判定が membership role / approval_limit を使う
- `webhooks` の admin 通知先が membership role で絞られる

### Frontend

- `fetchMembers()` を使う画面が `role/status` を壊さず描画できる
- member picker は suspended user を候補に出さない

## Non-Goals For Phase 1

- 複数 org 切替 UI の完成
- Passkeys
- 別 email の account linking
- `profiles` から role 列を即削除すること

## Consequences

### Positive

- Google ログイン前に org 境界を閉じられる
- 複数 org 所属に耐える
- role/status が org 単位で自然に扱える
- RLS と API 認可の責務が一致する

### Negative

- `profiles` 直参照が多いため Phase 1 の変更面積は広い
- 既存の `DEFAULT_ORG_ID` 前提テストがかなり壊れる
- `profiles.role` に依存した既存ロジックは段階移行が必要

## Recommended First PR Split

1. DB foundation
   - organizations / memberships / invites / private helper functions / backfill / RLS
2. Server auth boundary
   - `orgAccess.ts` / `org` route / `sites` member API
3. Frontend member picker migration
   - `fetchMembers()` 利用箇所の統一
4. Profile direct-read cleanup
   - `party` `stamina` `communications` `accounting` `badges` `monsters` `webhooks`
5. Google login
