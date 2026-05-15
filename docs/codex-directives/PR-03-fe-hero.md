# PR-03 — FE: Money ヒーロー3層 + MemberCarousel + 文字削減

## Goal
`Money.tsx` のヒーロー部分を「報酬 / 立替 / 会社」の3セクション構造に置換する。既存の `MoneyHero` / `CashflowBucketStrip` / 各カード見出しの説明文・※注意書きを削除し、`MoneyMock.tsx` の見た目に合わせる。

## Acceptance criteria

- [ ] Money 画面の上部が ① 報酬 / ② 立替 / ③ 会社 の順に並ぶ
- [ ] ①② は横スクロール `MemberCarousel`、自分カード先頭固定、末尾に「全員を見る」カード
- [ ] ③ は 利益 + 売上/経費 + sparkline + アラートチップ統合カード
- [ ] 旧 `CashflowBucketStrip`(お金の流れ)を Money 画面から削除
- [ ] 旧「未請求残」「支払い対象」セクションの **サブタイトル** と **※注意書き** を削除(セクション自体は別 PR で消す、本 PR ではテキストだけ削減)
- [ ] 月次推移グラフを最下段から ③ 会社カード内 sparkline に統合
- [ ] FAB は既存のまま温存(PR-15 で改修)
- [ ] 報酬数値タップで `自分カード詳細モーダル` を開く (PR-04 がモーダル本体実装、本 PR では `console.log("open own-reward-modal")` でスタブでOK)
- [ ] 立替の `[+経費を追加]` などのセクション内CTAは作らない(FAB 集約)
- [ ] モバイル 375px でファーストビューに ① と ② の上端が収まる
- [ ] tsc/lint/test グリーン

## Files

### 新規
- `frontend/src/components/money/MoneyHeroSection.tsx` — section ラッパ(heading + 🛡️ slot + children)
- `frontend/src/components/money/MoneyHeroSection.module.css`
- `frontend/src/components/money/MemberCarousel.tsx` — 横スクロール容器、`mode: "reward" | "expense"` で挙動切替
- `frontend/src/components/money/MemberCarousel.module.css`
- `frontend/src/components/money/MemberCard.tsx` — 自分/他人 + reward/expense の 4 バリアント
- `frontend/src/components/money/MemberCard.module.css`
- `frontend/src/components/money/CompanySummaryCard.tsx` — ③ 会社カード(sparkline 含む)
- `frontend/src/components/money/CompanySummaryCard.module.css`
- `frontend/src/components/money/ShieldPopover.tsx` — 🛡️ プライバシー説明
- `frontend/src/components/money/ShieldPopover.module.css`

### 改変
- `frontend/src/pages/Money.tsx` — ヒーロー部分(おおむね line 688–748 + CashflowBucketStrip 周辺)を新構造に置換
- `frontend/src/pages/Money.module.css` — 旧ヒーロークラスを整理(完全削除はしない、他で使われている可能性)

## Component spec

### `<MoneyHeroSection title shield?>`
- props: `title: string`, `shield?: ReactNode`(🛡️ ボタン), `children: ReactNode`
- 構造: `<section aria-labelledby><h2 id>...</h2>{shield}</section><div>{children}</div>`

### `<MemberCarousel mode="reward" | "expense" members selfMemberId onCardTap onSeeAllTap>`
- props:
  - `mode`: カードの中身切替
  - `members`: PR-02 の `TeamMemberReward[]` または `TeamMemberReimbursement[]`
  - `selfMemberId`: 自分の member_id
  - `onCardTap(memberId)`: タップ時呼ばれる
  - `onSeeAllTap()`: 末尾カードタップ
- 振る舞い:
  - self を先頭に置き換え、残りを `attendance_days` 降順(reward) / `total_advanced` 降順(expense)
  - `scroll-snap-type: x mandatory`
  - 末尾に 1 枚「全員を見る」カード
- 既存 `MoneyMock.tsx` の `RewardSection` / `ExpenseSection` の実装を参考にコピペ可

### `<MemberCard variant="self" | "other" mode="reward" | "expense">`
- 自分カードのみ CTA inline(reward モード時: `[請求書を出す]`(=`onCardTap` を呼ぶだけ、実際の請求書作成は PR-04 のモーダル内))
- 他人カードは金額 + 状態チップ、CTA なし
- ステータスチップは `--money-status-*` を左ドットで表現、テキスト併記

### `<CompanySummaryCard profit sales expenses sparkline overdue pendingCount>`
- 利益数値は `--md-sys-typescale-headline-medium`, `tabular-nums`
- 利益マイナスなら `--money-status-overdue` 色
- sparkline は SVG または `<span>` × 6 で `MoneyMock` 同等
- アラートチップ(`遅延 N` / `未請求 N`)タップで対応するフィルタ済タブを開く(PR-11 でルーティング、本 PR では `console.log` でスタブ)

### `<ShieldPopover>`
- 「見えるもの」3項目 / 「見えないもの」4項目を ul で表示
- click outside or ESC でクローズ
- 親で open state 管理

## Data integration

- `Money.tsx` に `useState` と `useEffect` 追加。`fetchTeamRewardSummary(month)` / `fetchMemberReimbursementsSummary(month)` を並列呼び出し
- ローディング中: 既存 `InlineLoader` を 4 枚分プレースホルダで並べる(スケルトン)
- エラー時: 1行エラー + リトライボタン(既存 `Money.tsx` のエラーハンドラ流用)

## Edge cases

- 全員 ¥0: ③のアラートチップ 0件 → チップ自体を非表示(空状態を見せない)
- メンバーが自分1人のみ: 「全員を見る」カードは出さない(`members.length <= 1` の時)
- 月切替で `is_finalized = false` → 自分カードのステータスチップを「試算中」、CTA は出さない
- ニックネーム 5文字超: `text-overflow: ellipsis` で切る、`aria-label` にフル保持

## Forbidden

- セクション内に CTA ボタンを置く(FAB 一本化に反する)
- カード内に説明文を入れる(状態チップで完結)
- ※注意書きを残す(🛡️ ポップオーバーに集約)
- 既存 `MoneyHero` コンポーネントを削除(他で参照されてる可能性、改修のみ)→ Money 画面では使わない
- M3 トークンに新規追加(PR-16 で既に必要なものは入っている)
- ハードコード金額(`¥245,000`)
- 装飾的アニメーション(コンフェッティ等)

## Review checklist (Approver)

- 横スクロール: モバイル / デスクトップ両方で snap 動作
- VoiceOver で各カードが読まれるか(`aria-label` 確認)
- 報酬ゼロ円 + 立替ゼロ円のときの表示
- 月切替で「試算中」に自動切替
- Lighthouse a11y スコア 95+

## Reference
- Mock: `frontend/src/pages/MoneyMock.tsx`(`MoneyHeroSection`, `RewardSection`, `ExpenseSection`, `CompanySection`, `ShieldPopover`)
- Mock CSS: `frontend/src/pages/MoneyMock.module.css`(`.carousel`, `.card`, `.cardSelf`, `.companyCard`)
- Memory: `feedback_money_design_principles.md`, `project_member_personal_stake_priority.md`
