# Mobile-First Decision Playbook

`designing-m3-expressive-ui` で使う補助資料。  
UI デザイナーの暗黙知を、再現可能な判断フローに変換する。

## 1. Priority Scoring (P0/P1/P2)

各 UI 要素を次式で採点する。

`Priority Score = Impact x Frequency x Risk`

- Impact: 成功時の価値（1-3）
- Frequency: 利用頻度（1-3）
- Risk: 失敗時の被害（1-3）

分類ルール:

- `18-27`: `P0`（主導線）
- `8-17`: `P1`（補助導線）
- `1-7`: `P2`（後段または隠す）

## 2. Visual Hierarchy Mapping

P レベルを視覚パラメータに固定マッピングする。

| Level | Size | Contrast | Position | Motion |
| --- | --- | --- | --- | --- |
| P0 | Largest | Highest | Thumb-friendly zone | Immediate feedback |
| P1 | Medium | Moderate | Near P0 | Subtle |
| P2 | Small | Lower (still accessible) | Secondary area | Minimal |

運用ルール:

- 同一画面の P0 は原則 1 つ
- P0 と P1 の差は「色だけ」に依存しない
- P2 は初期表示で露出しすぎない

## 3. Cognitive Load Budget

初期表示の情報量を制御する。

- Primary CTA: 1
- Secondary actions: 最大 2
- 初期の意思決定要素: 最大 5
- 詳細は progressive disclosure で開く

避けるべき状態:

- 初期表示で選択肢が 6 個以上ある
- 1画面に同等の強調要素が 3 個以上ある
- エラー説明が抽象的で次アクション不明

## 4. Mobile Reachability Rules

- 主要 CTA は下部（親指到達）を基本にする
- 重要な破壊操作は誤タップ防止の間隔を確保する
- タップターゲットは `48dp` 以上
- 固定フッターは内容を隠さないよう bottom padding を管理する

## 5. Motion Decision Rules

モーション追加前に必ず目的を宣言する。

- Orientation: 要素の関係性を伝える
- Confirmation: 成功/失敗を明確にする
- Attention: 1 箇所だけに注目を集める

制限:

- 装飾のみのモーションは採用しない
- 同時発火は最小化する
- `prefers-reduced-motion` で代替表現を提供する

## 6. Accessibility Gate

- テキストは背景に対して十分なコントラストを持つ
- 色だけで状態を伝えない（ラベル/アイコン併用）
- フォーカス可能要素は状態が判別可能
- エラー文言は「原因 + 次アクション」を含む

## 7. Pre-Ship Review Script

実装後は次を実行し、結果を記録する。

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx eslint src/
cd frontend && npm run build
```

記録テンプレート:

```md
## Mobile UI Verification
- Screen: <name>
- Viewport: 375x812
- P0 Action completion: <seconds>
- Reachability issue: <none | details>
- Accessibility blockers: <none | details>
- Motion reduced-mode check: <pass | fail>
```

