# GENBA QUEST - DAO×AI アーキテクチャ設計書

> **TL;DR（50行で全体像）** - 詳細は各セクションを参照
>
> **3本柱:**
> 1. Proposal中心 - 全状態変更は `draft→pending→approved→executed` のProposal経由
> 2. Event志向Ledger - 追記のみ、逆仕訳で修正、借方=貸方
> 3. AIはPolicyに従属 - AI自己承認禁止（絶対ゲート）
>
> **Actor Types:** `human`(職人) / `ai`(Sherpa) / `integration`(Gmail等) / `system`(自動処理)
>
> **承認ルール:** ≤5,000円=自動 / 5,001-30,000円=1名 / >30,000円=2名
>
> **圧縮の思想:** 全domain = `proposals` + `events` の2テーブル + Read Model(View)で解釈
>
> **トランザクション境界:** 承認 + Event発行 + 状態更新 = 1つのDBトランザクション
>
> **実装フェーズ:** A-0(MVP/ログ化) → A-1(承認フロー) → B(Sherpa統合) → C(UI刷新) → D(高度化)
>
> **セクション目次:**
> - 核心原則（3本柱） L12
> - 圧縮の思想 L62
> - 設計原則 L159
> - Actor Types L286
> - 自動承認レンジ L332
> - Read Models L433
> - 実装フェーズ L660
> - 実装論点（コンカレンシ等） L764
> - 監視・可用性 L946
> - ベイズ的確信度（Think Again） 下記

---

## ベイズ的確信度（Think Again × Thompson Sampling）

本文書の設計原則は「確定事項」ではなく**検証可能な仮説**として扱う。
各原則に Beta分布パラメータ `(α, β)` を持たせ、Proposalの成功/失敗をベイズ更新する。

- **確信度** = `α / (α + β)` — 原則が正しい確率の推定値
- **不確実性** = `αβ / ((α+β)²(α+β+1))` — 小さいほど検証が十分
- **データラベル**: `α+β-2 < 3` → データ不足 / `< 10` → 中程度 / `≥ 10` → 十分

| 原則 | α | β | 確信度 | データ | 根拠 |
|------|---|---|--------|--------|------|
| Proposal中心 | 5 | 1 | 0.83 | 中程度 | A-0で実装・検証済み |
| Event志向Ledger | 3 | 1 | 0.75 | 中程度 | 設計済み、本番検証少 |
| AI Policy従属 | 5 | 1 | 0.83 | 中程度 | PolicyEngineで実装済み |
| 自動承認 ≤5,000円 | 2 | 1 | 0.67 | 不足 | 閾値の妥当性は未検証 |
| 1名承認 ≤30,000円 | 2 | 1 | 0.67 | 不足 | 同上 |
| 2名承認 >30,000円 | 2 | 1 | 0.67 | 不足 | 同上 |
| トランザクション境界 | 4 | 1 | 0.80 | 中程度 | RPC関数で実装済み |
| 冪等性 | 3 | 1 | 0.75 | 中程度 | 設計方針として採用 |
| Ledgerバランス | 3 | 1 | 0.75 | 中程度 | 制約チェックあり |
| ActorRef types | 4 | 1 | 0.80 | 中程度 | 全Proposalで使用中 |
| 2テーブル圧縮 | 2 | 1 | 0.67 | 不足 | Phase 2で本格実装予定 |
| 段階的フェーズ移行 | 3 | 1 | 0.75 | 中程度 | A-0完了で1回検証 |

> **更新ルール**: 人間が主観で α/β を変更してはならない。
> 観測は `principle_observations` テーブルに自動記録される。
> API: `GET /api/v1/principles` で最新の確信度を取得可能。

---

## 思想（Why）

職人チーム（ギルド）を単位とした現場運営・会計・報酬分配を、
**DAO的な透明性** と **AIによる最小限の人的介入** で成立させる。

> 「近未来に自然に存在しているはずの仕事用OS」

---

## 核心原則（3本柱）

### 1. Proposal中心の一元管理

すべての状態変更はProposal経由。直接書き換えは存在しない。

```
User/AI → Proposal作成 → Policy評価 → 承認/自動承認 → 実行 → Event発行
```

**なぜ重要か:**

- 監査性: いつ・誰が・なぜ・何を変えたか追跡可能
- 安全性: LLMが変なことしても「変なProposalが出る」で済む
- デバッグ: 過去の任意時点の状態を再構築可能

### 2. イベント志向のLedger

会計データは追記のみ。修正は逆仕訳で対応。

```
Proposal(approved) → LedgerEvent → LedgerTransaction → LedgerEntry[]
```

**なぜ重要か:**

- 不変性: 一度記録されたイベントは変更不可
- 整合性: 借方合計 = 貸方合計（必ずバランス）
- 完全性: 「帳尻合わせの直接UPDATE」を構造的に排除

### 3. AIを正規アクターとしつつPolicyで縛る

Sherpaは「補助」ではなく「正規の組織メンバー」。ただし憲法（Policy）に従う。

```yaml
AIの制約:
  - 直接DBを書き換える権限は持たない
  - Proposal経由でのみ変更を提案
  - 承認は Policy で許可された範囲のみ
  - 全ての操作はログ・説明付き
```

**なぜ重要か:**

- 透明性: 人間と同じルールで動く
- 制御可能性: Policyで行動範囲を明示的に定義
- 説明可能性: 判断理由が常に記録される

---

## 圧縮の思想（天才ムーブ）

### 究極の抽象化：全domain = Proposal + View

「会計」「報酬」「アサイン」は異なる機能ではない。
**すべて「時間をまたいだ状態変更ログ」の解釈違い**である。

```
従来の発想:
  proposals → expenses テーブル
  proposals → invoices テーブル
  proposals → assignments テーブル
  （ドメインごとにテーブルが増える）

圧縮後の発想:
  proposals → events → View定義で解釈
  （1コア + N個のRead Model）
```

**核心:**

- **書き込みモデル**: `proposals` + `events` の2テーブルのみ
- **読み取りモデル**: View定義（SQL/Materialized View）で自由に生成
- ドメイン追加 = View定義追加（スキーマ変更なし）

```typescript
// 1コアの思想
interface Event {
  id: string;
  proposal_id: string;
  event_type: string;        // 'expense.created' | 'assignment.created' | ...
  payload: JsonB;            // ドメイン固有データ
  occurred_at: timestamp;
}

// Viewで解釈
CREATE VIEW expenses AS
SELECT
  e.id,
  e.payload->>'amount' as amount,
  e.payload->>'site_id' as site_id,
  e.occurred_at as created_at
FROM events e
WHERE e.event_type = 'expense.created';
```

### Policy DSL：Single Source of Truth

**問題:** 今のPolicyEngineはTypeScriptでif文を書いている。
ルールが散らばり、テストとの乖離が生まれる。

**解決:** Policy専用のミニ言語を作り、そこから全てを生成する。

```yaml
# policies/expense.yaml（人間が書く唯一の場所）
expense.create:
  auto_approve:
    when:
      amount: "<= 5000"

  single_approval:
    when:
      amount: "> 5000 AND <= 30000"
    approvers:
      roles: [member, admin]
      ai_allowed: true

  dual_approval:
    when:
      amount: "> 30000"
    approvers:
      roles: [admin]
      ai_allowed: false
      count: 2
```

**自動生成されるもの:**

1. **TypeScript判定関数** - PolicyEngine.ts
2. **PostgreSQL CHECK制約** - migration.sql
3. **テストケース** - policy.test.ts
4. **ドキュメント** - POLICY_RULES.md

```
人間 → YAML → コンパイラ → [TS, SQL, Test, Docs]
                 ↓
         「一箇所変えれば全部変わる」
```

### なぜこれが「天才ムーブ」か

1. **スキーマ変更が減る**: 新ドメイン = 新View、テーブル追加なし
2. **ルールの矛盾が消える**: DSLから生成するから、コードとDBとテストが必ず一致
3. **未来の自分を救う**: 「このルールどこで定義されてる？」→ 1ファイルだけ見ればいい

---

## 設計原則

### データ境界

```
org_id = データの絶対境界
├── 会計・報酬・アサイン・承認履歴は組織ごとに完全分離
└── クロス組織アクセスは存在しない
```

### ユーザーモデル

```
User（グローバル）
  └── user_id: システム全体でユニーク
  └── OrgMember（組織ごと）
        └── org_id + user_id + role（メンバー/管理者/会計）
```

**なぜこうするか:**

- 1人が複数ギルドに所属するケースに対応
- Sherpaは「org + user」ペアでコンテキスト動作

### Proposalの粒度ルール

```
MVPルール: 1ユーザー操作 = 1 Proposal

例:
  - 経費1件登録 → expense.create Proposal 1つ
  - アサイン1件変更 → assignment.update Proposal 1つ
  - 経費10件まとめて → Proposal 10個（bulk_createではない）
```

**なぜこうするか:**

- 監査ログの解釈が単純になる
- UXで「まとめて編集」は後から対応可能
- 内部的にはEvent複数発行できる構造だけ持っておく

### トランザクション境界

**鉄則: 「承認 + Event発行 + 状態更新」は1つのDBトランザクション**

```typescript
await db.transaction(async (tx) => {
  // 1. Proposal承認
  await tx.update(proposals).set({ status: 'approved' }).where(eq(proposals.id, proposalId));

  // 2. LedgerEvent/Transaction/Entry 作成
  const eventId = await tx.insert(ledgerEvents).values({ ... });
  await tx.insert(ledgerTransactions).values({ ... });
  await tx.insert(ledgerEntries).values(entries);

  // 3. Proposal実行完了
  await tx.update(proposals).set({
    status: 'executed',
    executed_at: now(),
    result_event_id: eventId
  });
});
```

**なぜこうするか:**

- 途中で落ちたら「未承認 / 未実行」にロールバック
- 「approvedだけされたけどEventが無い」ゾンビ状態が理論上消える
- `POST /proposals/:id/execute` は「実行前」か「実行済」の二択だけ見ればいい

### 冪等性（Idempotency）

```typescript
// Proposal実行は必ず冪等
POST /api/v1/proposals/:id/execute

// 実装
if (proposal.executed_at) {
  return { status: 'already_executed', event_id: proposal.result_event_id };
}
// 実行処理...（トランザクション内）
```

**なぜこうするか:**

- ワーカー分散時の二重実行防止
- リトライ安全
- event_id = hash(proposal_id + version) で決定的生成

---

## ドメイン構成

```
┌─────────────────────────────────────────────────────────┐
│                    GENBA QUEST                          │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │   Policy    │  │  Proposal   │  │   Sherpa    │     │
│  │  （憲法）    │  │  （提案）    │  │   （AI）    │     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
│         │                │                │            │
│         ▼                ▼                ▼            │
│  ┌─────────────────────────────────────────────────┐   │
│  │              Governance Layer                    │   │
│  │         （承認・投票・ルール適用）                  │   │
│  └─────────────────────────────────────────────────┘   │
│                          │                             │
│         ┌────────────────┼────────────────┐            │
│         ▼                ▼                ▼            │
│  ┌───────────┐    ┌───────────┐    ┌───────────┐      │
│  │  Ledger   │    │  Reward   │    │ Assignment│      │
│  │  （会計）  │    │  （報酬）  │    │（アサイン）│      │
│  └───────────┘    └───────────┘    └───────────┘      │
│         │                │                │            │
│         └────────────────┴────────────────┘            │
│                          │                             │
│                          ▼                             │
│  ┌─────────────────────────────────────────────────┐   │
│  │                   Read Models                    │   │
│  │         （UI用の集計済みビュー）                    │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Actor Types

| Actor | 役割 | 権限 |
|-------|------|------|
| `human` | 職人メンバー | Proposal作成・承認・拒否 |
| `ai` | Sherpa | Proposal作成・承認（Policy許可範囲）・拒否不可 |
| `system` | 自動処理 | 定期ジョブ・トリガー実行・自動承認 |
| `integration` | 外部サービス | Proposal作成のみ（承認不可） |

### integration actor

外部システム起点のイベントを明示的に分離。

```
例:
  - Gmail連携 → 注文書PDF受信 → income.create Proposal（integration actor）
  - 銀行API連携 → 入金検知 → bank.deposit.detected Proposal
  - Webhook受信 → 外部サービスからのトリガー
```

**なぜ分けるか:**

- 「AIの判断」と「外部サービスのトリガー」が明確に分かれる
- 後から見たとき、誰/何が起点だったか一目でわかる

### AIの自己承認禁止（最終ゲート）

```typescript
function canApprove(proposal: Proposal, actor: Actor): boolean {
  // 絶対に抜けない最終ゲート
  if (actor.type === 'ai' && proposal.created_by.type === 'ai') {
    return false;
  }

  // その上にPolicy評価が乗る
  return policyEngine.canApprove(proposal, actor);
}
```

**二段構造:**

1. AI自己承認禁止 → 絶対に抜けない
2. Policy評価 → 金額・期間・ロールベースの判断

---

## 自動承認レンジ（Policy設計）

### なぜ最初から決めるか

3人ギルドで「すべて手動承認」は破綻する。Policyで自動承認ラインを明示。

### デフォルトルール

| Proposal Type | 条件 | 承認方式 | AI承認 |
|---------------|------|----------|--------|
| `expense.create` | ≤ 5,000円 | 自動承認 | - |
| `expense.create` | 5,001〜30,000円 | 1人承認 | 可 |
| `expense.create` | > 30,000円 | 2人承認 | 不可 |
| `income.create` | - | 自動承認 | - |
| `assignment.create` | 人間作成 | 自動承認 | - |
| `assignment.create` | AI提案 | 1人承認 | 不可（自己承認禁止） |
| `assignment.update` | 7日以降の変更 | AI自動承認可 | 可（パズル最適化） |
| `assignment.update` | 直近7日の変更 | 1人承認 | 不可（現場調整必要） |
| `reward.calculate` | - | 全員確認 | 不可 |
| `skill.update` | - | 熟練者承認 | 不可 |
| `policy.update` | - | 全員合意 | 不可 |

### 責務分離

```text
Sherpa: Proposalを組み立てて投げる
Policy: 承認可否を判断する
```

SherpaはPolicy判断に関与しない。組み立てて投げるだけ。

### PolicyEngine の居場所

```text
PolicyEngine は Governance Layer の一部として実装。
呼び出し元は /proposals/:id/approve と /proposals/:id/execute の内部のみ。
```

**禁止事項:**

- フロントから「このProposal承認していい？」を直接判定しない
- Sherpa から PolicyEngine を直接叩かない
- Policy判断は常にサーバ側の最終ゲートとして機能する

---

## Sherpa（AI）の根拠スナップショット

### なぜ必要か

「なんでこのときOKした？」を後から説明できるようにする。

### 構造

```typescript
interface ProposalContext {
  // 判断時点のスナップショット
  snapshot: {
    // 関連データ
    similar_cases: ProposalRef[];        // 類似の過去ケース
    recent_trend?: TrendData;            // 日別・月別推移

    // 適用ルール
    policy_version: string;
    matched_rule: PolicyRule;

    // AI判断
    ai_reasoning?: string;               // 人間が読める説明
    confidence?: number;                 // 0-1
  };

  // メタ情報
  created_at: string;
  actor: ActorRef;
}
```

### 例: 経費承認

```json
{
  "snapshot": {
    "similar_cases": ["prop_abc123", "prop_def456"],
    "recent_trend": {
      "category": "materials",
      "this_month": 45000,
      "last_month": 52000,
      "avg_3months": 48000
    },
    "policy_version": "v3",
    "matched_rule": {
      "id": "expense-auto-approve-small",
      "name": "少額経費の自動承認"
    },
    "ai_reasoning": "金額5,000円以下、材料費カテゴリ、過去の類似ケース2件あり。ポリシーに基づき自動承認。"
  }
}
```

---

## Read Models（名前付きビュー）

UIとサーバ間の会話を具体化するため、先に作るRead Modelを定義。

### TodayPendingApprovalsView

```typescript
// Today画面の「承認待ち」セクション用
interface TodayPendingApprovalsView {
  proposals: {
    id: string;
    type: ProposalType;
    summary: string;           // "経費: ホームセンターで資材購入 ¥32,000"
    created_by: ActorRef;
    created_at: string;
    actor_type: 'human' | 'ai' | 'integration';
    ai_reasoning_short?: string;  // AI提案の場合、短い理由
  }[];
  total_count: number;
}
```

**使用箇所:** Today画面

### CalendarAssignmentsView

```typescript
// Calendar画面のメインデータ
interface CalendarAssignmentsView {
  assignments: {
    id: string;
    date: string;              // YYYY-MM-DD
    site_id: string;
    site_name: string;
    worker_ids: string[];
    worker_names: string[];
    time_blocks?: TimeBlock[];
    status: 'pending' | 'scheduled' | 'confirmed' | 'completed';
    // Read Model用ステータス（Write Modelとの対応）:
    //   pending   = Proposal承認待ち（Write Modelに未反映）
    //   scheduled = Write status: scheduled（確定済み・未着手）
    //   confirmed = Write status: confirmed（当日確認済み）
    //   completed = Write status: completed（完了）
  }[];
  month: string;               // YYYY-MM
}
```

**使用箇所:** Calendar画面

### MoneyDailyLedgerView

```typescript
// Money画面の日別収支
interface MoneyDailyLedgerView {
  days: {
    date: string;
    income: number;
    expense: number;
    balance: number;
    by_category: Record<string, number>;
  }[];
  month_total: {
    income: number;
    expense: number;
    profit: number;
  };
}
```

**使用箇所:** Money画面

### RewardSummaryView

```typescript
// 報酬計算結果サマリー
interface RewardSummaryView {
  site_id: string;
  site_name: string;
  calculated_at: string;
  workers: {
    worker_id: string;
    worker_name: string;
    t_score: number;
    days: number;
    amount: number;
    ratio: number;
  }[];
  total_distributable: number;
}
```

**使用箇所:** Sites詳細、Money画面

### Read Model の更新タイミング

**方針:** Phase A/B では全てオンデマンド集計（リクエスト時にSQLで計算）。

```text
Phase A/B: Read Model = クエリ時に集計するビュー（SELECT + JOIN + GROUP BY）
Phase C以降: パフォーマンスボトルネックが見えたらマテリアライズドビューへ移行検討
```

**なぜこうするか:**

- GENBA QUESTの規模（3人ギルド × 数現場）なら素直なSQLで十分
- 最初からKafka/CQRSフル装備は過剰
- 「遅くなった」が見えてから対応でOK

---

## イベント志向データモデル

### 基本構造

```
Proposal(executed)
    │
    ▼
LedgerEvent
    │
    ▼
LedgerTransaction
    │
    ▼
LedgerEntry[] (借方・貸方のペア)
```

### 不変性

- 一度記録されたイベントは変更不可
- 修正は「逆仕訳イベント」で対応
- 監査証跡として完全に保持

### Event IDの決定的生成

```typescript
// 二重発行防止
const event_id = hash(`${proposal_id}:${proposal_version}`);
```

---

## UIとの接続

### 原則

ユーザーは「Proposal」という概念を直接意識しない。
勝手にProposal経由になるUIにする。

> **インタラクション原則（UI_ARCHITECTURE.md参照）:**
> 頻繁×単純な操作 → Direct Manipulation（画面上の直接操作）
> 低頻度×複雑な操作 → Conversational UI（Sherpa）
> 迷ったら「操作対象が画面に見えているか？」で判断

### 具体例

| 操作 | UI | 裏側 |
|------|----|----|
| 経費登録 | モーダルで保存 | `expense.create` Proposal作成 |
| 低額経費 | 即反映 | 自動承認→executed |
| 高額経費 | 「承認待ち」表示 | Todayの承認カードに出現 |
| アサイン変更（既存の日時移動） | Calendarでドラッグ | `assignment.update` Proposal |
| アサイン新規登録 | Sherpa経由（「田中さん15日A現場」） | `assignment.create` Proposal |
| 報酬計算 | 「計算」ボタン | `reward.calculate` Proposal（全員確認待ち） |

### Today画面の「承認待ち」

```
┌─────────────────────────────────────────────┐
│  承認待ち (3件)                              │
├─────────────────────────────────────────────┤
│  🟡 経費: ホームセンターで資材購入 ¥32,000   │
│     田中  1時間前  [承認] [却下]             │
├─────────────────────────────────────────────┤
│  🤖 アサイン: 来週月曜 山田→A現場           │
│     Sherpa  30分前  [承認] [却下]            │
├─────────────────────────────────────────────┤
│  📧 売上: 注文書受信 〇〇ビル ¥500,000       │
│     Gmail連携  2時間前  [確認] [修正]        │
└─────────────────────────────────────────────┘
```

---

## Reward / Tスコアとの統合

### Proposalへの寄せ方

| 操作 | Proposal Type | payload例 |
|------|---------------|-----------|
| スキル達成 | `skill.achieve` | `{ worker_id, skill_item_id, evidence }` |
| 評価確定 | `evaluation.finalize` | `{ worker_id, self/peer/master scores }` |
| 報酬計算 | `reward.calculate` | `{ site_id, period, t_score_snapshot_id, boost_p }` |

### Tスコアスナップショット

```typescript
interface TScoreSnapshot {
  id: string;
  worker_id: string;
  score: number;
  details: SkillAchievement[];
  captured_at: string;
}

// 報酬計算時に「どのバージョンのTスコアで計算したか」を記録
interface RewardCalculation {
  t_score_snapshot_id: string;  // ← これで完全トレース可能
}
```

---

## 詳細設計ドキュメント

| ドキュメント | 内容 | 状態 |
|-------------|------|------|
| [PROPOSAL_SYSTEM.md](./PROPOSAL_SYSTEM.md) | Proposal中心の変更管理 | 完了 |
| [LEDGER_SYSTEM.md](./LEDGER_SYSTEM.md) | ダブルエントリー会計 | 完了 |
| [REWARD_SYSTEM.md](./REWARD_SYSTEM.md) | Tスコア報酬分配 | 完了 |
| [POLICY_SYSTEM.md](./POLICY_SYSTEM.md) | 憲法（ルール）管理 | 完了 |
| [SHERPA_ARCHITECTURE.md](./SHERPA_ARCHITECTURE.md) | AI Orchestrator設計 | 完了 |
| [UI_ARCHITECTURE.md](./UI_ARCHITECTURE.md) | UI/ページ構成 | 完了 |

---

## 実装フェーズ

### Phase A-0: 超MVP（現行動作 + ログ化）

**目的:** 既存UIの挙動を崩さずにProposalモデルを先に生やす

**スコープ:**

1. `proposals` テーブル導入
2. 対象を限定:
   - `expense.create`
   - `assignment.create`
3. 承認は全部「即承認（system）」
4. **現行動作は変えない、ログだけProposal化**

**A-0特有の暫定ルール:**

| ルール | 内容 |
|--------|------|
| status | 常に `approved` + `executed`（中間状態なし） |
| Policy評価 | スキップ（固定ルールで即時承認） |
| UI | Proposalの概念は一切出さない |
| 承認待ち | Todayに「承認待ち」セクションはまだ出さない |
| Actor | すべて `system` actor（人間/AIの区別はまだしない） |

> **重要:** Phase A-0 は検証環境限定（本番投入不可）。
> 本番運用は最低でも A-1 以降とし、以下を有効化する。
> 1. Policy評価をスキップしない（サーバ最終ゲートで常時評価）
> 2. `human` / `ai` / `integration` / `system` を正規に記録
> 3. `pending` を含む承認フローを運用し、承認待ちをUI表示する

**成果物:**

- すべての経費/アサイン操作に対してProposalが1行残る
- Proposalログが溜まり、Sherpaの学習土台になる
- 既存UIは一切変わらない

**終了条件:**

- 1ヶ月程度Proposalログを蓄積
- ログを見て「傾向分析ができそう」と判断できたらA-1へ

**A-0 完了チェックリスト:**

- [ ] `expense.create` / `assignment.create` のProposalが1ヶ月で50件以上
- [ ] Proposalの `payload` 設計に大きな後悔がない
- [ ] 「この条件なら自動承認でいいよね」が3パターン以上見えた
- [ ] Read Model のクエリが実用的な速度で動いている

### Phase A-1: 基盤（本来のPhase A）

1. Policy評価エンジン（単純なif文でOK）
2. 高額経費だけ「承認待ち」化
3. Ledgerイベント構造
4. 一部アサイン変更を承認待ち化
5. Todayに「承認待ち」セクション追加

### 本番移行ゲート（Go/No-Go）

本番リリース判定は次をすべて満たすこと。

- [ ] A-0モード（Policyスキップ、全system actor）を無効化済み
- [ ] 承認API/実行APIが `pending` / `approved` 遷移を強制
- [ ] 監視項目（不変条件 + 可用性）にアラート連携済み
- [ ] バックアップ/復旧手順をRunbook化し、演習を1回以上実施

### Phase B: AI統合

1. Sherpa Orchestrator
2. Sub Agents（Accounting, Reward, Assignment）
3. skill.md によるAI行動範囲定義
4. 根拠スナップショット記録

### Phase C: UI刷新

1. Today / Calendar / Sites / Money の再構築
2. Proposal一覧・承認UI
3. FAB Sherpa

### Phase D: 高度化

1. AIによる自動承認の範囲拡大
2. Policy Editor（ルール変更UI）
3. 監査ダッシュボード
4. 複数組織対応
5. integration actor本格運用（Gmail/銀行連携）

---

## ゴール状態

完成形のイメージ:

- **組織として**「数字が汚れない」
- **チームとして**「UIが複雑にならない」
- **AIが常駐して**:
  - 判断理由を説明し
  - 人間の判断負荷を減らし
  - でも勝手に支配はしない

> 「3人ギルド向けのオンチェーンごっこオフチェーン帳簿OS」

---

## 実装で先に決めておく論点

### 2-1. Policy / PolicyVersion の扱い

**方針:** Policy全体をバージョン管理し、Proposal評価時点のスナップショットを記録。

```typescript
interface Proposal {
  // ... 他のフィールド

  // 評価時点のPolicy情報（必須）
  evaluated_policy_version: string;   // 'v3'
  matched_rule_id: string;            // 'expense-auto-approve-small'
}
```

**なぜ重要か:**

- 「この時期はポリシー v2 だったから、この承認は当時としては正しい」という説明が可能
- 監査時に「なぜこの判断だったか」をPolicy変遷込みで追跡
- DAOの透明性 = 判断根拠の完全記録

### 2-2. 承認の並行実行（コンカレンシ）

**問題:** 複数人が同時に「承認」ボタンを押す可能性。

**解決策:** 楽観ロックで状態遷移を1回だけ成功させる。

```sql
UPDATE proposals
SET status = 'approved', approved_at = now(), approved_by = :actor_id
WHERE id = :id AND status = 'pending';
-- rowCount == 0 なら「もう誰かがapproved/rejected済み」
```

### 2-2-1. Proposalステータス遷移図（正式版）

```text
                    ┌──────────────────────────────────┐
                    │                                  │
                    ▼                                  │
  ┌───────┐    ┌─────────┐    ┌──────────┐    ┌──────────┐
  │ draft │───▶│ pending │───▶│ approved │───▶│ executed │
  └───────┘    └─────────┘    └──────────┘    └──────────┘
                    │
                    ▼
              ┌──────────┐
              │ rejected │
              └──────────┘
```

**ステータス定義:**

| Status | 説明 | 次の遷移 |
|--------|------|----------|
| `draft` | 下書き（UI側で使う場合のみ） | pending |
| `pending` | 承認待ち | approved, rejected |
| `approved` | 承認済み（実行待ち） | executed |
| `executed` | 実行完了（終端） | - |
| `rejected` | 却下（終端） | - |

**フェーズ別の使用状態:**

| Phase | 使用するステータス | 備考 |
|-------|-------------------|------|
| A-0 | pending → approved → executed（即時） | 中間状態なし |
| A-1〜 | 全ステータス使用 | pending で承認待ちUIに表示 |

### 2-2-2. execute の並行実行（コンカレンシ）

**問題:** ワーカー再実行や多重リクエストで `execute` が重複実行される可能性。

**解決策:** `approved` かつ `executed_at IS NULL` の1行更新のみ成功させる。

```sql
UPDATE proposals
SET status = 'executed',
    executed_at = now(),
    result_event_id = :event_id
WHERE id = :id
  AND status = 'approved'
  AND executed_at IS NULL;
-- rowCount == 0 なら「実行済み」または「状態不正」
```

**必須制約（DB）:**

```sql
CREATE UNIQUE INDEX uq_ledger_events_proposal_version
ON ledger_events (proposal_id, proposal_version);
```

### 2-3. integration の at-least-once 問題

**問題:** Gmail / 銀行 / webhookは「同じイベントが2回届く」世界。

**解決策:** 外部IDを一意制約で受け止め、`INSERT ... ON CONFLICT` で冪等化する。

```sql
CREATE UNIQUE INDEX uq_integration_source_external_id
ON integration_events (source, external_id);
```

```typescript
const inserted = await db.execute(sql`
  INSERT INTO integration_events (source, external_id, received_at)
  VALUES (${source}, ${externalId}, now())
  ON CONFLICT (source, external_id) DO NOTHING
  RETURNING id
`);

if (inserted.rowCount === 0) {
  return { status: 'already_processed' };
}

// 初回受信時のみProposalを作成
const proposalId = hash(`integration:${source}:${externalId}`);
```

**なぜこうするか:**

- 同時受信でもDBが重複を物理的に拒否する
- アプリ側の `findFirst` 競合を回避できる
- event_id = hash(proposal_id:version) の思想と整合

### 2-4. Event payload のスキーマ進化

**問題:** Eventは不変だが、将来「フィールド足したい」が必ず出る。

**解決策:** JSON payload + version パターン。

```typescript
interface LedgerEvent {
  id: string;
  org_id: string;
  proposal_id: string;

  // スキーマ進化対応
  type: string;           // 'expense-booked'
  schema_version: number; // 1, 2, 3...
  payload: unknown;       // JSON

  occurred_at: string;
  recorded_at: string;
  actor: ActorRef;
}

// パース時
function parsePayload(event: LedgerEvent): ExpensePayload {
  switch (event.schema_version) {
    case 1:
      return migrateV1toV2(event.payload as ExpensePayloadV1);
    case 2:
      return event.payload as ExpensePayloadV2;
    default:
      throw new Error(`Unknown schema version: ${event.schema_version}`);
  }
}
```

**運用方針:**

- 新フィールド追加時は `schema_version` をインクリメント
- 古いイベントは読み取り時にマイグレーション（遅延変換）
- バッチジョブでの一括アップグレードも可能（optional）

---

## 近未来前提の制約（再掲）

1. **AIの操作はすべてログ・説明付き**
2. **1リクエスト = 1アクション原則**
3. **Idempotent API**
4. **後から人間が必ず検証できる構造**
5. **AIの自己承認禁止**（最終ゲートとして実装）
6. **トランザクション境界の厳守**（承認+Event+状態更新は1tx）
7. **Policy評価時点のバージョンを必ず記録**
8. **外部イベントは決定的ID生成でat-least-once対応**
9. **Event payloadはschema_version付きJSONで進化対応**

---

## 監視・アラートの原則

「数字が汚れない」を保証するため、以下の不変条件を常時監視する。

### 必須監視項目

| 対象 | 条件 | アラートレベル |
|------|------|---------------|
| proposals | `status = 'approved' AND executed_at IS NULL` が1時間以上 | Warning |
| proposals | `status = 'pending'` が24時間以上放置 | Info（通知のみ） |
| ledger_entries | `SUM(debit) != SUM(credit)`（任意の transaction_id で） | Critical（即時） |
| Read Model | `MoneyDailyLedgerView.month_total` と PL計算結果が不一致 | Critical |

### 実装方針

```sql
-- バランスチェック（定期実行 or トリガー）
SELECT transaction_id, SUM(debit) - SUM(credit) AS imbalance
FROM ledger_entries
GROUP BY transaction_id
HAVING SUM(debit) != SUM(credit);
-- 結果が1件でもあればバグ確定 → 即アラート
```

**なぜ重要か:**

- 「こうなってたらバグ確定」な条件をアーキテクチャ側で握っておく
- テストコードでも監視でも両方で守る
- 「数字が汚れない」の実証可能性

---

## 可用性・復旧（本番運用基準）

### SLO/SLA（最小）

| 項目 | 目標値 |
|------|--------|
| API可用性（/api/v1/*） | 月間 99.9%以上 |
| Proposal承認API p95 | 500ms以下 |
| Proposal実行完了遅延 p95 | 30秒以下 |

### RTO/RPO（障害時目標）

| 指標 | 目標 |
|------|------|
| RTO | 4時間以内 |
| RPO | 15分以内（PITR前提） |

### バックアップ・復旧方針

- PostgreSQL: PITR有効、日次フルバックアップ、保持30日
- 復旧演習: 四半期ごとに1回（最新Runbookを使用）
- 復旧判定: `ledger_entries` バランスチェックと件数整合を実施

### Runbook必須項目

- `approved` だが `executed_at IS NULL` が閾値超過した場合の手順
- 外部integration重複受信時の切り分け手順
- Policy誤設定で承認が停止した場合のロールバック手順
- Read Model不整合時の再計算・再構築手順
