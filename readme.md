Hello, we are careerly and we are ready to help you land your first job.

## Password reset setup

Add these variables to `backend/.env` for local development. For a deployed app, set them in the backend host's environment and point `FRONTEND_URL` at the deployed frontend.

| Variable | Value |
| --- | --- |
| `FRONTEND_URL` | The frontend origin, such as `http://localhost:5173` for local development or your deployed HTTPS URL |
| `RESEND_API_KEY` | A Resend API key with sending access |
| `PASSWORD_RESET_FROM` | A sender on your verified domain, such as `Careerly <accounts@example.com>` |

For a local email test, use `PASSWORD_RESET_FROM="Careerly <onboarding@resend.dev>"` and a Careerly account registered with the same email as your Resend account. For delivery to other users, verify your own sending domain in Resend and update the sender address.

The backend creates the password reset table on startup. If the database account lacks permission to create tables, run the following SQL in the Careerly Supabase SQL Editor. This uses the account email as the reset key so it does not depend on the type of `users.id`.

```sql
BEGIN;
CREATE TABLE IF NOT EXISTS public.password_resets (
  email varchar(255) PRIMARY KEY,
  token_digest varchar(64) NOT NULL,
  expires_at timestamp(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS password_resets_token_digest_key
  ON public.password_resets (token_digest);
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;
COMMIT;
```

## Signup email verification

Signup uses the same backend email settings as password reset. The signup form requests a link, and the recipient chooses their name and password after opening it. The account is created only after completion. Existing accounts can still sign in.

The backend creates the verification table automatically on startup using a targeted transaction. If the database account lacks permission, the backend logs the failure and you can apply this setup in the Careerly project's Supabase SQL Editor.

```sql
BEGIN;
CREATE TABLE IF NOT EXISTS public.pending_signups (
  email varchar(255) PRIMARY KEY,
  token_digest varchar(64) NOT NULL,
  expires_at timestamp(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pending_signups_token_digest_key
  ON public.pending_signups (token_digest);
ALTER TABLE public.pending_signups ENABLE ROW LEVEL SECURITY;
COMMIT;
```

Regenerate Prisma Client with `npx prisma generate` and restart the backend after applying the schema. Test from **Sign up** with an inbox that does not already have a Careerly account.
