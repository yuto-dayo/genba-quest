# Infrastructure Notes

## Month Close Reminder Cron

The GitHub Actions workflow at `.github/workflows/month-close-reminder.yml`
calls the production server endpoint once per day during the monthly close
reminder window.

- Endpoint: `POST /api/v1/path/month/_remind-close`
- Auth: `Authorization: Bearer <CRON_SECRET>`
- Body: `{}`
- Schedule: JST days 1-7 at 00:00, implemented as UTC 15:00 candidate cron
  runs with a JST date guard.
- Manual run: GitHub Actions `workflow_dispatch`.

## Required Secrets

Configure the same `CRON_SECRET` value on both the server runtime and GitHub
Actions.

1. Confirm the production server URL in the Render dashboard.
2. Generate a secret value, for example:

   ```bash
   openssl rand -hex 32
   ```

3. Add `CRON_SECRET` to the server environment.
4. Add these repository secrets under GitHub repository settings:

   - `SERVER_URL`: production server origin, HTTPS only, no required trailing
     slash.
   - `CRON_SECRET`: same value configured on the server.

Do not commit secret values to the repository.

## Operational Notes

- The workflow uses `curl --fail` so non-2xx responses fail the Action and
  surface through GitHub Actions notifications.
- The workflow does not send `{ "force": true }`.
- The workflow does not implement a custom retry loop. Re-run the failed Action
  manually after fixing the cause.
- Secret rotation requires updating the server environment and GitHub Actions
  secret to the same new value.
