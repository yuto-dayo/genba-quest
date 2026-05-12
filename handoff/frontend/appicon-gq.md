# GQ monogram favicon swap

## 0. Quick Resume (AI)

- NEXT_CMD: `ユーザー確認待ち`
- SUCCESS_CRITERIA: `favicon 16px で GQ が識別可能 / iOS角丸後と Android円マスク後に欠けなし`
- HOTSET:
  - `/Users/yutoyoshino/Documents/genba-quest/frontend/public/appicon-genba-quest.png`
- STATE:
  - Branch: `feature/appicon-gq`
  - Base: `origin/master`
  - Updated: `2026-05-12`

## L1. Summary

- 旧アイコンは「GENBA QUEST」7文字 → 16px favicon で完全に潰れて識別不能だった
- 「GQ」2文字モノグラムに切り替え → 16px でも識別可能
- HTML / manifest 側は触らず（既に PR #46 の sizes-tagged 構成のまま）

## L2. Changes

- 全アイコンを GQ デザインに再生成（Arial Black, kerning -5%, 中央90% any / 中央60% maskable）
- 対象: `appicon-genba-quest.png(1024)`, `apple-touch-icon.png(180)`, `icon-{192,512}.png`, `icon-maskable-{192,512}.png`, `favicon-32.png`, `favicon.ico(16/32/48)`

## L3. Verification

- マスクシミュレーション全パス（iOS squircle / Android circle / favicon 16px）
- 実機 iOS / Android 確認はユーザータスク
