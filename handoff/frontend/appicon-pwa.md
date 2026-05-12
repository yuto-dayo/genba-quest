# PWA app icon set with safe zones

## 0. Quick Resume (AI)

- NEXT_CMD: `ユーザー確認待ち（実機: iOS ホーム追加 / Android maskable preview）`
- SUCCESS_CRITERIA: `iOS角丸後に文字欠けなし / Android円マスク後に GENBA QUEST が完全可読 / Lighthouse PWA アイコン警告ゼロ`
- HOTSET:
  - `/Users/yutoyoshino/Documents/genba-quest/frontend/index.html`
  - `/Users/yutoyoshino/Documents/genba-quest/frontend/public/manifest.webmanifest`
- DO_NOT_READ:
  - `docs/DESIGN_PHILOSOPHY.md` (full)
- STATE:
  - Branch: `feature/appicon-maskable`
  - Base: `origin/master`
  - Updated: `2026-05-12`

## L1. Summary

- 旧 `appicon-genba-quest.png` 1枚で `icon` / `shortcut icon` / `apple-touch-icon` を兼用していた
- 文字が外周5px以内まで詰まっていたため iOS 角丸マスク後に四隅の "G/A/Q/T" が欠ける
- Android maskable では中央60%領域を超えて文字があり、円マスクで半分以上欠ける状態だった

## L2. Changes

- `frontend/public/appicon-genba-quest.png` 再生成（中央90% safe zone, #0158F1 端まで塗布, 角丸はOS任せ）
- 追加: `apple-touch-icon.png(180)`, `icon-192.png`, `icon-512.png`, `icon-maskable-{192,512}.png`, `favicon-32.png`, `favicon.ico`
- 追加: `frontend/public/manifest.webmanifest`（any + maskable purposes 宣言, theme_color #0158F1, background_color #1E40AF）
- `frontend/index.html` の `<link rel="icon|shortcut icon|apple-touch-icon">` を sizes 付き正規版 + `<link rel="manifest">` に置換、`theme-color` を `#ffffff` → `#0158F1`

## L3. Verification next steps

- iOS Safari 実機 → ホーム画面に追加 → 角丸後に文字欠けゼロ確認
- Android Chrome → `https://maskable.app` で円/squircle/teardrop 全マスク確認
- Chrome DevTools → Application → Manifest 全アイコン緑
- Lighthouse PWA カテゴリでアイコン関連警告ゼロ
