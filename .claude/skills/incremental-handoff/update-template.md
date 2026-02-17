# Incremental Update Entry Template

## Entry Format

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

### Changed Files 記述ルール

- "updated" / "modified" / "changed" は禁止（情報量ゼロ）
- 「何が・なぜ」を書く
- 良い例: `approve()にatomic RPC優先パスを追加`
- 悪い例: `updated in this step`
