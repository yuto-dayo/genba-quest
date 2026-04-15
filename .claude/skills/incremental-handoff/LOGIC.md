# Incremental Handoff — Logic Reference

`append-handoff-update.sh` の動作仕様・不変条件・処理フロー。
変更時はまず本書を読み、テスト ([tests/run.sh](tests/run.sh)) を先に確認する。

## 1. スクリプトの責務

1 回の実行で以下のいずれかを行う。

**Work-entry モード（既定）**
- `## 11. Incremental Updates` に 1 エントリ追記
- Entry-ID を単調採番 (H0001, H0002, ...)
- L0 の `NEXT_CMD` を更新
- L1/L2 サマリブロックを**全再生成**
- 閾値超過時に古い L3 エントリを archive へ退避
- Quality Gate テーブル該当行を更新（指定時）

**Session-event モード（`--session-event <label>`）**
- `<!-- HANDOFF_SESSION_EVENTS_START -->` ブロック内に `timestamp + label` を 1 行追記
- 保持件数超過分を drop（`HANDOFF_SESSION_EVENTS_KEEP_RECENT`、既定 30）
- Quality Gate は work-entry と同じく更新可
- **L0/L1/L2/L3 には一切触らない**

## 2. HANDOFF.md の構造契約

スクリプトはマーカーペアを境界として区分を書き換える。手動編集でペアを壊すと全再生成が破綻する。

必須マーカー:

| マーカー | 役割 | 再生成 |
|---------|------|-------|
| `<!-- L0_END -->` | Quick Resume 終端 | Quick Resume 内 `NEXT_CMD` 行のみ差し替え |
| `HANDOFF_L1_START/END` | Session Summary | 毎回全再生成（最新エントリから 3-7 行） |
| `HANDOFF_L2_DECISIONS_START/END` | 決定事項 | 毎回全再生成 |
| `HANDOFF_L2_LANDMINES_START/END` | 注意点 | 毎回全再生成 |
| `HANDOFF_L2_THREADS_START/END` | Open threads | 毎回全再生成 |
| `HANDOFF_L2_STATE_START/END` | 状態スナップショット | 毎回全再生成 |
| `HANDOFF_SESSION_EVENTS_START/END` | 監査ログ | 1 行追記 + 古い分 drop |

L3 (`## 11. Incremental Updates`) のみ**追記のみ**（再生成ではない）。

## 3. 処理フロー（work-entry モード）

```
1. 引数パース
2. ロック取得（mkdir <handoff>.lock.d、stale/timeout/disable ロジック）
3. ファイル / マーカー存在確認 → 欠けていれば初期化
4. 次 Entry-ID 計算（既存 H0NNN の最大値 + 1）
5. L3 に新エントリ追記
6. compact_incremental_entries → 閾値超過時に古い分を archive へ移動
7. sync_handoff_summary → L0 の NEXT_CMD 差し替え
8. sync_memory_layers → L1/L2_* を全再生成
9. Quality Gate 指定があれば該当行を更新
10. trap で lock 解放
```

**重要**: 5-9 は **個別 atomic（tempfile + rename）だが、シーケンス全体は atomic ではない**。途中 SIGKILL で部分適用状態になり得る。復旧は git checkout。

## 4. 処理フロー（session-event モード）

```
1. 引数パース
2. ロック取得
3. SESSION_EVENTS ブロックに 1 行追記 + keep_recent 超過分を drop
4. Quality Gate 指定があれば更新
5. lock 解放
```

L0/L1/L2/L3 は触らない。これは `test_session_event_isolation` が保証する責務。

## 5. 不変条件

1. **Entry-ID 単調増加** — 過去値より小さい ID が発行されたらバグ
2. **マーカーペアは各 1:1** — start/end が崩れれば再生成が狂う（`test_lock_concurrent_serializes` で 6 ペア検証）
3. **L3 は追記のみ** — compaction は末尾古い分を archive へ移動。番号は詰めない
4. **session-event は L0/L1/L2/L3 不変**
5. **個別書き換えは atomic**（mktemp + mv）

## 6. 並行制御

- **per-file ロック**: `handoff/server.md` と `handoff/frontend.md` は独立。ドメインまたぎは直列化しない
- **同一 handoff への並行**: mkdir ロックで直列化。最大 `HANDOFF_LOCK_TIMEOUT`（既定 30s）待ち、超過で exit 2
- **stale lock**: owner 内 timestamp が `HANDOFF_LOCK_STALE_SECONDS`（既定 120s）超過なら自動破棄
- **disable**: `HANDOFF_LOCK_DISABLE=1` で完全バイパス（デバッグ専用）

## 7. 環境変数まとめ

| Env | 既定 | 用途 |
|-----|------|------|
| `HANDOFF_COMPACTION_THRESHOLD` | 20 | L3 圧縮開始件数 |
| `HANDOFF_COMPACTION_KEEP_RECENT` | 12 | L3 に残す件数（threshold - 1 以下にクランプ） |
| `HANDOFF_SESSION_EVENTS_KEEP_RECENT` | 30 | 監査ログ保持件数 |
| `HANDOFF_LOCK_TIMEOUT` | 30 | ロック待ち秒数上限 |
| `HANDOFF_LOCK_STALE_SECONDS` | 120 | stale と判定する保持時間 |
| `HANDOFF_LOCK_DISABLE` | 0 | `1` でロック無効化 |

## 8. 既知の失敗モード

| 症状 | 原因 | 対処 |
|------|------|------|
| `exit 2` | ロック timeout | 他プロセス完了待ち。または `HANDOFF_LOCK_STALE_SECONDS` 調整 |
| ロック残骸 | プロセス強制終了 | 120s 経過で次回自動破棄。または `rm -rf <handoff>.lock.d` |
| 再生成が崩れる | マーカー手動編集ミス | git で戻す。該当ペアだけ復元すれば済む |
| 部分適用状態 | シーケンス途中での SIGKILL | git で戻す。ロックは trap で解放される |
| Entry-ID 不連続 | 手動で L3 を削除した | 基本無害（次採番は max+1）。ただし圧縮ロジックが混乱し得る |

## 9. テスト (`tests/run.sh`)

plain bash、外部依存なし、7 tests。

**カバー済み**: 基本追記 / Entry-ID 連番 / session-event 非汚染 / ロック並行直列化 / stale auto-break / timeout / disable

**未カバー**: compaction 閾値境界、`--from-git-status`、`--quality-gate` 複数指定、既存マーカー破損耐性、L2 再生成の内容正しさ

## 10. 変更時の手順

1. `tests/run.sh` を変更前に実行し 7/7 pass を確認
2. スクリプト編集
3. `tests/run.sh` 再実行 → 全 pass でなければ revert
4. 新規機能を足すなら対応テストを先に書く
5. マーカー名を変える時は：(a) 既存 HANDOFF.md すべての migration 手順を同 PR で示す、(b) `tests/fixtures/minimal-handoff.md` も同時更新

## 11. 未解決課題 / 改善候補

着手効果順。High は近いうちにやる価値が高い、Low は構造的負債として認識だけしておけばよい。

### High — 着手効果が大きい

- **[1] `validate-handoff.sh` の新設**
  - マーカーペア整合（7 ペアそれぞれ 1:1）、Entry-ID 単調性、L3 番号重複を検証する lint。~50 行で書ける
  - pre-commit hook に仕込めばマーカー破損事故を未然防止できる
  - なぜ: 現状マーカー破損は silent に再生成を壊す。「壊れてから git で戻す」より「壊す前に弾く」
- **[2] `--dry-run` / `--check` フラグ**
  - 書き込みせず、適用予定の差分を stdout に流すだけ
  - なぜ: L1/L2 再生成ロジックのデバッグが「実行して git diff」しかない現状を解消する。regression 疑いの時の切り分けコストが激減

### Medium — テストカバレッジの穴

- **[3] compaction 閾値境界** — `threshold=3 / keep_recent=2` のような狭い設定で archive 退避が起きるか、archive ファイル中身が正しいか
- **[4] `--quality-gate` 複数指定** — 現状テスト 0 件。複数キー同時指定でテーブル行更新が衝突しないか
- **[5] `--from-git-status`** — 変更ファイル自動収集が `--file` に正しく合流するか
- **[6] マーカー破損耐性の仕様化** — 壊れたマーカーを検出したら fail-fast か silent repair か、仕様を decide して test で固定
- **[7] L2 再生成の内容正しさ** — 現状テストはペア整合性しか見ていない。`decisions/landmines/threads/state` が意図通り抽出されるかは手動確認頼み

### Low — 構造的負債（いつかやる）

- **[8] 1422 行 bash の解消** — 選択肢は (a) awk heredoc を `.awk` 外出し、(b) `append-handoff-update.mjs` リライト（既存 `directing-handoff-workstreams/scripts/summarize-handoffs.mjs` に前例あり、node stdlib のみで書ける）。既存 `run.sh` がそのまま仕様スナップショットとして使える
- **[9] シーケンス atomicity** — 5 段パイプライン途中の SIGKILL で部分適用状態になり得る。全変換を tempfile で蓄積して最後に一括 rename する方式にすれば救える
- **[10] スキーマバージョニング** — マーカー名変更時の migration が未定義。`<!-- HANDOFF_SCHEMA_VERSION: 1 -->` ヘッダを足し、script が非対応バージョンを検出したら fail-fast する
- **[11] クロスドメイン整合性** — `handoff/server.md` の更新が `handoff/frontend.md` への影響を示唆しても script は強制しない。`--cross-domain frontend=proposalstatus` のようなメタデータ記録だけでも監査性が上がる
- **[12] セマンティック規約の自動検出** — 「updated / modified / changed 禁止」ルールは現状社会的強制のみ。`--done` や `--file` の中身に NG ワードが含まれたら warning を出す lint
- **[13] 構造化ログ** — 現状 `echo` の 1 行出力のみ。JSON ログ + log level にすればロック競合や compaction 発動の時系列分析がしやすくなる（`summarize-handoffs.mjs` と連携させやすい）

### 位置づけ

- **1-2 は小さく、効果が大きい**。次に incremental-handoff に触る時にまず手を付ける候補
- **3-7 はテスト資産の補完**。重大なバグに当たってから追加する reactive pattern でも許容範囲
- **8-13 は書き直しや大改修を伴う**。触る理由（landmine を踏んだ、移植する必要が出た等）が出てから検討する
