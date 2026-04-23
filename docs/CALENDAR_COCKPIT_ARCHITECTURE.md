# Calendar Cockpit Architecture

最終更新: 2026-04-16  
対象: Phase C Calendar / Assignment / Proposal UX

---

## 1. 本質

GENBA QUEST の Calendar は予定を記録する場所ではない。  
現場配置の意思決定を安全に進める **cockpit** である。

主役は `event` ではなく、以下の 2 つ。

- `slot`: 必要人数・役割・資格・不足
- `proposal`: 変更案・承認待ち・差し戻し・監査履歴

価値は「何が埋まっているか」ではなく、次を追えることにある。

- どこに判断が必要か
- 誰が何を変えようとしているか
- その変更にどんな副作用があるか
- 何が確定で、何が未確定か

---

## 2. Product Stance

### A案を先に出す

初手の主役は **空き確認・差配中心**。

- 今どこが足りないか
- 誰をどこへ動かせそうか
- どの変更が承認待ちか
- その変更がどこを危険にするか

### B案は power mode として育てる

**Scenario Studio** は魅力が大きいが、preview engine と conflict engine が弱い段階で前面に出すと危ない。

- MVP: A案
- v1: A案の上に B案を統合
- 最終像: A を入口、B を深掘りにする

---

## 3. DAO 整合の原則

1. 変更は常に Proposal として扱う  
   ドラッグや編集は即 DB 反映しない。まず draft layer に載せる。
2. 状態を混ぜない  
   `draft / pending / approved / executed / rejected / conflict / warning` を 1 見た目に潰さない。
3. 事実と意図と評価を分ける  
   - 事実: `approved / executed`
   - 意図: `draft / pending`
   - 評価: `ok / warning / blocking_conflict`
4. Read と Write を分ける  
   Calendar は projection を読む。変更は `preview -> submit -> approve` を踏む。
5. AI は比較装置であって決裁者ではない  
   候補提示、比較、影響説明、rationale 下書きまで。
6. 危険と不確実性を先に見せる  
   競合、データ鮮度、資格不一致、移動コストを隠さない。
7. 1 つの write model、複数の read model  
   組織 view と個人 view は同じ Proposal 基盤を読む。

---

## 4. 画面情報設計

### 一次切替

- `[組織]`
- `[個人]`

### 二次切替

- `[運用]`
- `[提案]`
- `[シナリオ]`

### 三次切替

`月 / 週 / 日` は IA の主役ではなく、**表示モード**。

---

## 5. 共有セクション

全 view で以下を共通骨格とする。

1. `Decision Summary`
   - 不足現場
   - 動かせる人員
   - 承認待ち
   - 競合
   - 休み希望
2. `Main Canvas`
   - 組織: `site × day × role`
   - 個人: `my commitments × day`
3. `Needs Attention Rail`
   - 今日判断が必要な proposal
   - 欠員
   - 競合
   - stale evaluation
4. `Draft / Proposal Tray`
   - いま組み立てている差分
5. `Impact / Audit Drawer`
   - before / after
   - side effect
   - approver
   - 履歴
   - AI 比較案

---

## 6. 状態モデル

1 enum ではなく 4 軸で扱う。

### Lifecycle

- `draft`
- `pending`
- `approved`
- `executed`
- `rejected`

### Effect

- `add`
- `move`
- `remove`
- `leave_request`
- `availability_update`

### Evaluation

- `ok`
- `warning`
- `blocking_conflict`

### Relevance

- `mine`
- `requires_my_action`
- `watch_only`

これにより `pending cancel + source shortage warning + affects me` のような複合状態を表現できる。

---

## 7. Read Model / API

最低限必要な projection / API は以下。

- `organizationCalendarProjection(range, filters, overlay?)`
- `personalCalendarProjection(actorId, range, overlay?)`
- `proposalPreview(changeset or draftId)`
- `proposalInbox(viewerScope)`
- `proposalSubmit`
- `proposalApprove`
- `proposalReject`

UI から `assignment.create/update` を直接叩かない。  
UI は **Proposal Draft** を作る。`assignment.*` は proposal payload に入る内部表現。

---

## 8. MVP

### A案ベース

- 週 / 日の Coverage Grid
- site/day detail drawer
- drag & drop で draft 生成
- Draft Tray
- proposal preview
- approve / reject
- basic conflict engine
  - 二重配置
  - 承認済み休暇衝突
  - 必要資格ミスマッチ
  - 必要人数不足
- minimal personal view
  - 自分の 7 日
  - 自分の pending
  - 休み希望
  - availability
  - 自分関連 pending

### 非MVP

- 完全自動差配
- AI 自動 submit / approve
- black-box な最適化スコア主導 UX
- 複雑な月表示カスタマイズ

---

## 9. v1

- proposal bundle / dependency
- stale evaluation detection
- proposal discussion / comments
- notification center
- mobile-first personal view
- richer warning engine
  - 移動時間
  - 連勤
  - 休息
  - 資格失効
  - データ鮮度
- approved と executed の差分履歴
- Scenario Studio の本格統合
- AI 比較案
  - 最小移動
  - 最小競合
  - 最小不足

---

## 10. 実装順

1. 状態モデル
2. preview engine
3. read model
4. A案ベースの組織 cockpit
5. 個人 minimal view
6. approval inbox / warning engine
7. proposal bundle / stale evaluation
8. B案 Scenario Studio
9. AI 比較支援 / execution feedback / forecasting

---

## 11. フロント実装方針

現行フロントは event 中心の月/週 UI を持つ。  
これを一気に捨てるのではなく、以下の順で寄せる。

1. 画面の一次導線を `組織 / 個人` と `運用 / 提案 / シナリオ` に変更
2. `Decision Summary` を最上段に置く
3. `Needs Attention Rail` を proposal inbox として前面化
4. `AssignmentSimulator` を `日次差配 / シナリオ` 面へ閉じ込める
5. slot 中心 read model が入った段階で `Coverage Grid` へ移行

---

## 12. 結論

Calendar の正体は「予定表」ではなく、**現場配置版の pull request cockpit**。

- 組織 view は全体最適の判断面
- 個人 view は自分の commitment と変更影響の確認面
- どちらも同じ Proposal 基盤を読む

この前提を崩さずに進める。
