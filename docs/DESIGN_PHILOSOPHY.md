# GENBA QUEST - DAO×AI アーキテクチャ設計書

> **TL;DR（50行で全体像）** - 詳細は各セクションを参照
>
> **3本柱:**
> 1. Proposal中心 - 全状態変更は `draft→pending→approved→executed` のProposal経由
> 2. Event志向Ledger - 追記のみ、逆仕訳で修正、借方=貸方
> 3. AIはPolicyに従属 - AI自己承認禁止（絶対ゲート）
>
> **Current production note:** 2026-04-17 時点の現DB canonical execution model は [docs/adr/2026-04-17-current-db-canonical-execution-model.md](./adr/2026-04-17-current-db-canonical-execution-model.md) を参照。本文は ideal target を主に記述する。
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
| Input-zero / Decision-human | 2 | 1 | 0.67 | 不足 | UX原則として採用、dogfooding待ち |
| Cursor Tab的提案体験 | 2 | 1 | 0.67 | 不足 | Inline Suggestion 未実装 |
| Sherpa Chatは最終手段（常駐させない） | 2 | 1 | 0.67 | 不足 | 現実装と方向性を要確認（要決定事項） |
| 育つフォーム | 2 | 1 | 0.67 | 不足 | ExpenseModal等で部分実装 |
| MonthClose 不可侵性 | 3 | 1 | 0.75 | 中程度 | `month_closes` テーブル + PATH governance で実装 |
| PATH governance（多Proposal集約決定） | 3 | 1 | 0.75 | 中程度 | V3.1/V3.2 で運用中 |
| 請求漏れゼロ（MVP outcome） | 2 | 1 | 0.67 | 不足 | Invoice flow 実装中、未計測 |
| 黒字可視化（MVP outcome） | 2 | 1 | 0.67 | 不足 | Money画面で部分実装、未計測 |

> **更新ルール**: 人間が主観で α/β を変更してはならない。
> 観測は `principle_observations` テーブルに自動記録される。
> API: `GET /api/v1/principles` で最新の確信度を取得可能。

---

## 思想（Why）

職人チーム（ギルド）を単位とした現場運営・会計・報酬分配を、
**DAO的な透明性** と **AIによる最小限の人的介入** で成立させる。

> 「近未来に自然に存在しているはずの仕事用OS」

### MVPアウトカム（ユーザー側から見たゴール）

抽象的な「透明性」を職人ユーザー視点に翻訳すると、MVPで達成したいのは2つだけ：

1. **請求漏れゼロ** — やった仕事が必ず請求につながる。完了現場と未請求残が乖離しない
2. **黒字可視化** — 現場ごとに利益が見える。月単位で黒字/赤字が即座に分かる

その他の機能（Sherpa、PATH governance、報酬分配、Communication 等）はすべて、この2つを支える / 拡張するためのもの。
**MVPで判断に迷ったら「請求漏れゼロ / 黒字可視化に効くか」で切る。**

### 人間とAIの役割観

職人も事務もオーナーも、本当はちゃんと考えている。
「この経費はあの現場のやつだ」「先月もこの駐車場使った」「これは立替だ」と頭では分かっている。

ただ、**入力する暇がない / 月末まで覚えていられない / 過去を遡って参照できない**、だけ。

→ 人間に足りないのは「思考」ではなく「処理帯域・記憶・参照速度」。
→ AIはそこを補完する装置であって、判断を代行する装置ではない。

GENBA QUESTのAIは、ユーザーが既にやっている思考に追いつくための処理帯域である。
判断の主体は常に人間（とProposal）で、AIはその思考が形になる速度を上げる。

---

## UX原則（人間中心の設計）

UI design 側の正本は `design-system/genba-quest/MASTER.md`（Calm Cockpit / Work OS）。
本セクションは Calm Cockpit の5原則を philosophy 側で再宣言し、AI/Suggestion の挙動原則と統合する。

### Calm Cockpit 5原則（design-system/genba-quest/MASTER.md より）

1. **Calm density** — 有用な情報は常に見える、副次UIは静かに
2. **Decision-first** — 次の判断/答えから出す。機能訴求から始めない
3. **Expressive only for decisions** — 強い色/形/モーションは承認・警告・締め・報酬確定にだけ使う
4. **Direct + Sherpa split** — 頻繁で単純な操作は Direct UI / 複雑な多段操作は Sherpa
5. **Transparent automation** — Sherpa/AI出力は提案内容・根拠・影響・承認/再試行パスを必ず示す

### 1. Input-zero / Decision-human（Calm Cockpit #2 の言い換え）

**判断は奪わない。入力と確認を奪う。**

- **判断** = 何をするか、誰がやるか、いくらか → 人間 + Proposal が決める
- **入力** = タイピング、コピペ、画面遷移、思い出し → AIが消す
- **確認** = 整合性、過去比較、根拠提示 → AIが先回りして提示する

人間に足りないのは「思考」ではなく「処理帯域・記憶・参照速度」。
AIは帯域を渡す装置であって、判断を代行する装置ではない。

「人間が考えていないことはAIもやらない」「考えているけど追いつかない部分だけAIが代行する」。

### 2. Cursor Tab的な提案体験

AIの提案は、Cursor の Tab補完が守っている4性質に従う：

1. **無視できる** — 受け入れないときの認知負荷がゼロ
2. **即時** — 思考のリズムを邪魔しない
3. **狭い** — 一度に一つの提案
4. **直近文脈駆動** — いま画面に出ている文脈から予測する

これを破る提案は撤退の対象。

### 3. Suggestion 4分類 + Sherpa Chat（UI親密度で切る）

AIの介入は親密度で5レベルに分ける。混ぜない。

| 種類 | 親密度 | 例 | 受け入れ操作 | 失敗コスト |
|------|--------|------|-------------|-----------|
| **Inline Suggestion** (Tab補完) | 最強 | 経費入力中の勘定科目候補 | Tap / Tab | 無視で消える |
| **Next Action Card** (次の一手) | 中 | 「未締め現場が3件」 | カードをタップ | 邪魔だが致命的でない |
| **Why Tooltip** (説明) | 弱 | 報酬額の根拠 | 任意で開く | 出さないと気付かれない |
| **Guard** (警告/停止) | 強制 | closed month変更の阻止 | 必ず通る | 出し損ねが致命的 |
| **Sherpa Chat** (多段対話) | 呼出時のみ | 「先月の駐車場代を全部立替に振替」 | FABから明示起動 | チャット履歴に残る |

**Sherpa Chat の役割（Calm Cockpit #4 と整合）:**

- **Direct UI で完結する単純操作には介入しない**（経費1件登録、ドラッグでアサイン変更等）
- **複雑な多段操作 / 自然言語のほうが速い操作は Sherpa が担う**（「田中さん来週月曜A現場」、「先月の電気代カテゴリ修正」等）
- 常駐するが、ユーザーから明示的に呼ばれるまで会話を始めない
- 出力には必ず Proposal 内容・根拠・影響・承認/再試行パスを含める（Calm Cockpit #5）

### 4. 育つフォーム

最初から全フィールドを表示しない。文脈に応じて展開する。

- 最初に出すのは1〜2フィールド（経費なら写真+金額だけで成立）
- AIが埋めた箇所は視覚的に区別（薄いハイライト、確定でプレーンに変わる）
- 未確定でも保存可能。後から誰かが補完できる前提
- 必須マークは入力途中で押し付けない

整合性チェック（借方=貸方など）は入力UIではなく、**Proposal validation 側で合流**させる。
入力UIは緩く、Proposal確定時に厳格に。これで DAO原則とも揃う。

### 5. AIの境界線

| カテゴリ | AI単独 | AI起案 + 人承認 | 人専用 |
|---------|--------|----------------|--------|
| 候補提示・OCR・Why説明 | ✅ | — | — |
| 未入力検知・整合性警告 | ✅ | — | — |
| Draft Proposal生成 | — | ✅ | — |
| 立替→経費振替 | — | ✅ | — |
| 報酬run draft計算 | — | ✅ | — |
| 報酬run確定 | ❌ | ❌ | ✅ |
| closed month変更 | ❌ | ❌ | ✅ |
| posted journal直接更新 | ❌ | ❌ | ❌（誰もできない） |
| AI起案Proposalの承認 | ❌ | ❌ | ✅（起案者と別人） |
| PATH governance event 発行 | ❌ | ❌ | ✅（複数Proposal集約後の自動trigger可） |

「AI自己承認禁止」と整合する。詳細は後段の Actor Types / 自動承認レンジ を参照。

### 6. アナログ性のガードレール（Calm Cockpit #1 + #3 の運用面）

「見れば分かる、押せば終わる」を守るため：

- AIが何をしたかを常に表示。ワンタップで消せる（Calm Cockpit #5: Transparent automation）
- AI遅延でクリティカルパスを止めない（候補なしでも入力は通る）
- Inline Suggestionは受け入れるまで何も起きない（誤爆ゼロ）
- Undoは1ステップ
- オフライン/低速時の縮退（OCRは後回し、入力は通る）
- 強い色/形/モーションは承認・警告・締め・報酬確定にだけ（Calm Cockpit #3: Expressive only for decisions）

→ **AIは強化機能であって、クリティカルパスではない。**

---

## 核心原則（3本柱）

### 1. Proposal中心の一元管理

すべての状態変更はProposal経由。直接書き換えは存在しない。

> Current production note: 現DBでは human / AI initiated change の primary entry は `proposals` だが、internal / system / integration flow は direct `ledger_events` を許容している。現行の正系は [ADR: Freeze Current DB Canonical Execution Model](./adr/2026-04-17-current-db-canonical-execution-model.md) を参照。

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

Eventは `proposal_id`, `event_type`, `payload(JSON)`, `occurred_at` を持つ追記レコード。
ドメイン別ビュー（expenses, assignments, ...）は `event_type` でフィルタした射影として定義する。
具体スキーマは [PROPOSAL_SYSTEM.md](./PROPOSAL_SYSTEM.md) / [LEDGER_SYSTEM.md](./LEDGER_SYSTEM.md) を参照。

### Policy DSL：Single Source of Truth

**問題:** PolicyルールがTypeScriptのif文に散らばると、コード・DB制約・テスト・ドキュメントが乖離する。

**解決の方向:** Policyルールを宣言的な単一の真実源（YAML/DSL等）で管理し、そこから判定関数・DB制約・テスト・ドキュメントを派生させる。

書き方の具体（YAML/JSON/独自DSL）はフェーズに応じて選ぶ。重要なのは「ルールを書く場所が1つ」であること。具体は [POLICY_SYSTEM.md](./POLICY_SYSTEM.md) を参照。

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

実装手段は問わない（RPC関数・ORMトランザクション・ストアド等）が、次の不変条件は守る：

- 途中で落ちたら「未承認 / 未実行」にロールバックされる
- 「approvedだけされたけどEventが無い」ゾンビ状態が構造的に存在し得ない
- 実行APIは「実行前」か「実行済」の二択だけ見ればよい状態を保つ

### 冪等性（Idempotency）

Proposal実行は必ず冪等。同じProposalを2回実行しても結果は変わらない。

- 実行済フラグ（`executed_at` 等）で重複実行を弾く
- Event ID は `proposal_id + version` から決定的に生成し、二重発行を物理的に防ぐ

**なぜこうするか:** ワーカー分散時の二重実行防止、リトライ安全性、外部integrationの at-least-once 受信への耐性。

---

## ドメイン構成

```
┌──────────────────────────────────────────────────────────────────┐
│                          GENBA QUEST                             │
├──────────────────────────────────────────────────────────────────┤
│   Policy（憲法）    Proposal（提案）    Sherpa（AI）             │
│        │                  │                  │                   │
│        ▼                  ▼                  ▼                   │
│   ┌──────────────────────────────────────────────────────┐       │
│   │                Governance Layer                       │       │
│   │       （承認・自動承認・自己承認禁止・Policy評価）      │       │
│   └──────────────────────────────────────────────────────┘       │
│                            │                                     │
│   ┌──────────┬─────────────┼─────────────┬────────────┐          │
│   ▼          ▼             ▼             ▼            ▼          │
│ ┌──────┐ ┌────────┐ ┌─────────────┐ ┌──────────┐ ┌──────────┐    │
│ │Ledger│ │Invoice │ │ Assignment  │ │   Site   │ │   PATH   │    │
│ │(会計)│ │(請求)  │ │ (アサイン)  │ │ (現場)   │ │governance│    │
│ └──────┘ └────────┘ └─────────────┘ └──────────┘ └──────────┘    │
│   ┌──────────────┬─────────────────┬───────────────┐             │
│   ▼              ▼                 ▼               ▼             │
│ ┌──────────┐ ┌──────────┐ ┌──────────────────┐ ┌──────────┐      │
│ │  Reward  │ │MonthClose│ │  Communication   │ │   LUQO   │      │
│ │ (報酬)   │ │(締め)    │ │ (顧客接点)       │ │ (報酬DSL)│      │
│ └──────────┘ └──────────┘ └──────────────────┘ └──────────┘      │
│                            │                                     │
│                            ▼                                     │
│   ┌──────────────────────────────────────────────────────┐       │
│   │           Read Models（UI用の名前付きビュー）         │       │
│   └──────────────────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────────┘
```

### ドメインと Proposal Type の対応（現行）

実装に存在する Proposal type を、上のドメインに紐付けて確認できる粒度で列挙する。
詳細スキーマは `server/src/services/ProposalService.ts` を真の正本とする。

| ドメイン | 主な Proposal Type | 主な Event Type |
|---------|-------------------|----------------|
| **Ledger** | `expense.create` / `expense.update` / `expense.void` / `income.create` / `income.update` | `expense_recorded` / `expense_voided` / `income_recorded` |
| **Invoice** | `invoice.create` / `invoice.send` / `invoice.mark_paid` | `invoice_issued` / `invoice_sent` / `payment_received` |
| **Assignment** | `assignment.create` / `assignment.update` / `assignment.cancel` | `assignment.scheduled` / `assignment.rescheduled` / `assignment.cancelled` |
| **Site** | `site.create` / `site.close.finalize` / `site.close.reopen` | `site.created` / `site.close.finalized` / `site.close.reopened` |
| **Reward** | `reward.calculate` / `reward.adjust` / `evaluation.finalize` / `skill.achieve` / `skill.revoke` | `reward_calculated` / `reward_adjusted` / `evaluation_finalized` |
| **PATH governance** | site.close / skill / reward 系 Proposal の上位ガバナンス | `path.site_close.finalized` / `path.skill_certification.decided` / `path.reward_run.approved` / `path.monthly_distribution.finalized` / `path.reward_pool.adjusted` |
| **MonthClose** | `site.close.finalize`（period確定）+ `month_closes` 参照 | site.close.finalized 経由 |
| **Communication** | `communication.review` / `communication.task` | `communication.review_recorded` / `communication.task_recorded` |
| **LUQO** | `luqo.reward.calculate`（reward.calculate と並列の独自報酬DSL） | reward 系 |
| **Policy** | `policy.update` | governance event |

> 新ドメイン追加時は、まず Proposal type を1つ追加して `events` に流す → 必要に応じて Read Model を追加する、の順で育てる。テーブル追加は最終手段。

### PATH governance の位置付け

PATH は「Ledger/Reward/Site の上に立つガバナンス層」。
個別Proposal（site.close.finalize や reward.calculate）が承認されたあと、PATH governance event が発行され、月次分配・スキル認定・reward pool 調整など**多Proposal をまたぐ集約決定**を不変のログとして残す。

これにより「個別の経費承認」「個別の現場締め」「個別の報酬計算」と、「組織として確定した月次分配」が別レイヤーで追跡可能になる。

### MonthClose の不可侵性

`month_closes` で確定した期間に属するLedgerEventは原則不可変。
修正は逆仕訳Eventとして「翌期に」記録する。AI/人を問わず、closed periodの直接更新は禁止（UX原則 §5 の Guard で強制）。

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

承認可否は二段構造で判定する：

1. **AI自己承認禁止ゲート**（絶対に抜けない）
   `actor.type === 'ai' && proposal.created_by.type === 'ai'` のとき承認不可。
2. **Policy評価**（金額・期間・ロールベースの判断）

順序固定。Policy評価で例外を作っても、自己承認ゲートはその上位で常に効く。

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

### 持つべき情報

判断時点のスナップショットを Proposal に紐付けて保存する：

- **関連データ**: 類似の過去ケース、直近トレンド（カテゴリ別の月次推移など）
- **適用ルール**: Policy のバージョンと match した ruleの識別子
- **AI判断**: 人間が読める reasoning 文字列、confidence スコア
- **メタ情報**: 作成時刻、actor

「なぜこのときOKした？」が後から1画面で再構成できる粒度であればよい。
スナップショットの保存先・スキーマは [SHERPA_ARCHITECTURE.md](./SHERPA_ARCHITECTURE.md) を参照。

---

## Read Models（名前付きビュー）

UIとサーバ間の会話を具体化するため、画面ごとにRead Modelを名前付きで定義する。
スキーマは画面要件から逆算して柔軟に育てる。下表は**代表例で網羅ではない**。実装の真の正本は `server/src/services/` 配下のRead Model実装ファイル。

| Read Model | 使用箇所 | 主な内容 |
|-----------|---------|---------|
| `TodayPendingApprovalsView` | Today画面 | 承認待ちProposal一覧、起案者、AI reasoning短縮版 |
| `CalendarAssignmentsView` | Calendar画面 | 日付×現場×ワーカー、status (`pending` / `scheduled` / `confirmed` / `completed`) |
| `MoneyDailyLedgerView` | Money画面 | 日別の収支、カテゴリ別内訳、月次合計 |
| `RewardSummaryView` | Sites詳細, Money画面 | 報酬計算スナップショット、worker別配分・Tスコア |
| `CommunicationContactReadModel` | Communications画面 | 顧客接点の review/task 履歴とステータス |
| PATH 系 (PathRewardAnalysis 等) | PathRewardConfirmation画面 | PATH governance の月次分配・skill認定スナップショット |
| Invoice 系 | Money画面の請求パネル | 発行済/未送付/未入金の請求書一覧、請求漏れ候補 |

**設計原則:**

- Read Modelは Write Model（proposals + events）からの射影。一次データではない
- 必要な画面ができたときに足す。先回りして作りすぎない
- Calendarの `pending` のように、Read Model独自のステータスを定義してUI都合を吸収してよい
- 名前付きビューを増やす方が、proposals/events 本体のスキーマを膨らませるより常に好ましい

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

`event_id = hash(proposal_id + version)` のように決定的に生成し、二重発行を物理的に防ぐ。
ハッシュ関数とフォーマットは実装で選ぶ（衝突ゼロが保証できれば手段は問わない）。

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

報酬計算時の Tスコアは時点スナップショットとして保存し、`reward.calculate` Proposal はそのスナップショットIDを参照する。

→ 後から「この報酬はどのTスコアで計算されたか」が完全にトレース可能。スコア定義が変わっても過去の報酬計算は再現できる。

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

## 実装フェーズ（並行進行中の現実）

線形ロードマップではなく、**達成済み不変条件 / 進行中 / 未着手** の3層で現状を捉える。
Phase A→B→C→D は当初の計画線だったが、実装は実際には複数Phaseが並行で走っている。

### 達成済みの不変条件（Locked-in）

ここに入った項目は、**回帰させない**。コードレビューでもチェック対象。

- [x] `proposals` テーブルが全状態変更の起点になっている
- [x] Policy評価が承認APIの最終ゲートとして稼働
- [x] `human` / `ai` / `integration` / `system` の Actor 区別を記録
- [x] AI自己承認禁止ゲートが実装済み（`canApprove` 二段構造）
- [x] `pending` を含む承認フローが運用されている（Today画面の承認カード）
- [x] LedgerEvent / Transaction / Entry のダブルエントリー構造
- [x] トランザクション境界（承認 + Event + 状態更新 = 1tx）が RPC で実装済み
- [x] Sherpa Chat（FAB起動、Proposal下書き起案）が稼働
- [x] PATH governance V3.1 / V3.2 が site.close.finalize / reward.calculate と接続
- [x] `month_closes` テーブルで closed period が定義されている

### 進行中（In flight）

- 🔄 Inline Suggestion（経費入力での勘定科目候補等）の本実装
- 🔄 育つフォームの全画面適用（ExpenseModal で部分実装済み、他は未）
- 🔄 Calm Cockpit 5原則の全画面遵守（Today / Calendar 中心に進行）
- 🔄 Invoice flow（請求漏れゼロ MVPアウトカムに直結）
- 🔄 Communication ドメインの review/task ループ
- 🔄 PATH governance event の Read Model 整備（PathRewardConfirmation 経由）

### 守りたい次の不変条件（Next gates）

これを「次のPhase完了条件」とする。終わったら Locked-in に昇格。

- [ ] **請求漏れゼロ計測** — 完了現場と未請求残の乖離をダッシュボードで常時可視化
- [ ] **黒字可視化計測** — 現場別利益 / 月次PL が Money画面で1タップ参照可能
- [ ] **closed month の不可侵性** — Guard で UI/API 両側から書き換えを物理的に拒否
- [ ] **AI Suggestionの可逆性** — Inline Suggestion は無視/Undo がワンタップで完結
- [ ] **Sherpa output の透明性**（Calm Cockpit #5）— 全AI出力に Proposal/根拠/影響/承認パスを必須化
- [ ] **本番運用ゲート** — 監視項目アラート連携、Runbook演習1回完了、PITRバックアップ運用

### 未着手の高度化候補

優先度低。現MVPアウトカム（請求漏れゼロ + 黒字可視化）に直結しないものはここ。

- AIによる自動承認の範囲拡大（現在は閾値ベース、文脈ベースへ）
- Policy Editor（ルール変更UI）
- 監査ダッシュボード
- 複数組織横断（現状は org_id 境界で完全分離）
- integration actor 本格運用（Gmail/銀行APIの自動化深掘り）

> Phaseの粒度で会話したいときの旧呼称: A-0=ログ化、A-1=承認フロー、B=AI統合、C=UI刷新、D=高度化。
> 上の不変条件3層はこの旧呼称と1対1対応しない。「どの不変条件を次に獲得するか」で語る方が現実に合う。

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

**方針:** Policy全体をバージョン管理し、Proposalには評価時点の `policy_version` と `matched_rule_id` を必ず記録する。

**なぜ重要か:**

- 「この時期はポリシー v2 だったから、この承認は当時としては正しい」が説明可能
- 監査時にPolicy変遷込みで判断根拠を追跡できる
- DAOの透明性 = 判断根拠の完全記録

### 2-2. 承認の並行実行（コンカレンシ）

**問題:** 複数人が同時に「承認」ボタンを押す可能性。

**解決策:** 楽観ロックで状態遷移を1回だけ成功させる。
`UPDATE proposals SET status='approved' WHERE id=:id AND status='pending'` のように、現状態を WHERE 句で縛り、rowCount==0 を「先に誰かが確定済み」として扱う。

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

**解決策:** 承認時と同じ楽観ロック。`status='approved' AND executed_at IS NULL` の1行更新のみ成功する条件で実行する。

加えて DB側で `(proposal_id, proposal_version)` の一意制約を ledger_events に張り、Event発行の二重化も物理的に拒否する。アプリ側ロジックのバグがあっても帳簿は汚れない。

### 2-3. integration の at-least-once 問題

**問題:** Gmail / 銀行 / webhookは「同じイベントが2回届く」世界。

**解決策:** `(source, external_id)` の一意制約で重複を物理的に拒否し、初回受信時のみProposalを作る。
ProposalIDも `hash(integration:source:external_id)` のように決定的に生成し、event_id 戦略と整合させる。

**なぜこうするか:**

- 同時受信でもDBが重複を構造的に拒否する
- アプリ側の存在チェック競合（findFirst → insert の race）を回避
- 「決定的ID生成」原則とEvent側で揃う

### 2-4. Event payload のスキーマ進化

**問題:** Eventは不変だが、将来「フィールド足したい」が必ず出る。

**解決策:** Eventは `type` + `schema_version` + JSON `payload` の組で持つ。

**運用方針:**

- 新フィールド追加時は `schema_version` をインクリメント
- 古いイベントは読み取り時にマイグレーション（遅延変換）
- 必要に応じてバッチジョブで一括アップグレードも可（optional）

→ Eventの不変性を守ったまま、ドメインモデルだけ進化させられる。

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
