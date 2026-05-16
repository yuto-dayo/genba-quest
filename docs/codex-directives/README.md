# Money Redesign — Codex 5.5 Directive Index

Authoring guide for the Money画面リデザイン implementation. Read this file first, then proceed PR by PR.

## How to use this directory

Each `PR-NN.md` is a self-contained implementation brief. Codex 5.5 executes one PR at a time:

1. Read `README.md` (this file) once per session.
2. Read the target `PR-NN.md`.
3. Open the visual reference: `frontend/src/pages/MoneyMock.tsx` (mounted at `/money-mock` in dev).
4. Implement per the brief, write tests if applicable, open PR.
5. Mark the PR's checkboxes in the brief before requesting review.
6. Write the PR description using the **Final Report Format** (see end of this file).

Do NOT cross PR boundaries. If a brief says "out of scope, see PR-XX," obey.

## Order of Precedence (conflict resolution)

When sources disagree, follow this order **strictly**:

1. **PR-NN directive** — most specific, this PR's contract
2. **README.md** (this file) — cross-PR shared rules
3. **`frontend/src/pages/MoneyMock.tsx`** — visual source of truth for Money redesign
4. **`frontend/src/styles/genba-quest.css`** — token canonical (M3 expressive system)
5. **`.claude/skills/designing-m3-expressive-ui/SKILL.md`** — judgment frame (Apple HIG + Calm Cockpit + M3 expressive), in-project skill
6. **Project memories** under `.claude/projects/.../memory/`

If you find yourself wanting to follow #5 against #1–#4, **stop and ask in the PR**. Don't silently compromise.

## Apple HIG skill adoption + overrides

We adopt `.claude/skills/designing-m3-expressive-ui/SKILL.md` (consolidated Apple HIG + M3 expressive skill) as the judgment frame. **Adopt** the following parts verbatim:

- **Non-Negotiables** (1–9)
- **Apple-Derived Design Translation** table
- **Human Need Contract** (write it in every FE PR description that touches user-facing screens)
- **Priority Ladder** (P0/P1/P2 classification)
- **Content vs Control layer separation**
- **Motion only for causality** (150–280ms baseline, `prefers-reduced-motion` required)
- **Interface copy** rules (button ≤ 8 JA chars where possible, action-oriented, no system jargon)
- **Pre-Delivery Checklist**
- **Anti-Patterns** list
- **Final Report Format** (see bottom of this README)

**Override** the following parts of the skill — DO NOT follow them as written:

| Skill says | We do instead | Why |
|---|---|---|
| Create `frontend/src/styles/tokens.css` with `--color-*`, `--space-*`, `--radius-*` | **Use existing `frontend/src/styles/genba-quest.css`** with `--md-sys-*` and `--money-*` namespaces. Token values are fixed; only additions allowed | The project already runs on M3 expressive tokens. A parallel `tokens.css` would split the namespace |
| Identity color = teal `#0D9488` + CTA orange `#F97316` | **Identity = M3 indigo `#4F46E5`** (`--md-sys-color-primary`). No teal, no orange | M3 indigo is shipped and reflected in MoneyMock; teal/orange would re-skin without approval |
| "One P0 per viewport, only one" interpreted literally on the Money 3-tier hero | **Money hero P0 = ① 報酬 self card** only. ② 立替 and ③ 会社 are P1. Other-member carousel cards are P2 | The 3-tier hero is one P0 (personal stake) wrapped in two complementary contexts, not three competing P0s |
| "Bottom CTA / sticky action bar for P0 on phone" | **For Money page, P0 reachability uses FAB (labelled `[+ 追加]`)** which is sticky-bottom-right | Decided per `project_money_fab_single_entry.md`; the skill's pattern is honored, just with FAB instead of full-width sticky bar |
| "Orange is for primary action / important decision only" | **Use `--md-sys-color-primary` (indigo) for primary actions, `--money-status-overdue` (M3 error red) for danger** | Color identity decided in M3, not Apple HIG example |

When the skill and an override above disagree, the override wins. Add a one-liner in the PR description: "Followed override per README.md row X."

## Human Need Contract (required for FE PRs touching user screens)

Before writing JSX/CSS, fill this out in the PR description:

```md
Human Need: safety / understanding / accomplishment / trust / relief
User Anxiety: <one sentence: what is the user worried about?>
Screen Job: <one sentence: purpose of this screen/component>
P0 Decision: <the one decision this surface makes easy>
Failure Cost: low / medium / high
Usage Context: one-hand / outdoor / in a hurry / phone call / office
Data Confidence: confirmed / provisional / missing / AI-generated
```

Skip this for BE-only PRs (PR-01, PR-06, PR-09) and infra PRs (PR-07).

## Foundational artifacts (already shipped)

| Artifact | Location | Status |
|---|---|---|
| Design Tokens | `frontend/src/styles/genba-quest.css` | PR #16 ✅ merged before this series |
| Visual Mock | `frontend/src/pages/MoneyMock.tsx` + `.module.css`, route `/money-mock` | PR #0 ✅ same |

These define the design system Codex implements against. Do NOT redesign visual decisions — copy from the mock.

## North-star principles (read once, internalize)

From `feedback_money_design_principles.md`:

1. **Money は説明しない、状態を見せる**: 文章でなくカード・数字・状態チップで伝える
2. **トップ画面は読む場所でなく見る場所**: 詳細・例外はモーダルへ
3. **主アクションは1箇所固定**: 作成系はFAB一本(報酬請求書のみ自分カードモーダル経由)
4. **空状態は見せない**: ¥0カードや空セクションを並べない
5. **注意書きはUIの敗北**: プライバシーは🛡️アイコン+ポップオーバーへ集約
6. **横スクロールは"入口"**: 自分カード先頭固定、末尾に「全員を見る」
7. **数字は金融プロダクトとして整える**: `font-variant-numeric: tabular-nums` 必須

## Universal acceptance criteria (every PR must satisfy)

These apply to every PR. Do not restate them in each brief.

- [ ] All CSS values reference design tokens. Hardcoded numbers / colors forbidden.
- [ ] Currency figures use `font-variant-numeric: tabular-nums`.
- [ ] Interactive elements ≥ 48 CSS px (`--md-sys-tap-target-min`).
- [ ] State is never conveyed by color alone — always pair with text or icon.
- [ ] `:focus-visible` ring is preserved (do not `outline: none` without replacement).
- [ ] WCAG 4.5:1 contrast on body text.
- [ ] `npx tsc -b --noEmit` passes.
- [ ] No new ESLint errors (`npm run lint` from `frontend/`).
- [ ] Mobile 375px and desktop 1280px both verified manually.
- [ ] No new console errors at runtime.

## Sequencing & dependencies

```
PR-01 (BE: balance/team APIs) ────┐
PR-02 (FE types)          ←──────┘
   ↓
PR-03 (Hero 3-tier)
   ↓
PR-04 (Own reward modal) ──────┐
PR-05 (Other reward modal) ←──┤
                               │
PR-06 (BE: month close reminder) ──┐
PR-07 (Infra: cron)            ←───┘
   ↓
PR-08 (Bell + month-close modal + routing) ←── needs PR-04
   ↓
PR-09 (BE: random reviewer + timed access)
PR-10 (FE: invoice pay modal) ←── needs PR-09
   ↓
PR-11 (Partner/invoice tab refurb)
PR-12 (InvoiceListPanel removal)
PR-13 (Old member-invoice section removal)
PR-14 (PATH route redirect + nav removal)
PR-15 (FAB unification + ExpenseModal paid_by)
PR-17 (UX telemetry)
```

Parallel-safe pairs: (PR-01, PR-06, PR-09), (PR-11, PR-12, PR-15)

Do not start PR-08 before PR-04 lands (modal must exist to route into).
Do not start PR-13 before PR-04 (own modal must absorb invoice issue flow first).
Do not start PR-14 before PR-04 (Money must own the reward viewing path).

## Domain glossary

| Term | English | Meaning |
|------|---------|---------|
| 報酬 | reward | Monthly PATH payout (member's slice of company P/L per attendance × level) |
| 立替 | reimbursable expense | Out-of-pocket money a member spent for company; pending settlement |
| 月確定 | month finalization | Lock PATH drafts → expire objections → finalize for the month |
| 異議 | objection | Member's formal dispute on another's level/role for a month |
| 経理担当 | finance steward | Member with finance flag; randomly assigned per invoice for payout processing |
| メンバー請求書 | member invoice | 個人事業主 → 会社 (DAO-strict RLS, recipient-anonymized at admin layer) |
| 顧客請求書 | customer invoice | 会社 → 客 (visible to all) |

## Privacy & transparency model (CRITICAL — do not redesign)

| Visible to all | Visible only to issuer (DB-RLS) |
|---|---|
| Reward amounts (everyone's) | Member invoice issuer identity |
| Reimbursable expense amounts (everyone's) | Member invoice banking snapshot (`snapshot_*`) |
| Invoice counts & statuses (aggregated) | T-number, real name |
| Customer invoices in full | — |

Member invoice payout actions: a randomly-assigned 経理担当 gets time-bound access via bell notification (PR-09 + PR-10). Do not introduce admin-side "see all member invoices" UI.

References: `project_transparency_as_defense.md`, `project_money_as_single_finance_entry.md`.

## Coding conventions

- React 19 functional components, TSX
- CSS Modules (`*.module.css`) with token-only values
- Zustand for client state (do not introduce Redux/Recoil)
- API client: `frontend/src/lib/api.ts` — add functions here, not ad-hoc fetch
- Server routes: Express 5, `server/src/routes/*.ts`, ProposalService for state changes
- SQL migrations: `supabase/migrations/`, do not edit live DB outside migrations
- Tests: vitest (FE), node test runner (BE). One happy-path + one error case minimum per new function.

## What NOT to do (project-wide)

- Do not introduce role-based UI gating. Everyone has the same UI. (`project_uniform_permission_model.md`)
- Do not add "admin sees all invoices" features (privacy is enforced by DB RLS; do not weaken).
- Do not add typed confirmation modals unless explicitly required by the brief.
- Do not write notes / disclaimers inside cards. Use 🛡️ popover.
- Do not change M3 token VALUES. Adding new tokens is fine; mutating existing is forbidden.
- Do not commit translations changes in UI strings — talk to user first.
- Do not skip pre-commit hooks (`.githooks/pre-commit`).
- Do not push to `master`. Branch + PR.

## Memory references (load when relevant)

- `feedback_money_design_principles.md` — 7 principles + 4 questions
- `feedback_apple_hig_skill_adoption.md` — Apple HIG skill 採用方針と override
- `project_money_as_single_finance_entry.md` — Money画面の単一エントリ方針
- `project_money_fab_single_entry.md` — FAB一本化
- `project_transparency_as_defense.md` — プライバシー設計
- `project_member_personal_stake_priority.md` — 立替/PATH優先表示
- `project_uniform_permission_model.md` — ロール別UI禁止
- `project_billing_reminder_assignment.md` — ランダム経理割当
- `project_month_close_reminder_timing.md` — 月確定リマインダー
- `project_nickname_convention.md` — ニックネーム表示規約

## Final Report Format (use as PR description)

When opening a PR, paste this template at the top and fill it in. Skip sections that don't apply (e.g., BE PRs skip "Mobile Verification").

```md
## UI Implementation Report

### Screen Job (FE PRs only)
- Human Need:
- User Anxiety:
- Screen Job:
- P0 Decision:
- Failure Cost:
- Usage Context:
- Data Confidence:

### Priority Design (FE PRs only)
- P0:
- P1:
- P2:

### Design Decisions
- Structure:
- Navigation:
- Content Layer:
- Control Layer:
- Expressive Treatment:
- Motion:
- Copy:

### Tokens Used / Updated
- Color:
- Type:
- Shape:
- Elevation:
- Motion:

### Mobile Verification (FE PRs only)
- 375px:
- 768px:
- 1024px+:
- Reduced motion:
- Focus / contrast:

### Commands
- `npx tsc -b --noEmit`:
- `npm run lint` (or `npx eslint src/`):
- `npm run build`:

### Trade-offs
- What was intentionally hidden, demoted, or deferred:

### Overrides applied (cite README rows if any)
-
```
