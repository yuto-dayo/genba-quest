# Site Level Draft Flow

## Completed

- Replaced the global confirmation bell with unread `site_level_draft` notifications for completed sites.
- Added completed-site participant notifications from `SiteCompletionService` on first completion only.
- Added a site-detail panel for role evidence, self-reported `L1-L5`, and `path.level.update` proposal creation.

## Validation

- `frontend`: `npm test -- App.test.tsx`
- `frontend`: `npm run build`
- `server`: `npm test -- --runTestsByPath src/__tests__/unit/SiteCompletionService.test.ts`
- `server`: `npm run build`
- `git diff --check`
