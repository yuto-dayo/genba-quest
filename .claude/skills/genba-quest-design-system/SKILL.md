---
name: genba-quest-design-system
description: UIデザイン仕様。カラー・タイポグラフィ・コンポーネント・スタイルガイドライン。UI実装時に参照
---

# Design System - GENBA QUEST

## Global Rules

### Product UI Direction

**Style:** Calm Cockpit

GENBA QUEST is a work OS for construction teams. App screens must prioritize speed, trust, and clear decisions over decorative impact. Keep the existing gameful character in small moments, but never let it compete with daily work, money, approvals, or site operations.

### Five UI Principles

1. **Calm density** — Keep useful information visible, but make navigation, borders, icons, and secondary metadata visually quiet.
2. **Decision-first** — Pages lead with the next decision or answer, not a list of features.
3. **Expressive only for decisions** — Use stronger color, shape, motion, and contrast only for approvals, warnings, close/fix actions, reward confirmation, and irreversible or high-stakes states.
4. **Direct + Sherpa split** — Frequent simple actions stay in direct UI. Complex, conditional, multi-step actions go through Sherpa and Proposal review.
5. **Transparent automation** — AI/Sherpa output must show proposal content, evidence, impact, and approval/retry paths before execution.

### Screen Jobs

| Screen | Job |
|---|---|
| Today | Show today's sites, blockers, pending approvals, and money/reward alerts in 10 seconds. |
| Calendar | Let someone answer availability and assignments during a phone call. |
| Sites | Work as a site operations queue: progress, close readiness, issues, and next actions. |
| Money | Show accounting/reward trust: totals, differences, evidence, approvals, and payout state. |
| Sherpa | Generate explainable Proposals, not hidden direct mutations. |

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#0D9488` | `--color-primary` |
| Secondary | `#14B8A6` | `--color-secondary` |
| CTA/Accent | `#F97316` | `--color-cta` |
| Background | `#F0FDFA` | `--color-background` |
| Text | `#134E4A` | `--color-text` |

**Color Notes:** Teal is the calm system identity. Orange is reserved for primary actions and important decisions. Do not use accent color for decoration, inactive navigation, or generic cards.

### Typography

- **Heading Font:** Plus Jakarta Sans
- **Body Font:** Plus Jakarta Sans
- **Mood:** calm, work-focused, clear, trustworthy, lightly gameful

**CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap');
```

### Type Scale Rules

- Use compact, left-aligned headings inside app surfaces.
- Reserve large display type for marketing pages only.
- Do not use viewport-scaled type in operational screens.
- Keep letter spacing at `0`; do not use negative tracking.
- Dense tables, queues, and dashboards should favor `13px-16px` readable text with clear row spacing.

### Spacing Variables

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding |
| `--space-lg` | `24px` / `1.5rem` | Section padding |
| `--space-xl` | `32px` / `2rem` | Large gaps |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: #F97316;
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #0D9488;
  border: 2px solid #0D9488;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #F0FDFA;
  border-radius: 8px;
  padding: 16px;
  box-shadow: var(--shadow-sm);
  transition: border-color 180ms ease, box-shadow 180ms ease, background 180ms ease;
  cursor: pointer;
}

.card:hover {
  box-shadow: var(--shadow-md);
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: #0D9488;
  outline: none;
  box-shadow: 0 0 0 3px #0D948820;
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

## Style Guidelines

**Style:** Calm Cockpit

**Keywords:** calm density, decision-first, quiet navigation, evidence-rich, high-trust, operational cockpit, readable under pressure

**Key Effects:** compact hierarchy, subtle separators, stable layout, meaningful status color, visible focus, quick confirmation states

### Page Pattern

**Pattern Name:** Decision Cockpit

- **First viewport:** next decision, current state, blockers, and primary action
- **Section Order:** Current answer > work queue > evidence/detail > secondary tools
- **Navigation:** 4 main screens plus Sherpa FAB; do not add top-level destinations unless a daily job requires it
- **Cards:** use for repeated items only; do not nest cards or make every page section a floating card
- **Expressive UI:** apply only to high-stakes decision states, not as page decoration

### Decision Components

Sherpa, approval, reward, close/fix, and accounting decisions must expose:

- Proposal or action summary
- Evidence and source data
- Impacted site/member/month/account
- Risk or irreversible consequence
- Primary approve/confirm action
- Secondary reject, retry, edit, or view details action

### Accessibility Baseline

- Interactive targets: minimum `24px`; preferred `44px-48px` for touch-heavy workflows.
- Keyboard focus must be visible and not hidden by sticky headers, bottom bars, or overlays.
- Drag/drop must have a click or menu alternative.
- Color must never be the only indicator of status, severity, selection, or completion.
- Respect `prefers-reduced-motion`; motion explains state changes only.
- Validate narrow mobile, tablet, desktop, 200% zoom, and reduced motion for key flows.

## Writing / Copy Guidelines（文言の設計方針）

UIに表示するすべての文言（ボタン・ラベル・メッセージ・エラー・ツールチップ・空状態文）は、現場で働く人がパッと見て迷わず理解できる日本語を最優先する。

### 3原則

1. **馴染みやすく** — 現場で実際に使われる言葉を選ぶ。業務・会計・技術の専門用語より日常語を優先する。
2. **短く** — 画面で1〜2秒で読める長さ。冗長な敬語・前置き・修飾を削る。ボタンは最大8文字、本文1行は30文字目安。
3. **簡単に** — 小学校高学年が読んで分かる漢字・語彙。カタカナ語・英略語は馴染みがある場合のみ使用。

### 良い例 / 悪い例（Before → After）

| NG（長い・硬い・専門的） | OK（短い・馴染む・簡単） |
|---|---|
| 「提案を承認する」 | 「OK / 承認」 |
| 「当該案件は現在審議中です」 | 「確認中です」 |
| 「入力された値が不正です」 | 「うまく入力できませんでした」 |
| 「トランザクションが失敗しました」 | 「保存できませんでした。もう一度お試しください」 |
| 「ワークフローを実行します」 | 「はじめる」 |
| 「エンティティが存在しません」 | 「見つかりませんでした」 |
| 「ログインしてください」 | 「サインイン」or「はじめる」 |

### ドメイン用語の扱い

- **Proposal / Ledger / Event** などの設計用語は、UI上では日常語に翻訳する（例: Proposal → 「申請」「予定」「仮の記録」／Ledger → 「帳簿」「記録」）。
- 例外: ユーザーが既に業務で使っている用語（「見積」「請求」「発注」など）はそのまま使用。
- エラーメッセージは「何が起きたか」より「次に何をすればよいか」を書く。

### Tone

- 命令形より誘導形（「やってください」より「やってみよう」「次へ」）。
- 現場仲間のような、親しみと敬意のある距離感。過剰な敬語や業務文書調は避ける。
- 絵文字は使わない（SVGアイコン方針と一致）が、言葉で温度感を出す。

## Anti-Patterns (Do NOT Use)

- 2D-only layouts
- Poor image quality
- AI purple/pink gradients
- Oversized app-screen heroes
- Feature showcase layouts inside operational app screens
- Decorative cards that do not represent an item, decision, or modal
- Nested cards
- Decoration-only gradients, orbs, glows, and loud backgrounds
- Expressive motion that does not explain a state change
- Hidden AI execution without Proposal/evidence/impact preview
- **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- **Layout-shifting hovers** — Avoid scale transforms that shift layout
- **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- **Instant state changes** — Always use transitions (150-300ms)
- **Invisible focus states** — Focus states must be visible for a11y
- **硬い/長い/専門用語の文言** — 現場の人が一読で意味を取れないコピーは使わない（Writing Guidelines 参照）

## Pre-Delivery Checklist

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover/focus/active states do not shift layout
- [ ] Motion is purposeful and respects `prefers-reduced-motion`
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] Focus is not hidden behind sticky UI
- [ ] Drag interactions have non-drag alternatives
- [ ] Touch targets are at least 24px, preferably 44px-48px for mobile
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
- [ ] First viewport shows the screen's next decision or primary answer
- [ ] Secondary navigation and metadata are visually quieter than working content
- [ ] Accent color is used only for CTA, warning, approval, close/fix, or reward-confirm states
- [ ] Sherpa/AI actions show proposal, evidence, impact, and approval/retry paths
- [ ] 文言が短く・馴染み・簡単（ボタン ≤8字、本文1行 ≤30字目安）
- [ ] 専門用語・英略語を現場向けの日常語に翻訳済み
- [ ] エラー文は「次に何をすればよいか」を伝える
