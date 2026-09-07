BEGIN;

/*
 * Enable Banking's authorisation flow, moved out of process memory.
 *
 * Both stores were module-scope `Map`s in `apps/server/src/eb-routes.ts`. That
 * held on Railway, which ran one long-lived container. It cannot hold on
 * Vercel: `/api/eb/auth` may set the state in one function instance and the
 * bank's redirect to `/api/eb/callback` may land on another, where the Map is
 * empty. The flow would fail on the first real bank connection.
 */

/*
 * The pending authorisation. Deliberately WITHOUT row-level security.
 *
 * The callback is a cross-site redirect arriving from the bank, so it cannot be
 * relied on to carry a session cookie — `SameSite` behaviour across that hop is
 * not ours to control, and a flow that breaks on a browser default is worse
 * than one that does not depend on it. The row's own key is the credential: an
 * unguessable server-issued UUID, used once, valid for minutes. It names the
 * user it belongs to, and that is where identity comes back from.
 *
 * Nothing financial lives here — a bank name, a country, and who started it.
 */
CREATE TABLE IF NOT EXISTS personal.eb_pending_auth (
  state TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  aspsp_name TEXT NOT NULL,
  aspsp_country TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT eb_pending_auth_state_not_blank CHECK (btrim(state) <> ''),
  CONSTRAINT eb_pending_auth_user_id_not_blank CHECK (btrim(user_id) <> '')
);

CREATE INDEX IF NOT EXISTS eb_pending_auth_created_at_idx
  ON personal.eb_pending_auth (created_at);

/*
 * The exchanged session: the account list the bank returned, waiting for the
 * app to collect it. This one DOES hold personal data (account identifiers),
 * so it is encrypted with the server's key and scoped by RLS. The server has to
 * read it — it calls Enable Banking per account — so this cannot be sealed the
 * way the personal vault is.
 */
CREATE TABLE IF NOT EXISTS personal.eb_sessions (
  session_id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  payload_blob BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT eb_sessions_session_id_not_blank CHECK (btrim(session_id) <> ''),
  CONSTRAINT eb_sessions_user_id_not_blank CHECK (btrim(user_id) <> ''),
  CONSTRAINT eb_sessions_payload_not_empty CHECK (octet_length(payload_blob) > 0)
);

CREATE INDEX IF NOT EXISTS eb_sessions_created_at_idx
  ON personal.eb_sessions (created_at);

ALTER TABLE personal.eb_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'personal'
      AND tablename = 'eb_sessions'
      AND policyname = 'eb_sessions_user_access'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY eb_sessions_user_access ON personal.eb_sessions
        FOR ALL TO PUBLIC
        USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
        WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''))
    $sql$;
  END IF;
END
$$;

COMMIT;
