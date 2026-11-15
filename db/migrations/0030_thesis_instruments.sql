BEGIN;

DO $$
DECLARE
  schema_owner TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    SELECT pg_get_userbyid(nspowner) INTO schema_owner FROM pg_namespace WHERE nspname = 'investing';
    IF NOT pg_has_role(current_user, schema_owner, 'MEMBER') THEN
      RAISE EXCEPTION 'apply this migration connected as %, the owner of schema % (you are %)',
        schema_owner, 'investing', current_user;
    END IF;
  END IF;
END $$;

/*
 * Thesis identity moves from the broker symbol to the canonical instrument key
 * (plan §3 WS4.5, #297; ADR 0007's follow-up).
 *
 * `instrument_key` is the ISIN-first key from `packages/core/src/investing/
 * securities.ts` (`isin:...`, else `sym:TICKER@MIC`, else `sym:TICKER`). It is
 * nullable: a thesis whose symbol the broker snapshot cannot place keeps a null
 * key and is left alone.
 *
 * `review_required` marks a group of confirmed theses that resolve to ONE
 * instrument but disagree. The migration never chooses between them, so both
 * rows stay and the owner resolves the group. The partial unique index enforces
 * one thesis per canonical key only for groups that are not under review: that
 * is what makes "one instrument, one thesis key" a database fact without ever
 * deleting a confirmed claim.
 *
 * The primary key stays `(user_id, symbol)`. The symbol remains the row's
 * stable handle for edit and delete; the canonical key is the identity the
 * agent reads by.
 */
ALTER TABLE investing.theses
  ADD COLUMN IF NOT EXISTS instrument_key TEXT;

ALTER TABLE investing.theses
  ADD COLUMN IF NOT EXISTS review_required BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE investing.theses
  DROP CONSTRAINT IF EXISTS theses_instrument_key_normalized;
ALTER TABLE investing.theses
  ADD CONSTRAINT theses_instrument_key_normalized
    CHECK (instrument_key IS NULL OR (instrument_key <> '' AND instrument_key = btrim(instrument_key)));

CREATE UNIQUE INDEX IF NOT EXISTS theses_instrument_key_unique
  ON investing.theses (user_id, instrument_key)
  WHERE instrument_key IS NOT NULL AND NOT review_required;

COMMIT;
