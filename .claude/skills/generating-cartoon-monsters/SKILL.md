---
name: generating-cartoon-monsters
description: "Generate cartoon-style construction monsters for GENBA QUEST. Creates playful, colorful characters with bold outlines, rounded shapes, and casual game aesthetics based on construction transaction details."
---

# Cartoon Monster Generator

Generate fun, colorful cartoon-style monsters for construction sites based on transaction data.

## When to Use

- When generating a new monster image for a construction site
- When updating monster appearance based on new transactions
- When creating monster assets for the dashboard

## Style System Architecture

Instead of a single style, this skill now supports multiple distinct "Cartoon Sub-genres". The system deterministically selects a style based on the Site ID hash, ensuring variety across different sites while maintaining consistency for a specific site.

### Available Style Primitives

| Style ID | Name | Description | Key Visuals |
|----------|------|-------------|-------------|
| `SUPERCELL` | **Modern Mobile 3D** | High-fidelity vector art with 3D volume (Clash Royale/Brawl Stars). | Bold outlines, plastic sheen, rim lighting, vibrant colors. |
| `RUBBER_HOSE` | **Vintage 1930s** | Old-school animation (Cuphead, Early Mickey). | Pie eyes, noodly limbs, ink blot outlines, sepia/muted tones. |
| `GENNDY` | **90s Tartakovsky** | Angular, sharp cartoon network style (Dexter, Samurai Jack). | No outlines (or thick sharp ones), geometric abstraction, hard shadows. |
| `CLAY` | **Claymation** | Stop-motion clay (Aardman, Wallace & Gromit). | Fingerprints, soft lighting, physical texture, no outlines. |
| `FLAT_VECTOR` | **Corporate Memphis** | Modern flat tech illustration (Kurzgesagt). | No outlines, pastel colors, simple geometry, grain texture. |

### Selection Logic

```typescript
Style = Styles[ hash(SiteID) % Styles.length ]
```

This ensures that "Site A" always gets a "Rubber Hose" monster, while "Site B" might get a "Claymation" monster.

## Shared Visual Principles

Regardless of the selected style, all monsters share these traits:

1. **Friendly/Appealing**: Even "Grumpy" monsters should be cute.
2. **Readable**: Clear silhouette, not too cluttered.
3. **Thematic**: Construction elements (hats, tools) are always present.
4. **High Quality**: No artifacts, noise, or unfinished sketches.

### Color Palette

| Color | Hex | Use |
|-------|-----|-----|
| Primary Orange | #FF6B35 | Hard hats, safety vests, main accents |
| Bright Yellow | #FFE66D | Highlights, lights, happy elements |
| Cyan/Teal | #4ECDC4 | Energy, magic, secondary accents |
| Hot Pink | #FF71CE | Special effects, runes |
| Purple | #9B59B6 | Magic/mysterious elements |
| Lime Green | #7CB342 | Nature/eco elements |
| Concrete Grey | #E0E0E0 | Body base, stone elements |
| Charcoal | #2D3436 | Dark metal, tires |

### Typography (for text elements)

- **Font**: Baloo 2 or Comic Neue
- **Style**: Bold, rounded, playful
- **Effects**: Optional drop shadow or outline

## Prompt Template

```
Create a high-quality, professional game asset of a {size} construction monster for a casual mobile RPG.

**Visual Style & Art Direction (CRITICAL):**
- **Aesthetic:** "Supercell" style / Clash Royale / Brawl Stars. High-fidelity vector art look with 3D-like volume.
- **Outlines:** BOLD, CONSISTENT black outlines (4px) around the character silhouette and major parts.
- **Rendering:** Smooth, clean gradients. No noise, no gritty textures. "Plastic" or "Toy-like" sheen.
- **Proportions:** Exaggerated, chunky, rounded, and sturdy. Big hands, big feet, solid stance.
- **Lighting:** Soft, studio lighting with clear highlights and rim lighting.
- **Colors:** Vivid Orange/Yellow/Cyan used against neutral greys/metals.

**Character Specification:**
- **Concept:** {archetype_name} represented as a living character.
- **Name:** "{monster_name}"
- **Personality:** {personality} -> {personality_description}
- **Body Material:** Construction materials (clean concrete, polished metal, safety plastic) stylized to look friendly.

**Specific Details:**
- **Accessories:** {accessories}. Chunky and oversized.
- **Visual Effects:** {effects}. Stylized clean shapes, not realistic particles.
- **Face:** Expressive and charismatic. Large, glowing or bright eyes.

**Context:**
- **Site:** "{site_name}"
- **Work:** "{work_summary}"
- **Composition:** Full body character, centered, slightly 3/4 view (hero pose).
- **Background:** Subtle, abstract construction blueprint pattern or simple gradient.

**Anti-Patterns (Strictly Prohibited):**
- NO Pixel Art, 8-bit, or Retro styles.
- NO Realistic/Gritty textures (no rust, dirt, or scratchy details).
- NO Sketchy or thin lines.
- NO Pale/Muted colors.
- NO Complex/Noise backgrounds.
- NO Text or UI elements in the image.
```

## Monster Personality Matrix

Based on transaction patterns:

| Transaction Pattern | Monster Personality | Visual Traits |
|--------------------|---------------------|---------------|
| High expenses | Hungry/Greedy | Big belly, open mouth, coins |
| Steady income | Happy/Prosperous | Smiling, golden accents |
| Overdue invoices | Grumpy/Sleepy | Furrowed brows, tired eyes |
| Balanced budget | Zen/Calm | Peaceful expression, halo |
| Growth trend | Excited/Energetic | Dynamic pose, sparkles |
| Declining | Worried/Sad | Droopy features, sweat drops |

## Construction Element Integration

Add construction-themed accessories:

| Site Type | Accessories |
|-----------|-------------|
| Residential | Hard hat, hammer, house blueprint |
| Commercial | Crane, steel beams, tie |
| Industrial | Gears, wrench, safety vest |
| Road/Bridge | Traffic cone, concrete mixer |
| Renovation | Paint brush, ladder, dust cloud |

## Anti-Patterns (AVOID)

- ❌ Pixel art / 8-bit / 16-bit retro style
- ❌ Realistic or semi-realistic rendering (gritty textures)
- ❌ Thin, scratchy, or inconsistent outlines
- ❌ Muted or pastel colors (unless specific to material)
- ❌ Scary or aggressive expressions
- ❌ Complex detailed textures (noise)
- ❌ Anime/manga style
- ❌ Dark or horror themes

## Integration Notes

When generating monsters via API:

1. Extract transaction summary from site data
2. Determine personality from transaction patterns
3. Select accessories based on site type
4. Generate prompt using template above
5. Call image generation with style keywords
6. Save as WebP in `/assets/monsters/`

## Quality Checklist

- [ ] Bold black outlines visible
- [ ] Colors are bright and saturated
- [ ] Proportions are chunky/rounded
- [ ] Expression is friendly/playful
- [ ] Construction elements present
- [ ] Style matches casual mobile game look
- [ ] No pixel art or retro aesthetics
