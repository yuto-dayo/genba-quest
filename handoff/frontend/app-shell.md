# Frontend App Shell Handoff

## Scope

- app-level navigation and global shell
- shared floating action button behavior
- settings workspace
- LUQO / PATH workspace
- monthly evaluation modal entrypoint

## Current

- `/settings` hosts personal profile, invoice settings, and client master flows.
- `/luqo` hosts LUQO score, reward, and PATH review flows.
- `App.tsx` mounts settings, LUQO, and the month-end form trigger in the global shell.

## Next

- split remaining frontend work into `money`, `today/calendar`, and `sites/communications`
