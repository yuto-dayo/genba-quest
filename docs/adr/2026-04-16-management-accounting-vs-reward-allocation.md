# ADR: Separate Site Item Profit From Reward Allocation

## Status

Accepted

## Context

内装仕上げ業では項目別売上 / 粗利は見積条件・材料比率・外注比率の影響を強く受ける。これをそのまま個人配分へ入れると、職人の責任量や再現性より案件の見積構造が報酬に影響する。

## Decision

- `path_site_item_profit_snapshots` は management accounting 専用
- 個人報酬の variable allocation は `path_work_packages` と `path_work_package_assignments` から計算する
- reward preview は `PackagePoints * ResponsibilityShare * RoleCoeff * QualityGateCoeff` を主入力にする

## Consequences

- 粗利は採算分析・見積改善・工数辞書見直しに使える
- 個人配分は工数 / 難易度 / 責任 / 品質に寄せられる
- クロス中心の単一ロジックから multi-trade に自然に拡張できる
