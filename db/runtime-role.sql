-- Execute once as Neon owner. Use DATABASE_URL_RUNTIME for application traffic.
-- Keep owner and runtime credentials separate.
CREATE ROLE lavega_runtime LOGIN PASSWORD 'REPLACE_WITH_SECRET';
GRANT USAGE ON SCHEMA public, personal, investing TO lavega_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."user", public.session, public.account, public.verification TO lavega_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON personal.vaults, investing.broker_vaults, investing.price_bars, investing.preferences, investing.sync_state, investing.agent_runs TO lavega_runtime;
