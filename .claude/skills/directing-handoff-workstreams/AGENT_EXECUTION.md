# Agent Execution Principles

ワークストリーム実行時のエージェント行動規範。SKILL.mdから参照される。

## Agent Execution Principles

- `Instruction Hierarchy`: 上位指示（system/developer）とプロジェクト規約を優先し、衝突時は下位指示を採用しない。
- `Directive Contract`: 実行前に Goal/Scope/Constraints/Non-goals/DoD を明文化する。
- `Least-Privilege Action`: 読み取り優先。書き込みは最小変更。破壊的操作は承認なしで実行しない。
- `Evidence-First`: 提案だけで終わらせず、検証コマンドと結果をセットで返す。
- `Fail-Loud`: 再試行上限を超えたら黙って進めず、ブロッカーとして報告する。

## Directive Contract Template

着手前に次を埋める。空欄のまま実行しない。

```yaml
goal: "このターンで達成する成果"
scope:
  - "変更対象ファイル/領域"
constraints:
  - "守るべき規約・禁止事項"
non_goals:
  - "今回はやらないこと"
output_contract:
  - "返答に必須のセクション"
definition_of_done:
  - "完了判定の具体条件"
risk_tier: "safe-read | bounded-write | destructive"
approval_gate: "required | not_required"
retry_budget: 2
escalation_triggers:
  - "ポリシー衝突"
  - "検証失敗の連続"
```

## Risk Gate Matrix

| Tier | Allowed | Not Allowed | Approval |
| ---- | ------- | ----------- | -------- |
| `safe-read` | 読み取り、分析、計画、非破壊検証 | ファイル変更、削除 | 不要 |
| `bounded-write` | workspace内の限定的編集、検証実行 | 破壊的コマンド、外部破壊操作 | 原則不要 |
| `destructive` | ユーザーが明示許可した破壊的操作のみ | 無許可の削除/リセット/本番破壊 | 必須 |

判定ルール:
- `rm`, `git reset`, `git checkout --`, productionデータ変更を含む場合は `destructive`
- 変更範囲が handoff/skill ドキュメント内のみなら通常 `bounded-write`
- 判定に迷う場合は高いTierを採用する

## Failure Protocol

- `Retry Budget`: 同一失敗原因への再試行は最大2回
- `Immediate Stop`: ポリシー衝突、権限不足、破壊操作の未承認は即停止
- `Escalate`: 検証失敗2回連続 / 必要入力不足 / 連鎖ブロック可能性
- `Fallback`: 自動実行不能時は「安全な次の1手（read-only）」を必ず提示する
