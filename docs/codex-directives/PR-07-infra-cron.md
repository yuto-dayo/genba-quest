# PR-07 — Infra: GitHub Actions cron(月確定リマインダー定期実行)

## Goal
PR-06 の `/_remind-close` endpoint を 毎月 1〜7 日に毎日 1 回叩く cron を GitHub Actions で構築。Render の有料化や別 cron 基盤導入を回避。

## Acceptance criteria

- [ ] `.github/workflows/month-close-reminder.yml` 追加
- [ ] スケジュール: 毎月 1〜7 日 JST 00:00(UTC 15:00 前日)
- [ ] secrets: `SERVER_URL`, `CRON_SECRET` をリポジトリ secrets に追加(README で手順記載)
- [ ] curl 失敗時に workflow を fail させ、Actions 通知でユーザに気付かせる
- [ ] 手動実行用に `workflow_dispatch` も付与
- [ ] PR description で実行ログ(初回手動 dispatch 結果)を提示

## File

`.github/workflows/month-close-reminder.yml`:

```yaml
name: Month Close Reminder
on:
  schedule:
    - cron: '0 15 30 * *'      # JST 6/1 00:00 = UTC 5/31 15:00 ... ※後述
    - cron: '0 15 1-6 * *'     # JST 翌月 2-7 日 00:00
  workflow_dispatch:
    inputs:
      month:
        description: 'YYYY-MM (optional override)'
        required: false

jobs:
  remind:
    runs-on: ubuntu-latest
    steps:
      - name: Call remind-close endpoint
        run: |
          BODY='{}'
          if [ -n "${{ github.event.inputs.month }}" ]; then
            BODY="{\"month\":\"${{ github.event.inputs.month }}\"}"
          fi
          curl --fail -X POST "${{ secrets.SERVER_URL }}/api/v1/path/month/_remind-close" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            -H "Content-Type: application/json" \
            -d "$BODY"
```

注: cron schedule は UTC のみ。JST 0:00 を実現するには UTC 15:00 を前日に設定。月跨ぎで日付がずれるため、`0 15 30 * *`(月末 +1日のJST=翌月1日)+ `0 15 1-6 * *`(翌月2-7日のJST)で 1〜7 日カバー。30日/31日でない月でも安全側に倒れる(処理側がidempotent)。

→ もしくはサーバ側で「JST 5月分処理は 6/1 〜 6/7」と判定して、UTC 1〜7 日 00:00 で叩く方が安全(処理側が target_month を逆算)。**サーバ判定 + UTC 1〜7日 cron** を最終形に推奨。

## Documentation

`docs/codex-directives/INFRA.md` に setup 手順記載:
1. Render dashboard で server URL 確認
2. `openssl rand -hex 32` で secret 生成
3. server の env に `CRON_SECRET` を同値で設定
4. GitHub repo Settings > Secrets and variables > Actions に `SERVER_URL`, `CRON_SECRET` 追加

## Edge cases

- secret rotation: 同じ secret を両側更新 → 短い無効期間あり。気にしないでよい(月初しか叩かない)
- workflow failure: Actions メールで気付く前提。Slack 通知などは別 PR

## Forbidden

- secret をリポジトリにコミット
- HTTP で叩く(必ず HTTPS)
- 失敗を無視する(`--fail` 必須)

## Reference
- Memory: `project_month_close_reminder_timing.md`
