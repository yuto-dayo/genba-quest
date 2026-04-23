# Architecture Index

`docs/architecture/` は、特定テーマの深掘り設計を置く場所です。
root のコア設計書で扱いきれない領域を、実装できる粒度まで落とします。

## 使い方

- root の設計書で全体像を掴んだあと、個別領域を深掘りするときに読む
- `Spec` は正規フローの定義、`Plan` はその実装差し込み手順として読む
- 重要な判断が固定されたら、必要に応じて ADR と相互参照する

## Documents

| File | Purpose |
| --- | --- |
| `path-v31.md` | PATH V3.1 の制度仕様。post-cutover mainline の正本 |
| `genba-quest-path.md` | PATH v2.2 を proposal / event / policy 主導で統合する vertical slice 設計 |
| `revenue-reward-canonical-flow.md` | revenue / reward 領域の canonical flow 定義 |
| `revenue-reward-ddl-migration-plan.md` | canonical flow を既存 schema / service / route に差し込む移行計画 |

## 関連

- Overview: `docs/README.md`
- Core architecture: `docs/DESIGN_PHILOSOPHY.md`
- Decisions: `docs/adr/`
