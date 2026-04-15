---
name: designing-m3-expressive-ui
description: Use this skill when designing or implementing mobile-first Material 3 Expressive interfaces for GENBA QUEST. This includes translating UI designer tacit knowledge into explicit decisions for hierarchy, motion, emphasis, and cognitive load; defining UI tokens; building React + CSS Modules screens; and validating smartphone usability, accessibility, and performance.
---

# Designing M3 Expressive UI

GENBA QUEST でスマホ前提の UI を作るときに、M3 Expressive の見た目だけでなく「デザイナーの暗黙知」を再現可能な手順に落とすためのスキル。

## When To Use

- 「Material 3 Expressive を強めに入れたい」
- 「モバイルファーストで画面を再設計したい」
- 「暗黙知（優先度設計、視線誘導、認知負荷管理）を明文化して実装したい」
- Phase C で Today/Calendar/Sites/Money などの UI を刷新する

## Non-Negotiables

- Mobile-first で設計開始する（`360px` / `375px` を基準）
- 主要操作は 1 画面 1 目的に収束させる
- タップターゲットは `48dp` 以上
- Primary CTA は親指到達性を優先して下部配置を基本にする
- `prefers-reduced-motion` に必ず対応する
- 既存プロジェクト規約（React + CSS Modules + Framer Motion）を崩さない

## Core Workflow

### 1. Frame The Job To Be Done

画面実装前に、次の 5 点を 1 行ずつ固定する。

- Screen Job: この画面の主目的（例: 「承認待ちの判断を 30 秒で終える」）
- P0 Action: 最重要操作（1つだけ）
- Failure Cost: 操作ミス時の被害（低/中/高）
- Usage Context: 現場利用条件（片手操作/屋外/急ぎ）
- Data Confidence: 表示データの信頼性（確定/暫定/未検証）

### 2. Translate Tacit Knowledge Into Decisions

暗黙知を「好み」ではなく決定項目にする。

- Priority Ladder: `P0`（主目的）/ `P1`（補助）/ `P2`（後回し）
- Visual Weight: 色、サイズ、余白、動きで `P0 > P1 > P2` を明確化
- Cognitive Budget: 初期表示の選択肢を絞る（段階的開示を優先）
- Error Friction: 危険操作には確認と可逆性をセットで持たせる

詳細な判断基準は `./mobile-first-decision-playbook.md` を使う。

### 3. Define M3 Expressive Tokens Before Components

コンポーネント実装より先にトークンを確定する。

- Color roles: `primary/secondary/tertiary/surface/error` を役割で定義
- Type scale: モバイル見出しと本文の階層を明示
- Shape/elevation: カード、ボタン、モーダルの丸みと奥行きを統一
- Motion tokens: 速度・イージング・距離を用途別に固定

推奨管理:

- `frontend/src/styles/tokens.css`（または既存トークン定義ファイル）
- CSS Modules では生値を避け、可能な限り CSS 変数を参照する

### 4. Build Mobile-First Layout

- Base layout を `360px` / `375px` で完成させる
- その後 `768px`（tablet）と `1024px+`（desktop）へ拡張
- 重要情報は first viewport に収める
- Bottom navigation / bottom sheet / sticky action bar を優先検討
- スクロール深度が増える場合は section 見出しで現在位置を維持する

### 5. Add Expressive Motion With Purpose

- Motion は「状態変化の説明」にのみ使う
- 初期表示、画面遷移、成功/失敗フィードバックに用途を限定する
- 目安: `150ms-280ms` の短い遷移を基本にする
- 同時アニメーションは最小化し、注意の競合を防ぐ

### 6. Implement And Verify

実装後は次を実行する。

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx eslint src/
cd frontend && npm run build
```

確認項目:

- 主要 CTA が片手で届く
- 文字コントラストが不足しない
- 状態変化が視覚だけに依存していない（文言/アイコン併用）
- モーション低減設定でも操作意図が伝わる

## Deliverable Format

UI 実装時は最終報告に以下を含める。

1. Screen Job と P0 Action
2. 優先度設計（P0/P1/P2）
3. 採用したトークン方針（色/タイポ/形状/モーション）
4. モバイル検証結果（375px を明示）
5. 既知のトレードオフ（何を捨てたか）

## Anti-Patterns

- Desktop レイアウトを縮小しただけの「疑似モバイル対応」
- すべてを強調して結果的に何も強調されない設計
- 装飾モーションの過多による可読性低下
- 主要操作が fold 下に埋もれる情報過多レイアウト
- トークン未整備のままコンポーネントを量産する実装

## Examples

### Example 1

User Query:
"Today ページを M3 Expressive でモバイル最適化して"

Approach:

1. Screen Job と P0 Action を固定する
2. `./mobile-first-decision-playbook.md` で優先度と視線導線を決める
3. トークン定義を更新してから UI 実装
4. `375px` で操作完了までの導線を検証する

### Example 2

User Query:
"暗黙知込みで承認キュー画面を再設計して"

Approach:

1. Failure Cost と Error Friction を先に定義する
2. 危険操作に可逆性を付与する
3. CTA を親指領域に配置し、P0 と P1 を視覚分離する
4. モーション低減時の挙動も含めて検証する

## References

- Material 3 for Compose: https://developer.android.com/develop/ui/compose/designsystems/material3
- M3 Design Theming Codelab: https://developer.android.com/codelabs/m3-design-theming
- Visual Hierarchy in UX Design: https://www.nngroup.com/articles/visual-hierarchy-ux-definition/
- 10 Usability Heuristics for UI Design: https://www.nngroup.com/articles/ten-usability-heuristics/
- Design Council Double Diamond: https://www.designcouncil.org.uk/our-resources/the-double-diamond/

