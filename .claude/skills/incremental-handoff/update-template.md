# Incremental Update Entry Template

## Entry Format

- Entry-ID: `H{{SEQUENCE_4DIGIT}}`
- Completed:
  - [x] {{WHAT_DONE}}（{{WHY_OR_SCOPE}}）
- Remaining:
  - [ ] {{NEXT_P0}}
- Changed Files:
  - `{{FILE_PATH}}` - {{SEMANTIC_DESCRIPTION}}
- Working Context:
  - {{PATTERN_OR_ASSUMPTION}}
- Validation:
  - `{{COMMAND}}` → {{PASS_FAIL_SKIP}} ({{DETAIL}})
- Landmines:
  - {{GOTCHA_OR_NONE}}
- Note:
  - {{HANDOFF_NOTE}}

## Layer Sync (Automatic)

- L1: Session Summary (3-7 lines) is regenerated from latest entries with Entry-ID references.
- L2: Decisions / Landmines / Open Threads are regenerated from context + landmine + remaining with Entry-ID references.
- L3: When entry count exceeds threshold, older entries are compacted into `.session/handoff_archive/`.
- `--context` 未指定時: `--done` から `Auto-captured decision` を生成。
- `--landmine` 未指定時: validation を参照して Landmine を自動補完。

### Changed Files 記述ルール

- "updated" / "modified" / "changed" は禁止（情報量ゼロ）
- 「何が・なぜ」を書く
- 良い例: `approve()にatomic RPC優先パスを追加`
- 悪い例: `updated in this step`
