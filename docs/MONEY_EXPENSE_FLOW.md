# Money / Expense Flow Design

経費管理フローの設計仕様。GENBA QUESTの「請求漏れゼロ + 黒字可視化」MVP直結ドメイン。

> Status: Draft (2026-05-10)
> Branch: `feature/expense-approval-policy`
> Related: [DESIGN_PHILOSOPHY.md](./DESIGN_PHILOSOPHY.md), [PROPOSAL_SYSTEM.md](./PROPOSAL_SYSTEM.md), [LEDGER_SYSTEM.md](./LEDGER_SYSTEM.md), [POLICY_SYSTEM.md](./POLICY_SYSTEM.md)

---

## 0. North Star: 番頭レス可視性

> **誰が何をしても状況が明確に見える。誰が抜けても経費が迷子にならない。**

- 担当者(owner)を持たせない。代わりにフィールド単位の編集ログで「誰が何をしたか」を表現する
- 状態はバケット/カンバンで可視化する。放置されると滞留日数で老化が見える
- 全コンテキストは経費エンティティに同梱する（DM・口頭引き継ぎに依存させない）
- 権限ゲートで止めない。誰でも触れる、ただし編集ログは完璧
- AI/自動処理も必ず履歴に残す（"システムが推定" を明示、silent auto-changeなし）

これは経費だけでなくTodayやSitesにも適用する全体UI原則。本ドキュメントでは経費領域への適用を仕様化する。

---

## 1. 設計の核

### 1.1 思想転換: 「承認」から「原価証跡」へ

経費管理の主目的は不正防止ではなく、**現場原価の証跡管理**である。

- 「この現場は本当に儲かっているか？」が見えること
- 「あとから請求・精算・原価確認できる状態」になっていること
- 職人を止めない。ただし原価・請求・証憑の未解決は絶対に見逃さない

### 1.2 record-first, close-gated

- 現場では止めない。レシートは即時記録される
- 締め・請求・会計転記の前には未解決を残さない
- 「承認しないと記録できない」はNG。「記録されたから即会計確定」もNG

### 1.3 既存原則との整合

GENBA QUESTのDAO原則をそのまま経費に適用する。

- **Proposal経由**: 全状態変更はProposal/Eventで進行
- **AI自己承認禁止**: AI(OCR)起票はhuman verified必須
- **Ledger追記のみ**: 締め後はimmutable、修正は逆仕訳Event
- **Policy従属**: PolicyEngineが scope/閾値/カテゴリ判定の正本

---

## 2. データモデル

### 2.1 Scope（紐付け先 4種）

| scope | 意味 | 紐付けキー | 例 |
|---|---|---|---|
| `job` | 特定現場の原価 | `job_id` 必須 | その日に投入した材料、現場で食べた昼食 |
| `job_advance` | 未着工 / 着工前の特定現場用先行仕入れ | `job_id` (status=planned/contracted) | 来週着工の◯◯邸用ボード |
| `stockpile` | 共通在庫 / どの現場でも使う消耗品 | なし | ビス、養生テープ、軍手、コーキング |
| `overhead` | 本部経費（配賦不要 or 後配賦） | `cost_center=HQ` | 工具、事務用品、本部車両燃料 |

> 既存スキーマでは `expense_scope: "job" \| "overhead"` の2値。本仕様では4値に拡張する。

### 2.2 Review Status（処理状態）

```
captured        ─→ 起票直後。OCR/職人入力直後
classified      ─→ scope/カテゴリ/job_id がfilled
verified        ─→ 経営者 or 番頭が "見たよ" スタンプ
posted          ─→ Ledgerに転記、Event発行済
closed          ─→ 月次締めでlocked、修正は逆仕訳のみ
```

### 2.3 Flag（並行ラベル、複数可）

```
missing_job             scope=job/job_advanceなのにjob_id欠落
missing_receipt         レシート画像なし
missing_invoice_number  T番号(インボイス登録番号)欠落
duplicate_suspected     同日同店同金額の重複候補
billable_candidate      顧客請求対象の可能性
asset_candidate         10万円超の工具・備品
allocation_pending      stockpile/overhead で按分未確定
advance_stale           job_advance で90日以上未着工
budget_overrun          現場予算に対し原価超過の兆候
out_of_pattern          深夜/休日/現場外など要確認パターン
```

### 2.4 Field Change Log（フィールド単位 append-only）

全フィールドの変更を時系列で記録。電帳法対応・番頭レス可視性の根幹。

```typescript
type FieldChange = {
  field: string;             // "scope" | "job_id" | "amount" | ...
  old_value: unknown;
  new_value: unknown;
  changed_by: ActorRef;      // {type: 'human' | 'ai' | 'system', id: string}
  changed_at: string;        // ISO8601
  source: 'manual' | 'ai_inference' | 'system_auto';
  reason?: string;           // AI推定根拠 / 人間メモ
};
```

### 2.5 主要フィールド（経費1件）

```typescript
type Expense = {
  id: string;
  amount: number;
  vendor_name: string;
  invoice_number: string | null;       // T番号(インボイス登録番号)
  paid_at: string;                     // 支払日
  payment_method: 'cash' | 'card' | 'reimburse' | 'company_card';

  scope: 'job' | 'job_advance' | 'stockpile' | 'overhead' | 'unassigned';
  job_id: string | null;
  cost_center: 'HQ' | string | null;
  category_code: string;               // material / fuel / tool / meal / parking / ...
  billable: 'job_cost_only' | 'invoice_to_customer' | 'company_burden' | 'undecided';

  receipt_image_url: string | null;
  receipt_hash: string | null;         // 重複検出用
  ocr_payload: Record<string, unknown> | null;

  review_status: 'captured' | 'classified' | 'verified' | 'posted' | 'closed';
  flags: Flag[];

  created_by: ActorRef;
  created_at: string;
  field_change_log: FieldChange[];
  verified_by: ActorRef | null;
  verified_at: string | null;
  posted_by: ActorRef | null;
  posted_at: string | null;
  closed_at: string | null;
};
```

---

## 3. State Machine

```
                  ┌─────────┐
                  │captured │  起票直後
                  └────┬────┘
                       │ scope/job_id/category 確定
                       ▼
                  ┌──────────┐
                  │classified│  分類済
                  └────┬─────┘
                       │ 人間レビュー
                       ▼
                  ┌─────────┐
                  │verified │  検証済
                  └────┬────┘
                       │ Ledger転記
                       ▼
                  ┌────────┐
                  │ posted │  仕訳起票済
                  └───┬────┘
                       │ 月次締め
                       ▼
                  ┌────────┐
                  │ closed │  ロック (修正は逆仕訳)
                  └────────┘
```

### 3.1 遷移ルール

- 任意ステップから `captured` へ戻すフラグはなし（あくまで前進、修正は逆仕訳）
- `classified` 以前は誰でも編集可。`verified` 以後の編集はフィールドログ必須
- `posted` 以後の編集は **逆仕訳Event起票** によってのみ可能
- `closed` 以後は immutable（電帳法対応）

### 3.2 自動遷移とSilent禁止

- AIがOCR/分類した瞬間は **そのまま `captured` のまま**。"AIが触ったが人間確認待ち"を明示
- ただし `classified` 自動遷移する条件: 人間が scope/job/category 全部明示confirmした場合のみ
- silent auto-classify は禁止 (DAO原則: AI自己承認禁止)

---

## 4. Flow（職人 / 経営者 / 会計士 視点）

### 4.1 起票フロー（職人）

```
1. 職人がレシート撮影
2. アップロード → OCRが金額/店名/日時/T番号を抽出
3. AIがscope候補をランキング提示:
     - 時刻に近い現場 (作業日報/予定)
     - 場所近接 (EXIF or カードMCC)
     - 同日他経費の現場
     - 直近着工予定の現場 (job_advance候補)
     - 共通在庫 / 本部
4. 職人は1タップで選ぶ → classified
   選ばない → unassigned/captured で残る
5. 任意: メモ追加（"◯◯部分の追加分" 等）
```

職人は通知を見ない。詳細ビューで自分の経費の"その後"だけ追える。

### 4.2 検証フロー（経営者 / 番頭）

```
1. Money画面トップで「未verified」バケットを開く
2. 古い順 or 大きい順でリスト表示
3. 1件タップ → 詳細ビュー
4. 必要なら scope/category/job_id を直す（フィールドログに記録）
5. T番号など欠落フィールドを補完
6. "verify" ボタン押下 → verified に遷移
```

verifiedは個人ではなく**経営者ロール**の誰かが押せばいい（owner不在）。

### 4.3 仕訳起票（システム + 経理担当）

- `verified` のものは月次締め前にバッチで `posted` 候補として表示
- 経理担当(あなた / 会計士)が確認 → posted 一括実行
- 各経費がLedger Eventに転記される（既存Ledger機構）

### 4.4 月次締め（明示アクション）

- 月末 -7日: 「締め前ダッシュボード」が会計士向けに開放
  - 未verified n件 / 未posted n件 / 未割当 n件 / asset_candidate n件
- 月末 / 翌月初: 経営者が明示的に "締める" を押す → closed
- silent auto-closeはしない

### 4.5 月次締め後の修正

- closed済み経費はimmutable
- 修正したい場合: 専用UIで「修正Event」を起票 → **逆仕訳新規Event** + 正しい仕訳新規Event
- 元のLedger entryは消えない（電帳法対応）

---

## 5. Money画面 UX

### 5.1 トップダッシュボード（番頭レス可視性の中核）

```
┌─ 今月の経費（2026-05） ──────────────────────┐
│                                                │
│  未割当          要確認         verified待ち  │
│  ¥45,200         ¥120,400       ¥320,800      │
│  12件 ⚠3日↑     8件 ⚠締め7日前  24件          │
│                                                │
│  posted          asset候補      advance滞留   │
│  ¥1,240,500     ¥180,000        ¥35,000       │
│  86件           2件             1件 ⚠90日↑    │
│                                                │
│  ─────────────────────────────────────────    │
│  今月損益見込み                                │
│    売上(確定)        ¥4,200,000               │
│    原価(posted)      ¥1,240,500               │
│    原価(未posted)    ¥486,400  ←締めまでに反映│
│    本部経費          ¥180,000                  │
│    粗利見込み        ¥2,293,100                │
│                                                │
│  現場別黒字                                    │
│    ◯◯邸  +¥420,000   進行中                  │
│    □□邸  +¥180,000   完工                    │
│    △△邸  -¥40,000 ⚠ 進行中(原価超過兆候)     │
└────────────────────────────────────────────────┘
```

### 5.2 各バケットタブ

開くと該当ステータスの経費がリスト表示。古い順 / 金額順 切替可。

```
[要確認] タブ:
  □ 05-08 ホムセン橋本店  ¥8,400   missing_job [推定:◯◯邸]
  □ 05-09 セルフGS        ¥6,200   missing_invoice_number
  □ 05-09 ENEOS           ¥5,800   duplicate_suspected (同日同店)
  □ 05-10 マキタ販売店    ¥48,000  asset_candidate
  ...
```

### 5.3 詳細ビュー（経費1件）

タップで開く。1画面に全コンテキスト同梱。

```
┌─ 経費 #EXP-20260508-0123 ──────────────────────┐
│ ¥8,400  ホムセン橋本店  2026-05-08 14:23      │
│ 支払: 田中(立替)  T番号: T1234567890123       │
│                                                │
│ ステータス: classified  [verify]               │
│ フラグ: ⚠ missing_invoice_number              │
│                                                │
│ ─ 紐付け ─                                    │
│   Scope:    job                                │
│   現場:     ◯◯邸                              │
│   カテゴリ: 材料費 > 木材                      │
│   請求区分: invoice_to_customer (顧客請求対象)│
│                                                │
│ ─ レシート ─                                  │
│   [画像サムネイル]                             │
│   OCR raw: "...合板12mm 4枚 ¥8,400..."        │
│                                                │
│ ─ AI推定理由 ─                                │
│   現場候補: ◯◯邸 (時刻一致、当日午前作業)    │
│   カテゴリ: 木材 (品目"合板"より)              │
│                                                │
│ ─ 編集履歴 ─                                  │
│   05-08 14:23 田中(職人) が起票               │
│                  金額/ベンダー/日時 を入力     │
│   05-08 14:23 system が OCR推定                │
│                  T番号candidate → 抽出失敗     │
│   05-08 14:23 ai が scope推定                  │
│                  scope:job, job:◯◯邸          │
│   05-08 14:24 田中(職人) が確認                │
│                  scope/job/category 確定       │
│                                                │
│ ─ アクション ─                                │
│   [verify]  [scope変更]  [現場変更]           │
│   [メモ追加]  [請求書から逆引き]              │
└────────────────────────────────────────────────┘
```

### 5.4 コンポーネント分解

| コンポーネント | 役割 |
|---|---|
| `MoneyDashboard` | バケット一覧 + 損益サマリ + 現場別黒字 |
| `BucketCard` | 各バケットの件数・金額・滞留日数表示 |
| `ExpenseList` | バケット内の経費リスト |
| `ExpenseDetail` | 詳細ビュー（モーダル or ページ） |
| `FieldChangeLog` | 編集履歴セクション |
| `JobCandidateChips` | 起票時の現場候補1タップ選択 |
| `ScopePicker` | scope 4値 + あとで決める |
| `BillableToggle` | 請求区分セレクタ |
| `CloseGateBanner` | 月末-7日に出す宿題リスト誘導 |

---

## 6. Anomaly Detection（異常検知）

### 6.1 ポジショニング

> **不正検知ではなく、原価・請求・証憑のリスク検知。**

ラベルは「不正疑い」ではなく「要確認 / 原価未確定 / 請求漏れ候補 / 証憑不足 / 重複候補 / 予算超過候補」。

### 6.2 Phase 1: ルールベース（AI不要）

| ルール | フラグ |
|---|---|
| `scope=job` で `job_id` null | `missing_job` |
| `receipt_image_url` null | `missing_receipt` |
| 同日 同vendor 同金額 が複数 | `duplicate_suspected` |
| `receipt_hash` 一致 | `duplicate_suspected` (強) |
| カテゴリ=工具 かつ amount >= 100,000 | `asset_candidate` |
| `scope=job_advance` で 90日以上 job未着工 | `advance_stale` |
| 現場原価 > 見積原価 × 0.9 | `budget_overrun` |
| 見積にないカテゴリで支出 | `billable_candidate` (追加請求候補) |
| 締め日5日前で `posted` 未到達 | dashboard alert |
| `invoice_number` null | `missing_invoice_number` |

### 6.3 Phase 2以降: AI拾い

- 過去パターンからの逸脱（"普段◯◯円のところが3倍"）
- 現場プロファイルからの逸脱（"内装現場で土工材料費"）
- 説明文生成（"なぜこの経費が要確認か"を日本語で添える）

ただし**AIは推奨のみ**、確定アクションは人間。

---

## 7. 日本税務対応

### 7.1 インボイス制度

- 全経費レシートから T番号(`invoice_number`) をOCRで抽出
- 抽出失敗時は `missing_invoice_number` フラグで verified 前に補完誘導
- T番号なしの経費は仕入税額控除対象外として posted 時にメタデータ記録

### 7.2 電子帳簿保存法

- レシート画像は immutable storage（hash付き）
- `field_change_log` は append-only（電帳法上の訂正・削除履歴要件を満たす）
- closed 後は immutable、修正は逆仕訳

### 7.3 資産閾値

| 金額 | 取扱（中小企業） | UIフラグ |
|---|---|---|
| 10万円未満 | 全額経費（消耗品費 / 工具器具備品） | なし |
| 10〜20万円 | 一括償却資産（3年均等） | `asset_candidate` (一括償却) |
| 20〜30万円 | 少額減価償却資産特例（即時、年300万まで） | `asset_candidate` (特例) |
| 30万円以上 | 通常の減価償却 | `asset_candidate` (要資産化) |

GENBA QUEST側に資産台帳は持たない（運用軽視）。`asset_candidate` フラグ + メモで会計士に渡せる粒度に留める。

---

## 8. Phase Plan

### Phase 1: 詳細ビュー + バケットダッシュボード + 未割当バケット

- 経費詳細モーダル/ページ実装
- Money画面トップを6バケット構成に再設計
- scope 4値拡張（DBマイグレーション）
- field_change_log の append-only 実装
- Job候補チップス（時刻/場所/予定ベース）
- ルールベース異常検知（Section 6.2 全項目）
- T番号フィールド + missing_invoice_number フラグ

**この時点で達成される価値:**
- 「今月の未割当 ¥45,200」が一望できる
- 「現場原価が正しく集計される」（job未紐付け即発見）
- 「請求漏れ候補が見える」（billable_candidate）

### Phase 2: 締め前ダッシュボード + 逆仕訳UI

- 月末-7日の宿題リスト表示
- closed 状態のロック実装
- 修正Event（逆仕訳）UI
- T番号バリデーション（国税庁API連携）

### Phase 2.5: 按分（配賦）

- stockpile / overhead の月次按分
- 按分方式選択（均等 / 売上比 / 直接原価比）
- 現場別損益への自動反映

### Phase 3: AI拡張

- パターン逸脱検知（過去データ学習）
- 異常理由の日本語説明文生成
- 請求書/見積からの逆引き請求漏れ検出

### Phase 4: 自走

- 番頭役をシステムが代替
- 経営者は例外対応のみ

---

## 9. 既存コードとの接続点（Phase 1スコープ）

| 既存資産 | 拡張内容 |
|---|---|
| `server/src/services/PolicyEngine.ts` | `expense.create/update/void` policy に scope 4値判定を追加 |
| `server/src/routes/accounting.ts` `/expenses` | `expense_scope` を 4値に拡張、`field_change_log` 記録 |
| `server/src/services/ProposalService.ts` | 既存 Proposal 経由フローはそのまま活用 |
| `frontend/src/pages/Money.tsx` | バケットダッシュボード + 詳細ビュー再設計 |
| `frontend/src/components/ExpenseModal.tsx` | 起票UI（scope候補チップス追加） |
| `supabase/migrations/` | scope拡張、field_change_log テーブル、flags 配列 |

詳細な現状コードのギャップ分析は `docs/MONEY_EXPENSE_FLOW_GAP_ANALYSIS.md` に分離する（次フェーズ作業）。

---

## 10. オープン論点

1. T番号バリデーション（国税庁API連携）はPhase 1で入れるか、Phase 2に倒すか
2. 番頭ロール（経営者以外でverifyできる人）を組織に持たせるか、当面は経営者ロールのみか
3. 共通在庫 stockpile の按分タイミング（月次? 締め時? 期初予算配賦?）
4. closed 後の修正Eventで、誰が逆仕訳を起票できるか（経営者のみ? 会計士も?）
5. レシート画像のストレージ方針（Supabase Storage? S3? 保存期間?）

---

## 11. 職人語マッピング（UI表示の正本）

UI画面に出す全ての文字列は、内部コード値ではなく「一般的な職人が一読してわかる日本語」にする。
内部コード（DB列名・API field・enum値・型・ログ）は英語のまま使ってよい。**コード値とUI表示は必ず分離する。**

### 11.1 Scope（紐付け先）

| 内部コード | UI表示 | 補足説明 |
|---|---|---|
| `job` | 現場（◯◯邸） | 具体的な現場名で表示 |
| `job_advance` | 先行仕入れ | 「着工前にまとめ買いした分」 |
| `stockpile` | 共通在庫 | 「どの現場でも使う消耗品」 |
| `overhead` | 本部・会社 | 「事務所・工具など」 |
| `unassigned` | 未割当 | 「あとで決める」と並列表示可 |

### 11.2 Review Status（処理状態）

| 内部コード | UI表示 | 短縮形 |
|---|---|---|
| `captured` | 登録した | 登録済み |
| `classified` | 現場決め済み | 分類済み |
| `verified` | 確認済み | 確認OK |
| `posted` | 帳簿入り | 処理済み |
| `closed` | 月締め済み | 月締め |

### 11.3 Flag（並行ラベル）

| 内部コード | UI表示 | アイコン色 |
|---|---|---|
| `missing_job` | 現場が未決 | 赤 |
| `missing_receipt` | レシートなし | 黄 |
| `missing_invoice_number` | インボイス番号なし | 黄 |
| `duplicate_suspected` | 重複かも | 赤 |
| `billable_candidate` | お客さんに請求？ | 青 |
| `asset_candidate` | 高額な工具 | 青 |
| `advance_stale` | 90日以上動いてない | 赤 |
| `allocation_pending` | 配分待ち | 黄 |
| `budget_overrun` | 儲け薄くなりそう | 黄 |
| `out_of_pattern` | 要確認 | 黄 |

### 11.4 アクション・操作系

| 内部用語 | UI表示 |
|---|---|
| verify ボタン | 「OK」 / 「確認した」 |
| post / posting | 「経費に上げる」 |
| close month | 「月を締める」 |
| reverse / 逆仕訳 | 「修正する」（裏で逆仕訳起票） |
| approve | 「OK」 |
| reject | 「やり直し」 |

### 11.5 経理用語の柔らかい言い換え（社長視点画面でも適用）

| 経理用語 | UI表示 |
|---|---|
| 原価 | 経費 |
| 粗利 / 売上総利益 | 利益 |
| posted金額 | 帳簿入り済 |
| 未posted金額 | まだ反映されていない |
| 売上(確定) | 売上 |
| 立替精算 | 立替分 |

### 11.6 そのまま使える語（職人にも通じる）

- 経費・売上・利益・現場・見積・請求・領収書・レシート・写真
- インボイス番号（T番号は補語）・税込・税抜・消費税
- 材料費・燃料費・工具・食事・駐車場
- 月締め・締め日

### 11.7 画面に出さない（内部のみ）

- 経費の内部ID（`#EXP-20260508-0123` などのコード化IDはトップ画面に出さない、詳細フッターに小さく）
- `org_id` / `idempotency_key` / `proposal_id` などの技術メタ情報
- `cost_center === "HQ"` のような英語enum値の生表示
- `field_change_log` / `metadata_json` / `transition_status` などの技術用語

### 11.8 ルール

- 新しい内部コードを追加する時は、必ずこの表に**UI表示**を併記してから実装に入る
- フロントの定数ファイル(例: `frontend/src/lib/expenseLabels.ts`)に正本を持ち、画面で参照する
- バックエンドのenum追加 → 表更新 → フロント定数追加 の順を守る

---

## 12. 参照

- 議論ログ: `feature/expense-approval-policy` ブランチの本セッション
- 設計原則: [DESIGN_PHILOSOPHY.md](./DESIGN_PHILOSOPHY.md)
- 既存仕様: [PROPOSAL_SYSTEM.md](./PROPOSAL_SYSTEM.md), [LEDGER_SYSTEM.md](./LEDGER_SYSTEM.md)
- メモリ: `feedback_bus_factor_resilient_ux.md`（番頭レス可視性）
- メモリ: `feedback_plain_language_ui.md`（職人にわかる日本語UI）
