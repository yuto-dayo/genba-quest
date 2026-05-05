# GENBA QUEST - UI設計書

## UI設計思想：10秒で分かる

> 中身は超DAO/イベントソーシング、UIは「日報＋LINE＋家計簿」くらいの軽さ
> 見た目は **Calm Cockpit**。派手さではなく、今日の判断速度・信頼・承認のしやすさを最優先する。

**原則:**

- 人間が能動的に開くのは **4画面だけ**
- 複雑な操作は **Sherpaが吸収**
- 機能を並べるのではなく、**「今日何する？」「来月の空き？」に即答できる**
- 画面は「機能紹介」ではなく、**次に判断すべきこと** を最初に出す
- 色・動き・形の強調は、承認・警告・締め・報酬確定などの判断点に限定する

### 関連設計書

- **[DESIGN_PHILOSOPHY.md](./DESIGN_PHILOSOPHY.md)** - DAO×AI設計思想、Proposal/Ledger/Policyの詳細
- **[SHERPA_ARCHITECTURE.md](./SHERPA_ARCHITECTURE.md)** - SherpaのOrchestrator + Sub Agents詳細設計
- **[REWARD_SYSTEM.md](./REWARD_SYSTEM.md)** - 報酬分配の詳細設計

---

## Calm Cockpit 設計原則

GENBA QUESTのアプリ画面は、LPやゲーム画面ではなく、現場運営の作業コックピットとして設計する。
ゲーミフィケーションは温度感として残すが、業務判断を邪魔する装飾にはしない。

### 5原則

| 原則 | 意味 | UIでの判断 |
|------|------|------------|
| Calm density | 情報量は落とさず、主作業以外を静かにする | ナビ、罫線、装飾、補助情報は控えめにする |
| Decision-first | 機能ではなく次の判断を先に出す | First viewportに「今日の現場」「未処理」「異常」「主要CTA」を置く |
| Expressive only for decisions | 強調は意味がある場所だけに使う | 承認、警告、締め、報酬確定、不可逆操作に限定する |
| Direct + Sherpa split | 頻繁で単純な操作は画面、複雑操作はSherpa | 見えている対象は直接操作、探す/組む/条件付きはSherpa |
| Transparent automation | AI提案は根拠と影響を見せてから実行する | Proposal、証跡、影響範囲、承認/却下/再提案を必ず表示する |

### 採用する外部思想

- Linear型の静かな高密度UI: 作業対象以外のUIは目立たせない。
- Material 3 Expressive: 色・形・動きは重要判断を見つけやすくするためだけに使う。
- WCAG 2.2: focus、target size、drag代替、redundant entryを生産性要件として扱う。
- Human-centered AI / XAI: Sherpaの出力は説明可能性、上書き可能性、監査性を持つ。
- Tool consolidation: 分断された機能ではなく、4画面とSherpaに作業を集約する。

### App Screen Anti-Patterns

- 巨大ヒーロー、マーケティング風feature grid、装飾カードでfirst viewportを埋める。
- すべてのカード・ボタン・バッジを強調し、判断点が埋もれる。
- 色だけで状態を伝える。
- ドラッグだけでしか完了できない操作を置く。
- Sherpaが根拠・影響・Proposalを見せずに実行する。

---

## UX優先設計: 4画面 + Sherpa

### 設計判断の根拠

```text
リアルな利用シーン:
  朝の確認     → Today画面を開いて10秒で把握
  電話中に即答 → Calendar画面を見ながら「来月15日空いてます」
  経費登録     → Money画面でレシート撮影
  複雑な操作   → Sherpaに話しかける

判断基準:
  ┌─────────────────────────────────────────────┐
  │ 「見る」操作 → 画面にする                    │
  │ 「聞く」「操作」→ Sherpaに吸わせる          │
  └─────────────────────────────────────────────┘

  電話しながらSherpaに聞く → 無理（声が被る、待ち時間発生）
  電話しながら画面を見る   → できる（即答可能）
```

### インタラクション原則: Direct Manipulation vs Conversational UI

> 車のエアコン温度調整はタッチパネルよりアナログダイヤルの方が使いやすい。
> 同じ原理で、**頻繁×単純な操作はダイレクト操作、低頻度×複雑な操作は会話UI** に振り分ける。

```text
操作の振り分け:

  頻度高 × 単純 → Direct Manipulation（画面上の直接操作）
  頻度低 × 複雑 → Conversational UI（Sherpa）

  ┌──────────────────────┬──────────────────────────────┐
  │ Direct Manipulation  │ Conversational UI (Sherpa)   │
  ├──────────────────────┼──────────────────────────────┤
  │ 認知負荷: 低         │ 認知負荷: 高（待ち時間あり） │
  │ 操作速度: 即時       │ 操作速度: 数秒〜             │
  │ 適用: 既知の対象を   │ 適用: 曖昧な依頼、条件付き   │
  │       直接操作       │       操作、ゼロから組み立て  │
  └──────────────────────┴──────────────────────────────┘

適用例:
  Calendarのドラッグ移動  → Direct（「田中を月→水」がワンアクション）
  アサイン新規登録        → Sherpa（「田中さん来月どこか空いてる？」）
  承認ボタン              → Direct（承認/却下はワンタップ）
  経費のOCR登録           → Direct（撮影→確認→保存）
  一括シフト変更          → Sherpa（「来月の土日全部休みにして」）
```

**判断に迷ったときのルール:**

1. **操作対象が画面に見えている** → Direct Manipulation
2. **操作対象を探す必要がある** → Sherpa
3. **条件付き・複数ステップ** → Sherpa

### 4画面構成

```text
┌─────────────────────────────────────────────────────────────┐
│                       GENBA QUEST                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐            │
│  │ Today  │  │Calendar│  │ Sites  │  │ Money  │            │
│  │ 今日   │  │スケ    │  │ 現場   │  │ お金   │            │
│  │        │  │ジュール│  │        │  │        │            │
│  └────────┘  └────────┘  └────────┘  └────────┘            │
│                                                              │
│                                         ┌───────┐           │
│                                         │Sherpa │           │
│                                         │  FAB  │           │
│                                         └───────┘           │
└─────────────────────────────────────────────────────────────┘
```

| 画面 | 役割 | ユーザーの問い | UXポイント |
|------|------|---------------|-----------|
| **Today** | 今日やること | 「今日何する？」 | 朝10秒で把握 |
| **Calendar** | スケジュール全体 | 「来月の空きは？」 | 電話中に即答 |
| **Sites** | 現場の状況 | 「次に見る現場は？」 | 進行・締め・注意点のワークキュー |
| **Money** | お金の流れ | 「今月いくら？根拠は？」 | 経費・報酬・承認の信頼UI |
| **Sherpa** | 複雑な操作全部 | 「〇〇して」 | Proposal生成・説明・再提案 |

### First Viewport Contract

各画面の最初の表示領域は、装飾ではなく「今すぐ知るべき答え」に使う。

| 画面 | First viewportに必ず入れるもの |
|------|-------------------------------|
| Today | 今日の現場、承認待ち件数、異常/遅延、今月のお金・報酬の要注意点 |
| Calendar | 月/週の空き、日別アサイン、担当者の空き/埋まり状態 |
| Sites | 進行中、締め待ち、問題あり、次アクション |
| Money | 今月の利益/支出/報酬、未承認、差分、根拠への導線 |
| Sherpa | 提案内容、根拠、影響範囲、作成されるProposal、承認/却下 |

---

## 1. Today（今日）

### 目的

**朝10秒見るだけで今日やることが分かる**

### 表示内容

```text
┌─────────────────────────────────────────┐
│ 今週                           ▶ 来週  │
├─────────────────────────────────────────┤
│      月   火   水   木   金   土   日   │
│ 田中  A    A    B    −   C   −   −    │
│ 佐藤  B    B    A    A   −   −   −    │
│ 鈴木  C    −    C    B   A   −   −    │
├─────────────────────────────────────────┤
│ 今日: 2月10日（月）                     │
│ ┌─────────────────────────────────────┐ │
│ │ A現場（渋谷）                       │ │
│ │    田中、佐藤                       │ │
│ └─────────────────────────────────────┘ │
│ ┌─────────────────────────────────────┐ │
│ │ 承認待ち: 3件                       │ │
│ └─────────────────────────────────────┘ │
│ ┌─────────────────────────────────────┐ │
│ │ 今月: 売上120万 / 経費40万          │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

| セクション | 内容 | アクション |
|-----------|------|-----------|
| 今週カレンダー | 誰がどこに行くか（週表示） | スワイプで週切替 |
| 今日の現場 | 本日のアサイン詳細 | タップで詳細 |
| 承認待ち | 経費・請求の未承認（件数バッジ） | タップで承認画面 |
| 今月の流れ | 売上・経費サマリー | タップでMoney |

### UI方針

- **週カレンダーは常に表示**（電話中でも即確認可能）
- 情報密度は落としすぎず、今日の判断に関係ない装飾だけを削る
- **「見る」だけで主要判断が完結、操作は最小限**
- 承認・異常・報酬確定などの判断点だけをアクセントカラーで強調する

---

## 2. Calendar（スケジュール）

### 目的

**電話中でも「来月の空き」に即答できる**

### 表示内容

```text
┌─────────────────────────────────────────┐
│ ◀ 2026年2月 ▶                          │
├─────────────────────────────────────────┤
│ 月   火   水   木   金   土   日        │
│                              1    2     │
│  3    4    5    6    7    8    9        │
│ 10   11   12   13   14   15   16        │
│ ●    ●    ●    −    ●    −    −        │
│ 17   18   19   20   21   22   23        │
│  ●    −    ●    ●    ●    −    −        │
│ 24   25   26   27   28                  │
│  ●    ●    ●    ●    −                  │
├─────────────────────────────────────────┤
│ 2/10（月）の詳細                        │
│ ┌─────────────────────────────────────┐ │
│ │ 田中 → A現場（渋谷）                │ │
│ │ 佐藤 → B現場（新宿）                │ │
│ │ 鈴木 → 休み                         │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
● = アサインあり、− = 空き
```

### 表示モード

| モード | 用途 | 操作 |
|--------|------|------|
| 月表示 | 全体俯瞰・空き確認 | デフォルト |
| 週表示 | 詳細確認 | ピンチイン |
| 日詳細 | 日付タップで展開 | タップ |

### 操作

| 操作 | 方法 |
|------|------|
| 月切替 | 左右スワイプ |
| 日詳細 | 日付タップ |
| アサイン登録 | Sherpa経由（「田中さん15日A現場」） |
| シフト入力 | Sherpa経由（「来月の土日全部休み」） |

### データモデル

```typescript
// シフト（働ける日）
interface Shift {
  id: string;
  user_id: string;
  date: string;           // YYYY-MM-DD
  available: boolean;     // 働けるか
  note?: string;          // 備考
}

// アサイン（どこに行くか）
interface Assignment {
  id: string;
  user_id: string;
  site_id: string;
  date: string;           // YYYY-MM-DD
  status: 'scheduled' | 'confirmed' | 'completed';
}
```

### status対応（Write Model ↔ Read Model）

`Assignment.status` は書き込み実体（Write Model）の状態。  
Calendar表示用Read Modelでは承認待ちを表現するため `pending` を追加する。

| Write Model | Read Model（CalendarAssignmentsView） | 意味 |
|------------|---------------------------------------|------|
| -（未反映） | `pending` | Proposal承認待ち |
| `scheduled` | `scheduled` | 確定済み・未着手 |
| `confirmed` | `confirmed` | 当日確認済み |
| `completed` | `completed` | 完了 |

### UXポイント

**電話対応シナリオ:**

```text
取引先: 「来月15日空いてる？」
     ↓
Calendar画面を開く（1秒）
     ↓
2月15日をタップ（0.5秒）
     ↓
「田中さん空いてます」と即答
```

**Sherpaとの棲み分け:**

| Calendar画面 | Sherpa |
|--------------|--------|
| 「見る」操作 | 「新規登録」操作 |
| 来月の空き確認 | 「田中さん来月どこか空いてる？」 |
| 特定日の詳細確認 | 「最適なアサイン提案して」 |
| 既存アサインの日時ドラッグ移動 | アサイン新規登録（「田中さん15日A現場」） |

**Accessibility:**

- ドラッグ移動には「日付を変更」「担当を変更」などのメニュー代替を持たせる。
- 日付セル、アサインチップ、月/週切替はキーボード操作とfocus表示に対応する。
- 予定の有無は色だけでなく、テキスト・形状・件数でも伝える。

---

## 3. Sites（現場）

### 目的

**現場の「今」と次アクションを一目で把握**

### 表示内容

| 要素 | 内容 |
|------|------|
| ワークキュー | 進行中 / 締め待ち / 注意あり / 完了間近 |
| 各行・カード | 現場名 + 進捗 + 期日 + 利益/締め状態 + 次アクション |
| フィルター | 進行中 / 締め待ち / 注意あり / 完了 / 全て |

### 操作

| 操作 | 方法 |
|------|------|
| 現場詳細 | カードタップ |
| 現場登録 | Sherpa経由（「新しい現場登録して」） |
| 進捗更新 | 詳細画面から |

### UI方針

- 現場一覧はカードの装飾ではなく、未処理・リスク・締め状態が読めるワークキューにする。
- 進行中だけでなく「次に処理すべき現場」を上に出す。
- 利益率や締め状態は根拠にドリルダウンできる表示にする。

### Siteデータモデル

```typescript
interface Site {
  id: string;
  name: string;
  address?: string;
  client_id?: string;
  status: 'planning' | 'in_progress' | 'completed';
  revenue?: number;
  estimated_hours?: number;
  actual_hours?: number;
  started_at?: string;
  completed_at?: string;
}
```

---

## 4. Money（お金）

### 目的

**お金・報酬の流れを根拠付きで把握**

### 表示内容

| 要素 | 内容 |
|------|------|
| 月別PL | 売上・経費・利益の棒グラフ |
| 取引リスト | 直近の取引（スクロール） |
| 承認待ち | 未承認の経費・請求（バッジ付き） |
| 報酬透明性 | 分配対象利益、weight、差分、証跡 |

### 操作

| 操作 | 方法 |
|------|------|
| 経費登録 | カメラボタン → OCR → 確認 → 登録 |
| 取引検索 | Sherpa経由（「先月のガソリン代探して」） |
| 承認 | カードスワイプ or タップ |

### UI方針

- 金額表示は「数字」だけでなく、前月差分・承認状態・根拠への導線をセットにする。
- 報酬分配は「分配対象利益」「自分のweight」「チームweight」「補正」「証跡」を同じ文脈で見せる。
- 承認カードは、何を承認するか、誰に影響するか、取り消し/再提案の道があるかを表示する。

### OCRフロー（維持）

```
カメラ起動 → 撮影 → OCR処理 → 金額・日付・店舗抽出 → 確認画面 → 登録
```

---

## 5. Sherpa（AIアシスタント）

### 位置づけ

**4画面に収まらない複雑な操作を吸収**

> 詳細なアーキテクチャは **[SHERPA_ARCHITECTURE.md](./SHERPA_ARCHITECTURE.md)** を参照

### 設計原則

1. **Orchestrator + Sub Agents** - Sherpa本体が対話し、専門タスクはSub Agentに委譲
2. **Proposal経由の変更** - AIは直接DBを書き換えず、必ずProposalを作成
3. **説明可能性** - すべての判断に理由を付与し、Policy参照の根拠を示す
4. **AI自己承認禁止** - 自分が作ったProposalは承認不可

### 配置

- 全画面共通の **FAB（右下）**
- タップでチャットモーダル

### Sherpaが吸収するもの

| カテゴリ | 画面でできること | Sherpaでやること |
|----------|------------------|------------------|
| スケジュール | 空き確認（見る） | アサイン登録・変更 |
| 現場 | 一覧・詳細確認 | 新規登録・ステータス変更 |
| お金 | 取引一覧・承認 | 取引検索・レポート生成 |
| シフト | - | 一括登録・パターン設定 |
| 報酬 | - | 確認・シミュレーション |
| 設定 | - | ルール変更・権限管理 |

### Sherpa機能

| 機能 | 例 |
|------|-----|
| 検索・集計 | 「今月の経費合計は？」「〇〇の取引を探して」 |
| 登録・更新 | 「経費登録して」「アサイン変更して」 |
| 提案 | 「来週のアサイン提案して」「このルール最適化して」 |
| 分析 | 「〇〇現場の利益率は？」「先月と比較して」 |

### SherpaUI

- チャット形式を基本にするが、実行前はProposal preview panelを必ず表示する
- 現在のページコンテキストを自動で渡す
- Proposalが必要な操作は確認ステップを挟む

### Proposal Preview Panel

Sherpaが作る提案は、チャット本文だけで完結させない。
実行前に次の構造で見せる。

| 要素 | 内容 |
|------|------|
| 提案内容 | 何を作る/変える/締めるのか |
| 根拠 | 参照した現場、取引、稼働日、報酬行、Policy |
| 影響範囲 | 影響する月、現場、メンバー、金額、状態 |
| 作成されるProposal | type、対象、承認数、実行後イベント |
| 操作 | 承認、却下、修正、再提案、詳細を見る |

**禁止:** Sherpaが曖昧なまま直接DB更新・報酬確定・締め処理を行うこと。

---

## 設計判断: 画面 vs Sherpa

### 判断基準

| 基準 | 画面にする | Sherpaに吸わせる |
|------|-----------|------------------|
| 操作タイプ | 「見る」 | 「登録・変更・検索」 |
| 頻度 | 毎日使う | たまに使う |
| 電話対応 | 即答が必要 | 後で対応可能 |
| データ量 | 一覧性が必要 | 特定の1件を操作 |

### Calm Cockpit 判定

| 問い | 画面に残す | Sherpaへ寄せる |
|------|-----------|----------------|
| 朝/電話中/承認時に即答が必要か | はい | いいえ |
| 対象が画面上に見えているか | はい | いいえ |
| 1タップ/1ドラッグで完了するか | はい | いいえ |
| 条件分岐・検索・一括変更があるか | いいえ | はい |
| 実行前に説明と承認が必要か | decision card | Sherpa Proposal |

### 具体例

```text
画面でやること:
  ├── 今日の現場確認 → Today（毎朝見る）
  ├── 来月の空き確認 → Calendar（電話中に即答）
  ├── 現場一覧 → Sites（一覧性が必要）
  └── 経費承認 → Money（毎日のルーティン）

Sherpaでやること:
  ├── アサイン登録 → 「田中さん15日A現場」
  ├── シフト一括設定 → 「来月の土日全部休み」
  ├── 取引検索 → 「先月のガソリン代探して」
  └── 報酬シミュレーション → 「今月の報酬見せて」
```

### UX優先の設計変更

| 観点 | 初期案（3画面） | UX優先版（4画面） |
|------|----------------|-------------------|
| Calendar | Sherpaに吸収 | 専用画面として復活 |
| 理由 | 画面数を減らしたい | 電話中に即答できない |
| 結果 | 学習コスト低 | 実用性優先 |

---

## ディレクトリ構造（4画面 + Sherpa版）

```text
frontend/
├── src/
│   ├── components/
│   │   ├── common/              # 共通コンポーネント
│   │   │   ├── BottomNav.tsx       # 4タブ: Today / Calendar / Sites / Money
│   │   │   ├── FAB.tsx             # Sherpa呼び出し
│   │   │   ├── SherpaChat.tsx      # チャットモーダル
│   │   │   └── Toast.tsx
│   │   ├── today/               # Today画面用
│   │   │   ├── WeekCalendar.tsx    # 週間カレンダー（常時表示）
│   │   │   ├── TodayAssignments.tsx # 今日のアサイン
│   │   │   ├── PendingBadge.tsx    # 承認待ちバッジ
│   │   │   └── MonthlySummary.tsx  # 今月サマリー
│   │   ├── calendar/            # Calendar画面用
│   │   │   ├── MonthCalendar.tsx   # 月間カレンダー
│   │   │   ├── WeekCalendar.tsx    # 週間カレンダー
│   │   │   ├── DayDetail.tsx       # 日別詳細
│   │   │   └── AssignmentChip.tsx  # アサイン表示チップ
│   │   ├── sites/               # Sites画面用
│   │   │   ├── SiteCard.tsx
│   │   │   ├── SiteDetail.tsx
│   │   │   └── ProgressBar.tsx
│   │   ├── money/               # Money画面用
│   │   │   ├── PLChart.tsx
│   │   │   ├── TransactionList.tsx
│   │   │   ├── ApprovalCard.tsx
│   │   │   └── CameraCapture.tsx   # OCR用
│   │   └── sherpa/              # Sherpa専用
│   │       ├── ChatBubble.tsx
│   │       └── ProposalConfirm.tsx # 確認ダイアログ
│   ├── pages/
│   │   ├── Today.tsx            # 今日の概要
│   │   ├── Calendar.tsx         # スケジュール管理
│   │   ├── Sites.tsx            # 現場一覧
│   │   └── Money.tsx            # 経理
│   ├── hooks/
│   │   ├── useSherpa.ts         # Sherpa対話
│   │   ├── useCalendar.ts       # カレンダー操作
│   │   ├── useAssignments.ts    # アサイン管理
│   │   ├── useShifts.ts         # シフト管理
│   │   ├── useSites.ts
│   │   ├── useTransactions.ts
│   │   └── useAuth.ts
│   ├── lib/
│   │   ├── api.ts
│   │   ├── supabase.ts
│   │   └── utils.ts
│   └── styles/
│       └── global.css
```

---

## 削除対象

### ページ

- `Perks.tsx` → 削除
- `Sherpa.tsx` → 削除（FABに統合）
- `Dashboard.tsx` → `Today.tsx` にリネーム＆簡素化

### コンポーネント

- `MonsterBattleCard.tsx` → 削除
- `PerkCard.tsx` → 削除
- `PerkUnlockAnimation.tsx` → 削除
- `StaminaBar.tsx` → 削除
- `PartyMemberCard.tsx` → 削除

### API・データ

- モンスター関連API
- パーク関連API
- スタミナ関連API
- バッジ関連API

---

## 技術スタック（維持）

| レイヤー      | 技術                                     |
| ------------- | ---------------------------------------- |
| Frontend      | React + TypeScript + Vite                |
| Styling       | CSS Modules                              |
| Design System | Material 3 Expressive (M3E)              |
| Animation     | Framer Motion                            |
| Backend       | Express.js + TypeScript                  |
| Database      | Supabase (PostgreSQL)                    |
| AI            | Claude / Gemini / OpenAI（選択可能）     |
| OCR           | Google Vision API                        |

---

## UIデザインシステム（Material 3 Expressive）

GENBA QUESTは **Calm Cockpit with Material 3 Expressive (M3E)** をデザイン基盤として採用する。
M3Eは全面的な派手さではなく、重要な判断点を見つけやすくするために使う。

### M3Eの5つの柱

#### 1. Color System（カラーシステム）

**Tonal Palettes & Dynamic Color:**

```text
Primary Tonal Palette:
├── primary (メインブランドカラー)
├── on-primary (primary上のテキスト/アイコン)
├── primary-container (控えめなprimaryサーフェス)
├── on-primary-container (container上のテキスト)
└── inverse-primary (ダーク/ライトモード切替用)

Extended Roles:
├── secondary, tertiary (アクセントカラー)
├── surface, surface-variant, surface-container
├── outline, outline-variant
└── error, success states
```

**CSS Design Tokens（Calm Cockpit初期値）:**

```css
--md-sys-color-primary: #0D9488;
--md-sys-color-on-primary: #FFFFFF;
--md-sys-color-primary-container: #CCFBF1;
--md-sys-color-surface: #FFFFFF;
--md-sys-color-surface-container: #F8FAFC;
--md-sys-color-outline: #CBD5E1;
--md-sys-color-warning: #F97316;
```

#### 2. Typography（タイポグラフィ）

**Type Scale:**

| Role     | Size | 用途                 |
| -------- | ---- | -------------------- |
| Headline | 24-28px | 画面タイトル、主要サマリー |
| Title    | 18-20px | セクション、decision card |
| Body     | 14-16px | 本文、一覧、説明 |
| Label    | 12-14px | ボタン、チップ、ナビ、補助情報 |
| Display  | 原則使用しない | LPや特別な空状態のみ |

**Variable Font対応:**

```css
font-variation-settings:
  'wght' 400,  /* weight: 100-900 */
  'wdth' 100,  /* width: 75-125 */
  'GRAD' 0;    /* grade: -200 to 150 */
```

#### 3. Shape System（シェイプシステム）

**Corner Radius Tokens:**

```css
--md-sys-shape-corner-none: 0px;
--md-sys-shape-corner-extra-small: 4px;
--md-sys-shape-corner-small: 8px;
--md-sys-shape-corner-medium: 12px;
--md-sys-shape-corner-large: 16px;
--md-sys-shape-corner-extra-large: 28px;
--md-sys-shape-corner-full: 9999px;  /* 完全な丸み */
```

**Shape Morphing（判断点に限定）:**

ボタン押下時などに角丸が滑らかに変化するインタラクション。承認・確定・警告などの重要操作に限定する。

```css
.button {
  border-radius: var(--md-sys-shape-corner-small);
  transition: border-radius 300ms cubic-bezier(0.2, 0, 0, 1);
}

.button:active {
  border-radius: var(--md-sys-shape-corner-medium);
}
```

#### 4. Motion System（モーションシステム）

**Easing Curves:**

```css
--md-sys-motion-easing-standard: cubic-bezier(0.2, 0, 0, 1);
--md-sys-motion-easing-emphasized: cubic-bezier(0.2, 0, 0, 1);
--md-sys-motion-easing-emphasized-decelerate: cubic-bezier(0.05, 0.7, 0.1, 1);
--md-sys-motion-easing-emphasized-accelerate: cubic-bezier(0.3, 0, 0.8, 0.15);
```

**Duration Tokens:**

```css
--md-sys-motion-duration-short1: 50ms;
--md-sys-motion-duration-short2: 100ms;
--md-sys-motion-duration-medium1: 200ms;
--md-sys-motion-duration-medium2: 300ms;
--md-sys-motion-duration-long1: 400ms;
--md-sys-motion-duration-long2: 500ms;
```

**Calm Motion（状態説明のアニメーション）:**

```css
.fab {
  transition: transform 180ms cubic-bezier(0.2, 0, 0, 1);
}

.fab:hover {
  transform: translateY(-1px);
}
```

#### 5. Component Specifications

**Buttons:**

| Type         | Height | Corner Radius | Padding   |
| ------------ | ------ | ------------- | --------- |
| Filled       | 40px   | full (20px)   | 24px      |
| Outlined     | 40px   | full (20px)   | 24px      |
| Text         | 40px   | full (20px)   | 12px      |
| FAB          | 56px   | large (16px)  | 16px      |
| Extended FAB | 56px   | large (16px)  | 16px/20px |

Operational screens may use `8px` corner radius for dense toolbars, tables, filters, and decision cards. Full pill shapes are reserved for chips, nav active indicators, and compact status labels.

**Cards:**

| Type     | Corner Radius | Elevation |
| -------- | ------------- | --------- |
| Elevated | medium (12px) | level1    |
| Filled   | medium (12px) | level0    |
| Outlined | medium (12px) | level0    |

**Navigation:**

| Component  | Height      | Active Indicator        |
| ---------- | ----------- | ----------------------- |
| Nav Bar    | 80px        | pill shape, full radius |
| Nav Rail   | 72px width  | pill shape              |
| Nav Drawer | 360px width | rounded end             |

### M3Eアクセシビリティ

M3Eはアクセシビリティを核心原則として設計：

1. **Color Contrast**: テキスト最低4.5:1、UIコンポーネント3:1
2. **Touch Targets**: インタラクティブ要素は最低48x48dp
3. **Motion**: `prefers-reduced-motion`メディアクエリを尊重
4. **Focus Indicators**: 十分なコントラストの可視フォーカス状態
5. **Variable Fonts**: ウェイト/幅変化でも可読性を維持

### Calm Cockpit UI監査チェックリスト

- [ ] First viewportに次の判断または主要な答えがある
- [ ] 主作業以外のナビ、境界線、アイコン、補助情報が目立ちすぎない
- [ ] アクセントカラーはCTA、警告、承認、締め、報酬確定に限定されている
- [ ] 色だけで状態を伝えていない
- [ ] ドラッグ操作にクリック/メニュー代替がある
- [ ] focusがsticky header/footer/modalに隠れない
- [ ] タップ対象は最低24px、実運用の主要操作は44-48pxを確保している
- [ ] Sherpa/AI提案は提案内容、根拠、影響範囲、Proposal、承認/却下/再提案を表示する
- [ ] Money/Rewardは金額だけでなく、差分、根拠、証跡、承認状態を表示する
- [ ] 装飾カード、巨大ヒーロー、意味のないモーションで判断速度を落としていない

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## マイグレーション手順

### Phase 1: 削除

1. Perksページ・コンポーネント削除
2. モンスター関連削除
3. ルーティング整理

### Phase 2: リネーム

1. Dashboard → Today
2. Accounting → Money
3. URLパス変更

### Phase 3: Calendar実装

1. Calendar ページ新規作成
2. MonthCalendar / WeekCalendar コンポーネント
3. Shift / Assignment データモデル実装

### Phase 4: Today画面強化

1. WeekCalendar 埋め込み
2. 今日のアサイン表示
3. 承認待ち・月間サマリー

### Phase 5: Sherpa統合

1. FAB + SherpaChat 実装
2. アサイン登録・シフト設定のSherpa対応
3. コンテキスト連携（現在の画面情報を渡す）

### Phase 6: 最適化

1. コンポーネントのディレクトリ整理
2. 不要なAPIエンドポイント削除
3. デザインシステムの統一

---

## 6. 報酬分配システム

詳細は **[REWARD_SYSTEM.md](./REWARD_SYSTEM.md)** を参照

### 報酬概要

- **Tスコア（技術力）× 稼働日数** で報酬を分配
- 行動評価は報酬に含めない（別途フィードバック運用）
- 報酬格差は同じ稼働日数で最大3〜5倍に収める

### 報酬パラメータ

| 項目             | 値                             |
| ---------------- | ------------------------------ |
| 会社取り分率     | 0%（全額職人に分配）           |
| ブースト指数(p)  | 1.5                            |
| Tスコア満点      | 170点（パテ50点 + クロス120点）|

### 報酬機能

- スキル達成管理（職人ごと）
- 3視点評価（自己・360°・熟練者）
- 現場完了時の報酬計算
- 計算履歴の記録
