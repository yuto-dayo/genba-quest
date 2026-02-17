# Sherpa（AI）アーキテクチャ設計書

## 概要

Sherpaは組織の **正規アクター** として機能するAIアシスタント。
提案・承認・分析を行うが、直接データを変更する権限は持たない。

---

## 設計原則

### 1. Orchestrator + Sub Agents
- Sherpa本体（Orchestrator）がユーザーと対話
- 専門タスクはSub Agentに委譲

### 2. Proposal経由の変更
- AIは直接DBを書き換えない
- 必ずProposalを作成 → 承認フローを経る

### 3. 説明可能性
- すべての判断に理由を付与
- Policyを参照した根拠を示す

### 4. skill.md による行動範囲定義
- 各Agentの能力と制約を明文化
- テスト可能な仕様として機能

---

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│                         User                            │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                  Sherpa Orchestrator                    │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Context Manager                                  │  │
│  │  - current page / org / team                      │  │
│  │  - conversation history                           │  │
│  │  - user preferences                               │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Intent Router                                    │  │
│  │  - 意図解析 → 適切なAgentを選択                    │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Response Synthesizer                             │  │
│  │  - Agent結果を統合 → ユーザー向け応答生成          │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐
│Accounting │ │  Reward   │ │Assignment │ │   Site    │
│  Agent    │ │  Agent    │ │  Agent    │ │  Agent    │
└───────────┘ └───────────┘ └───────────┘ └───────────┘
       │             │             │             │
       ▼             ▼             ▼             ▼
┌─────────────────────────────────────────────────────────┐
│                    API Layer                            │
│  (Proposal作成 / データ取得 / Policy参照)                 │
└─────────────────────────────────────────────────────────┘
```

---

## Sub Agents

### AccountingAgent

**役割**: 経理・会計に関する質問応答と操作提案

```yaml
# .claude/skills/accounting-agent/SKILL.md

name: AccountingAgent
description: 経理・会計の専門エージェント

capabilities:
  - 取引の検索・集計
  - 経費・売上の登録提案（Proposal作成）
  - 月次PL分析
  - 勘定科目の説明
  - 仕訳の提案

forbidden:
  - 直接的なデータ変更
  - Policy変更の提案
  - 他ドメインへの介入

inputs:
  - query: ユーザーの質問
  - context: 現在のページ、組織情報
  - history: 会話履歴

outputs:
  - response: ユーザー向け応答
  - proposals?: 作成したProposalリスト
  - data?: 取得したデータ

constraints:
  - Policyに従った金額判断
  - 高額経費は人間承認を促す
  - 不明点は確認を求める

examples:
  - input: "今月の経費合計は？"
    output: "今月の経費合計は¥125,000です。内訳は..."

  - input: "ホームセンターで資材を買った、8000円"
    output: "経費を登録しますか？\n金額: ¥8,000\nカテゴリ: 材料費\n[登録する]"
```

### RewardAgent

**役割**: 報酬計算と技術評価に関する操作提案

```yaml
# .claude/skills/reward-agent/SKILL.md

name: RewardAgent
description: 報酬・評価の専門エージェント

capabilities:
  - 報酬シミュレーション
  - Tスコア確認・説明
  - 評価セッションの開始提案
  - 報酬計算の実行提案（Proposal作成）

forbidden:
  - 報酬の直接確定
  - Tスコアの直接変更
  - ブースト指数の勝手な変更

inputs:
  - query: ユーザーの質問
  - site_id?: 対象現場
  - worker_id?: 対象職人

outputs:
  - response: ユーザー向け応答
  - simulation?: シミュレーション結果
  - proposals?: 作成したProposalリスト

constraints:
  - 報酬計算は必ず人間確認を挟む
  - シミュレーションは何度でも可能
  - 確定済み報酬は変更不可

examples:
  - input: "〇〇現場の報酬を計算して"
    output: "報酬シミュレーション結果:\n田中: ¥150,000\n山田: ¥120,000\n...\n[確定する]"

  - input: "私のTスコアは？"
    output: "現在のTスコア: 85/170点\n取得スキル: ...\n次の目標: ..."
```

### AssignmentAgent

**役割**: シフト・アサイン管理とスケジュール最適化

> **Shift（シフト）** = 働ける日（available: boolean）
> **Assignment（アサイン）** = どこに行くか（site_id + date）
> 詳細はUI_ARCHITECTURE.mdのCalendar画面データモデルを参照

```yaml
# .claude/skills/assignment-agent/SKILL.md

name: AssignmentAgent
description: シフト・アサイン・スケジュールの専門エージェント

capabilities:
  # シフト関連
  - シフト（働ける日）の確認
  - シフト登録提案（Proposal作成）
  - シフト一括登録提案（「来月の土日全部休み」など）
  - シフトパターン設定提案
  # アサイン関連
  - 現在のアサイン確認
  - アサイン登録提案（Proposal作成）
  - スケジュール最適化提案
  - 稼働バランス分析

forbidden:
  - 直接的なシフト・アサイン変更
  - 他人のシフトを勝手に設定
  - 現場完了判断

inputs:
  - query: ユーザーの質問
  - date_range?: 対象期間
  - worker_id?: 対象職人
  - site_id?: 対象現場

outputs:
  - response: ユーザー向け応答
  - shifts?: シフトデータ（Shift[]）
  - assignments?: アサインデータ（Assignment[]）
  - proposals?: 作成したProposalリスト
  - suggestions?: 最適化提案

constraints:
  - AI提案は必ず人間承認が必要
  - シフト・稼働バランスを考慮
  - 現場の優先度を考慮

examples:
  - input: "来週のアサインを提案して"
    output: "来週のアサイン提案:\n月: 田中→A現場, 山田→B現場\n...\n[承認する]"

  - input: "今日誰がどこにいる？"
    output: "今日のアサイン:\n田中: A現場\n山田: B現場\n佐藤: 休み"

  - input: "来月の土日全部休みにして"
    output: "シフト登録提案:\n2月の土日（計8日）を休みに設定\n→ 8件の shift.create Proposal に展開\n[まとめて登録する]"
    # 原則: 1操作=1 Proposal（DESIGN_PHILOSOPHY.md参照）
    # 一括依頼は個別Proposalに展開し、UIでまとめて承認表示する

  - input: "田中さん来月どこか空いてる？"
    output: "田中さんの2月空き状況:\n5日(水)、12日(水)、19日(水)が空いています"
```

### SiteAgent

**役割**: 現場の登録・ステータス変更

> UI_ARCHITECTURE.md の Sherpa吸収表で「現場 → 新規登録・ステータス変更」と定義

```yaml
# .claude/skills/site-agent/SKILL.md

name: SiteAgent
description: 現場管理の専門エージェント

capabilities:
  - 現場の新規登録提案（Proposal作成）
  - 現場ステータス変更提案（planning → in_progress → completed）
  - 現場情報の検索・確認

forbidden:
  - 直接的なデータ変更
  - 報酬・会計データへの介入

inputs:
  - query: ユーザーの質問
  - site_id?: 対象現場

outputs:
  - response: ユーザー向け応答
  - proposals?: 作成したProposalリスト

constraints:
  - ステータス変更は人間確認を挟む
  - 不明点は確認を求める

examples:
  - input: "新しい現場登録して、渋谷のビル改修"
    output: "現場を登録しますか？\n名前: 渋谷ビル改修\n住所: 渋谷区...\n[登録する]"

  - input: "A現場完了にして"
    output: "A現場（渋谷ビル改修）を完了にしますか？\n[完了にする]"
```

### GovernanceAgent

**役割**: 承認フローとPolicy管理

```yaml
# .claude/skills/governance-agent/SKILL.md

name: GovernanceAgent
description: 承認・ルールの専門エージェント

capabilities:
  - 承認待ちProposalの確認
  - Proposalの承認（Policy許可範囲内）
  - Policy内容の説明
  - 監査ログの検索

forbidden:
  - Policy変更の直接実行
  - 権限外の承認
  - 監査ログの改ざん

inputs:
  - query: ユーザーの質問
  - proposal_id?: 対象Proposal

outputs:
  - response: ユーザー向け応答
  - proposals?: 承認待ちリスト
  - policy_explanation?: ルール説明

constraints:
  - 高額・Policy変更は人間承認必須
  - 承認理由を必ず記録
  - 自分が作ったProposalは承認不可

examples:
  - input: "承認待ちある？"
    output: "承認待ち3件:\n1. 経費 ¥8,000 (田中)\n2. アサイン提案 (Sherpa)\n..."

  - input: "経費の承認ルールは？"
    output: "経費承認ルール:\n・¥5,000以下 → 自動承認\n・¥30,000超 → 2人必要"
```

---

## Orchestrator

### Intent Router

```typescript
class IntentRouter {
  async route(input: string, context: Context): Promise<Agent> {
    const intents = await this.classifyIntent(input);

    // 最も確信度の高い意図を選択
    const primary = intents[0];
    const secondary = intents[1];

    // フェイルセーフ:
    // 低確信度 or 競合時は即実行せず、確認質問にフォールバック
    if (!primary || primary.confidence < 0.60) {
      return this.agents.general.withMode('clarify');
    }
    if (secondary && (primary.confidence - secondary.confidence) < 0.15) {
      return this.agents.general.withMode('clarify');
    }

    switch (primary.category) {
      case 'accounting':
        return this.agents.accounting;
      case 'reward':
        return this.agents.reward;
      case 'assignment':
        return this.agents.assignment;
      case 'site':
        return this.agents.site;
      case 'governance':
        return this.agents.governance;
      case 'general':
      default:
        return this.agents.general;
    }
  }

  private async classifyIntent(input: string): Promise<Intent[]> {
    // AIによる意図分類
    // キーワードマッチング + LLM分類の組み合わせ
  }
}

interface Intent {
  category: string;
  confidence: number;
  keywords: string[];
}
```

### Intent誤分類のフェイルセーフ

- `confidence < 0.60` は自動実行しない
- 上位2意図の差分が `0.15` 未満なら確認質問を挟む
- 確認中は Proposal作成を禁止し、読み取り操作のみ許可する

**確認質問の例:**

```text
「現場登録」と「アサイン変更」のどちらを行いますか？
```

### Context Manager

```typescript
class ContextManager {
  private context: Context;

  constructor() {
    this.context = {
      page: null,
      org: null,
      team: null,
      user: null,
      conversation: [],
    };
  }

  updateFromPage(page: string, params: Record<string, string>) {
    this.context.page = page;
    // 4画面 + Sherpa構成に対応（UI_ARCHITECTURE.md参照）
    // ページに応じたコンテキスト設定
    switch (page) {
      case '/today':
        this.context.domain = 'general';  // 概要画面、特定ドメインなし
        break;
      case '/calendar':
        this.context.domain = 'assignment';  // シフト・アサイン管理
        break;
      case '/sites':
        this.context.domain = 'site';  // 現場管理
        break;
      case '/money':
        this.context.domain = 'accounting';  // 経理・会計
        break;
      default:
        this.context.domain = 'general';
    }
  }

  addMessage(role: 'user' | 'assistant', content: string) {
    this.context.conversation.push({
      role,
      content,
      timestamp: new Date(),
    });
    // 直近20メッセージを保持
    if (this.context.conversation.length > 20) {
      this.context.conversation.shift();
    }
  }

  getForAgent(): AgentContext {
    return {
      org_id: this.context.org.id,
      user_id: this.context.user.id,
      current_page: this.context.page,
      recent_messages: this.context.conversation.slice(-5),
      domain_hint: this.context.domain,
    };
  }
}
```

---

## Proposal作成フロー

> **原則:** SherpaはPolicy判断に関与しない。組み立てて投げるだけ。
> PolicyEngine評価はサーバ側（`/proposals/:id/approve`, `/proposals/:id/execute`）の内部ゲート。
> → DESIGN_PHILOSOPHY.md「責務分離」参照

```typescript
class Agent {
  async createProposal(type: ProposalType, payload: any): Promise<Proposal> {
    // Proposalを作成してAPIに投げる
    // Policy評価・自動承認判定はサーバ側で実行される
    const proposal = await this.api.createProposal({
      type,
      payload,
      created_by: {
        type: 'ai',
        id: 'sherpa',
        name: 'Sherpa',
      },
      description: this.generateDescription(type, payload),
    });

    // サーバ側で Policy評価 → auto_approve条件を満たせば自動承認される
    // Agent側は結果を受け取るだけ
    return proposal;
  }
}
```

---

## AI承認ロジック

> **原則:** GovernanceAgentもPolicyEngineを直接叩かない。
> 承認APIを叩く → サーバ側でPolicy評価 → 結果を受け取る。

```typescript
class GovernanceAgent {
  async reviewProposal(proposalId: string): Promise<AIReviewResult> {
    const proposal = await this.api.getProposal(proposalId);

    // 類似ケースを検索して判断材料にする
    const similarCases = await this.findSimilarCases(proposal);
    const reasoning = await this.generateReasoning(proposal, similarCases);

    // 承認はAPI経由で実行
    // PolicyEngine評価はサーバ側 /proposals/:id/approve 内部で実行される
    const result = await this.api.approveProposal(proposalId, {
      actor: { type: 'ai', id: 'sherpa', name: 'Sherpa' },
      reason: reasoning,
    });

    // サーバ側でPolicy違反（AI承認不可等）の場合はエラーが返る
    if (result.error === 'policy_denied') {
      return {
        decision: 'escalate',
        reason: result.message,
        policy_ref: result.policy_ref,
      };
    }

    return {
      decision: 'approve',
      reasoning,
      similar_cases: similarCases.map(c => c.id),
    };
  }
}
```

---

## FAB UI設計

```
┌─────────────────────────────────────────────┐
│                                             │
│                  [Page Content]             │
│                                             │
│                                             │
│                                             │
│                                             │
│                                   ┌───┐     │
│                                   │ 🤖│     │  ← FAB
│                                   └───┘     │
└─────────────────────────────────────────────┘

↓ タップ

┌─────────────────────────────────────────────┐
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │  🤖 Sherpa                       [×]  │  │
│  ├───────────────────────────────────────┤  │
│  │                                       │  │
│  │  👤 今日誰がどこにいる？              │  │
│  │                                       │  │
│  │  🤖 今日のアサイン:                   │  │
│  │     田中: A現場（〇〇ビル）           │  │
│  │     山田: B現場（△△マンション）      │  │
│  │     佐藤: 休み                        │  │
│  │                                       │  │
│  ├───────────────────────────────────────┤  │
│  │  ┌─────────────────────────────┐      │  │
│  │  │ 質問を入力...              │ [→] │  │
│  │  └─────────────────────────────┘      │  │
│  └───────────────────────────────────────┘  │
│                                             │
└─────────────────────────────────────────────┘
```

---

## ログと監査

### 会話ログ

```typescript
interface ConversationLog {
  id: string;
  org_id: string;
  user_id: string;
  started_at: string;
  messages: {
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
    agent_used?: string;
    proposals_created?: string[];
  }[];
}
```

### ログ保持・秘匿ポリシー（本番）

| 項目 | 方針 |
|------|------|
| 会話本文 (`messages.content`) | 保存前にPIIマスキング（電話/メール/口座/住所） |
| 保存期間（ホット） | 90日 |
| 保存期間（コールド） | 1年（監査用途、検索制限あり） |
| 暗号化 | 転送時TLS + 保存時暗号化（KMS管理鍵） |
| 参照権限 | `admin` / `auditor` のみ全文閲覧可 |
| 削除 | 期間満了で自動削除。手動削除は監査ログ必須 |

### 判断ログ

```typescript
interface AIDecisionLog {
  id: string;
  agent: string;
  action: string;
  input_summary: string;
  output_summary: string;
  policy_refs: string[];
  confidence: number;
  timestamp: string;
}
```

---

## 次のステップ

- [ ] Orchestrator基本実装
- [ ] AccountingAgent実装
- [ ] RewardAgent実装
- [ ] AssignmentAgent実装
- [ ] GovernanceAgent実装
- [ ] FAB UI実装
- [ ] 会話ログ保存
