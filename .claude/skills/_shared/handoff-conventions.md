# Handoff Conventions (Shared Reference)

引き継ぎスキル群で共通のルール。各SKILL.mdからここを参照する。

## Layered Memory Model (L0-L3)

- **L0**: `Quick Resume (AI)` — `NEXT_CMD` + STATE + HOTSET。次セッション開始時にこれだけ読む（`offset: 1, limit: 15`）
- **L1**: `Session Summary (Compacted)` — 3-7行の要約。Entry-ID参照つき
- **L2**: `Project Continuity (Compacted)` — Decisions / Landmines / Open Threads。Entry-ID参照つき
- **L3**: `Incremental Updates` — 生ログ。閾値超過で自動コンパクション→archive退避

Progressive Loading: L0だけ最初に読む → L1/L2は文脈不明時のみ → L3は原則読まない。全文一括読み込み禁止。

## Semantic Description Rules

Changed Files / `--done` / `--file` には以下を適用:

- **"updated" / "modified" / "changed" は禁止** — 情報量ゼロ
- **「何が・なぜ」を書く** — 例: `approve()にatomic RPC優先パスを追加`
- **新規作成は明記** — 例: `新規作成: approve+executeの原子実行SQL関数`
- **削除は理由付き** — 例: `削除: 旧Dashboardコンポーネント（Todayページに統合）`

## Domain Operation

`--domain` でセッション開始すると、handoffがドメイン別に分割される:

- `handoff/server.md`, `handoff/frontend.md` 等のサブファイルが対象
- ルート `HANDOFF.md` はドメイン一覧のindex（~15行）になる
- インクリメンタル更新時は `--handoff handoff/<domain>.md` で対象指定
- 推奨命名: `frontend/<page>`, `server/<feature>`, `integration/<provider>`

`--domain` 未指定時は従来通り `HANDOFF.md` 単体運用（後方互換）。

## Quality Gate

handoff前に必ず実行し、結果を記録する:

```bash
cd server && npx tsc --noEmit        # server typecheck
cd frontend && npx tsc --noEmit      # frontend typecheck
cd frontend && npx eslint src/       # lint
cd server && npm test                # test (件数も記録)
```

## Cross-Agent Rules

1. 同時に同じファイルを触らない（Locked Filesで明示）
2. 受け渡しごとに品質ゲート必須（PASS/FAILを記録）
3. 片方は実装、もう片方はレビュー寄り
4. 最終統合は人間が判断してマージ
