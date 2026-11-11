BEGIN;

DO $$
DECLARE
  schema_owner TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    SELECT pg_get_userbyid(nspowner) INTO schema_owner FROM pg_namespace WHERE nspname = 'personal';
    IF NOT pg_has_role(current_user, schema_owner, 'MEMBER') THEN
      RAISE EXCEPTION 'apply this migration connected as %, the owner of schema % (you are %)',
        schema_owner, 'personal', current_user;
    END IF;
  END IF;

  /* FORCE ROW LEVEL SECURITY applies to the table owner too, so a definer
   * function only sees every user's settings if its owner bypasses RLS. Say so
   * here, at apply time, instead of letting the hourly cron list nobody. */
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'apply this migration as a role with BYPASSRLS (% has none); the hourly agent listing runs as its owner', current_user;
  END IF;
END $$;

/*
 * The hourly agent cron has to find the opted-in users whose send time has come.
 * agent_settings is FORCE ROW LEVEL SECURITY keyed on app.user_id, so the
 * runtime role cannot list across users, and must not be able to (same pattern
 * as investing.list_broker_sync_tenants in 0022).
 *
 * A function that returns user ids and the message day, nothing else: no
 * settings, no channels, no addresses. A user is due when the agent is on, the
 * local hour is inside the window that starts at send_hour and lasts
 * retry_hours, counted round the clock ((local_hour - send_hour + 24) % 24 <=
 * retry_hours), so send hour 23 is still due at 00:00 and 01:00, and today's
 * message has not been claimed: the claim (agent_state.last_sent_date, see
 * claimDay) only moves forward, so a user is due only while it is before the
 * message day. A changed send hour can therefore never make an older day due.
 *
 * message_day is the local date on which the send hour fell: local_date while
 * local_hour >= send_hour, and the previous date once the window has wrapped
 * past midnight. The claim and the "already sent" test use it, so a retry at
 * 00:30 can only take the day that began the window, never the next one.
 */
DROP FUNCTION IF EXISTS personal.list_agent_due_users(INT, INT, DATE);

CREATE FUNCTION personal.list_agent_due_users(
  local_hour INT, retry_hours INT, local_date DATE
)
RETURNS TABLE (tenant_id TEXT, message_day DATE)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT s.user_id, d.message_day
  FROM personal.agent_settings AS s
  CROSS JOIN LATERAL (
    SELECT CASE WHEN local_hour >= s.send_hour THEN local_date ELSE local_date - 1 END
      AS message_day
  ) AS d
  LEFT JOIN personal.agent_state AS st ON st.user_id = s.user_id
  WHERE s.enabled
    AND ((local_hour - s.send_hour + 24) % 24) <= retry_hours
    AND (st.last_sent_date IS NULL OR st.last_sent_date < d.message_day)
  ORDER BY s.user_id ASC
$$;

REVOKE ALL ON FUNCTION personal.list_agent_due_users(INT, INT, DATE) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    GRANT EXECUTE ON FUNCTION personal.list_agent_due_users(INT, INT, DATE) TO lavega_runtime;
  END IF;
END $$;

COMMIT;
