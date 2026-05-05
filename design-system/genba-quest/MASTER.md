# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** GENBA QUEST
**Generated:** 2026-02-01 18:33:15
**Category:** Work OS / Construction Operations

---

## Global Rules

### Product UI Direction

**Style:** Calm Cockpit

GENBA QUEST is a construction work OS. UI must help guild members and admins understand today's work, site status, accounting, rewards, and approvals quickly. Gameful styling may appear as light flavor, but operational clarity always wins.

### Five Principles

1. **Calm density** - Keep useful information visible while making secondary UI quiet.
2. **Decision-first** - Lead with the next decision or answer, not feature promotion.
3. **Expressive only for decisions** - Use strong color, shape, and motion only for approvals, warnings, close/fix actions, and reward confirmation.
4. **Direct + Sherpa split** - Frequent simple actions stay in direct UI; complex multi-step actions go through Sherpa.
5. **Transparent automation** - Sherpa/AI output must show proposal content, evidence, impact, and approval/retry paths.

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#0D9488` | `--color-primary` |
| Secondary | `#14B8A6` | `--color-secondary` |
| CTA/Accent | `#F97316` | `--color-cta` |
| Background | `#F8FAFC` | `--color-background` |
| Text | `#134E4A` | `--color-text` |

**Color Notes:** Teal is the calm system identity. Orange is reserved for primary actions and high-stakes decision states. Do not use accent color for decorative cards or inactive navigation.

### Typography

- **Heading Font:** Plus Jakarta Sans
- **Body Font:** Plus Jakarta Sans
- **Mood:** calm, work-focused, clear, trustworthy, lightly gameful
- **Google Fonts:** [Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans)

**CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap');
```

### App Type Scale

- App screen headings: `24px-28px`
- Section titles: `18px-20px`
- Body/list text: `14px-16px`
- Labels/metadata: `12px-14px`
- Large display type is reserved for marketing pages or rare empty states.
- Do not use viewport-scaled app text or negative letter spacing.

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

---

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
  background: #FFFFFF;
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

---

## Style Guidelines

**Style:** Calm Cockpit

**Keywords:** calm density, decision-first, quiet navigation, evidence-rich, operational cockpit, readable under pressure

**Best For:** construction operations, accounting, approvals, site scheduling, reward transparency

**Key Effects:** compact hierarchy, subtle separators, stable layout, meaningful status color, visible focus, quick confirmation states

### Page Pattern

**Pattern Name:** Decision Cockpit

- **First viewport:** next decision, current state, blockers, and primary action
- **Section Order:** Current answer > work queue > evidence/detail > secondary tools
- **Navigation:** Today / Calendar / Sites / Money plus Sherpa FAB
- **Cards:** repeated items, decision cards, and modals only; no nested cards
- **Expressive UI:** high-stakes decision states only

---

## Anti-Patterns (Do NOT Use)

- ❌ Oversized heroes in app screens
- ❌ Feature-showcase layouts inside operational workflows
- ❌ Decoration-only gradients, neon, scanlines, glows, and loud backgrounds
- ❌ Nested cards or card-heavy page sections
- ❌ Expressive motion without state meaning
- ❌ Hidden AI execution without Proposal/evidence/impact preview

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

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
- [ ] Accent color is used only for CTA, warning, approval, close/fix, or reward-confirm states
- [ ] Sherpa/AI actions show proposal, evidence, impact, and approval/retry paths
