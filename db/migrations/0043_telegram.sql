-- Telegram is an optional, app-side bridge. No credentials, links, or conversations are records.
CREATE TABLE public.telegram_bots (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  bot_id text NOT NULL UNIQUE,
  username text NOT NULL,
  token_ciphertext bytea NOT NULL,
  webhook_secret_hash text NOT NULL,
  ready boolean NOT NULL DEFAULT false,
  chat_id text,
  chat_title text,
  chat_type text CHECK (chat_type IN ('group','supergroup','channel')),
  thread_id integer,
  pending_chat jsonb,
  pairing_hash text,
  pairing_expires_at timestamptz,
  announcements boolean NOT NULL DEFAULT false,
  announcements_since timestamptz,
  ask_enabled boolean NOT NULL DEFAULT false,
  group_answers boolean NOT NULL DEFAULT true,
  daily_limit integer NOT NULL DEFAULT 100 CHECK (daily_limit BETWEEN 1 AND 1000),
  configured_by uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.telegram_links (
  event_id uuid NOT NULL REFERENCES public.telegram_bots(event_id) ON DELETE CASCADE,
  telegram_user_id text NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  private_chat_id text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, telegram_user_id),
  UNIQUE (event_id, account_id)
);
CREATE TABLE public.telegram_link_tokens (
  token_hash text PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.telegram_bots(event_id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  UNIQUE (event_id, account_id)
);
CREATE TABLE public.telegram_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.telegram_bots(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('announcement','retract','question','notice')),
  update_id bigint,
  feed_post_id uuid REFERENCES public.feed_posts(id) ON DELETE CASCADE,
  chat_id text NOT NULL,
  thread_id integer,
  reply_to integer,
  source_chat_id text,
  source_thread_id integer,
  parent_id uuid UNIQUE REFERENCES public.telegram_jobs(id) ON DELETE CASCADE,
  telegram_user_id text,
  account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  question_ciphertext bytea,
  response_ciphertext bytea,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','sending','sent','failed','uncertain','skipped')),
  message_id bigint,
  attempts integer NOT NULL DEFAULT 0,
  error text,
  run_after timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, update_id),
  UNIQUE (connection_id, kind, feed_post_id)
);
CREATE INDEX telegram_jobs_due ON public.telegram_jobs(run_after) WHERE status='queued';
CREATE TABLE public.telegram_budgets (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  scope text NOT NULL,
  window_start timestamptz NOT NULL,
  used integer NOT NULL DEFAULT 1,
  PRIMARY KEY(event_id,scope,window_start)
);
ALTER TABLE public.telegram_bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_link_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_bots, public.telegram_links, public.telegram_link_tokens, public.telegram_jobs, public.telegram_budgets FROM anon, authenticated;
COMMENT ON TABLE public.telegram_jobs IS 'Durable Telegram outbox. Questions and answers are sealed; cleared after delivery and purged within 24h. Ambiguous sends are never automatically repeated.';
