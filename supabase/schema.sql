-- =============================================================================
-- VAGACOIN (VGC) — PRODUCTION POSTGRESQL LEDGER & TREASURY SCHEMA
-- Stack: Supabase (PostgreSQL 15+, Auth, Storage, Realtime, pgcrypto)
-- Peg: 1 VGC = 1 PKR (configurable in group_settings.peg)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- 3.1 ENUMS
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.tx_type AS ENUM ('MINT', 'TRADE', 'BURN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.claim_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.escrow_status AS ENUM ('OPEN', 'LOCKED', 'SETTLED', 'CANCELLED', 'DISPUTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.request_kind AS ENUM ('REQUEST', 'REVERSAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.request_status AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.burn_kind AS ENUM ('CASHOUT', 'GROUP_EXPENSE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.split_status AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.share_status AS ENUM ('PENDING', 'PAID', 'DECLINED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- 3.2 TABLES
-- -----------------------------------------------------------------------------

-- Singleton group settings table
CREATE TABLE IF NOT EXISTS public.group_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  group_name text NOT NULL DEFAULT 'Vagafund Committee',
  currency text NOT NULL DEFAULT 'PKR' CHECK (currency = 'PKR'),
  peg bigint NOT NULL DEFAULT 1 CHECK (peg > 0 AND peg <= 10000),
  monthly_contribution bigint NOT NULL DEFAULT 2000 CHECK (monthly_contribution > 0 AND monthly_contribution <= 10000000),
  burn_approvals_required int NOT NULL DEFAULT 2 CHECK (burn_approvals_required >= 1 AND burn_approvals_required <= 20),
  rollover_mode text NOT NULL DEFAULT 'CONTINUOUS' CHECK (rollover_mode IN ('CONTINUOUS', 'MONTHLY_RESET')),
  reversal_window_hours int NOT NULL DEFAULT 48 CHECK (reversal_window_hours >= 1 AND reversal_window_hours <= 720),
  invite_code text NOT NULL DEFAULT 'VAGA2026',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed singleton group_settings row (change invite_code 'VAGA2026' after setup)
INSERT INTO public.group_settings (id, group_name, currency, peg, monthly_contribution, burn_approvals_required, rollover_mode, reversal_window_hours, invite_code)
VALUES (true, 'Vagafund Committee', 'PKR', 1, 2000, 2, 'CONTINUOUS', 48, 'VAGA2026')
ON CONFLICT (id) DO NOTHING;

-- Member profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (char_length(trim(full_name)) >= 2),
  avatar_url text,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Private user secrets (PIN hashes & lockout counters; strictly inaccessible to client roles)
CREATE TABLE IF NOT EXISTS public.user_secrets (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  pin_hash text,
  failed_attempts int NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only ledger transactions
CREATE TABLE IF NOT EXISTS public.ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_kind public.tx_type NOT NULL,
  sender_id uuid REFERENCES public.profiles(id),
  receiver_id uuid REFERENCES public.profiles(id),
  amount bigint NOT NULL CHECK (amount > 0 AND amount <= 10000000),
  month_tag text CHECK (month_tag IS NULL OR month_tag ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  note text NOT NULL DEFAULT '',
  ref_type text,
  ref_id uuid,
  idempotency_key uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_tx_shape_check CHECK (
    (tx_kind = 'MINT'  AND sender_id IS NULL     AND receiver_id IS NOT NULL AND month_tag IS NOT NULL) OR
    (tx_kind = 'TRADE' AND sender_id IS NOT NULL AND receiver_id IS NOT NULL AND sender_id <> receiver_id AND month_tag IS NULL) OR
    (tx_kind = 'BURN'  AND sender_id IS NOT NULL AND receiver_id IS NULL     AND month_tag IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_monthly_deposit
  ON public.ledger_transactions (receiver_id, month_tag)
  WHERE tx_kind = 'MINT';

CREATE INDEX IF NOT EXISTS idx_ledger_sender_id ON public.ledger_transactions (sender_id);
CREATE INDEX IF NOT EXISTS idx_ledger_receiver_id ON public.ledger_transactions (receiver_id);
CREATE INDEX IF NOT EXISTS idx_ledger_created_at ON public.ledger_transactions (created_at DESC);

-- Monthly fiat deposit claims
CREATE TABLE IF NOT EXISTS public.deposit_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  amount bigint NOT NULL CHECK (amount > 0 AND amount <= 10000000),
  month_tag text NOT NULL CHECK (month_tag ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  receipt_url text NOT NULL,
  reference_no text NOT NULL,
  status public.claim_status NOT NULL DEFAULT 'PENDING',
  reviewed_by uuid REFERENCES public.profiles(id),
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_active_deposit_claim
  ON public.deposit_claims (user_id, month_tag)
  WHERE status IN ('PENDING', 'APPROVED');

-- Cash-out and group-expense burn requests
CREATE TABLE IF NOT EXISTS public.burn_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES public.profiles(id),
  amount bigint NOT NULL CHECK (amount > 0 AND amount <= 10000000),
  reason text NOT NULL,
  kind public.burn_kind NOT NULL DEFAULT 'CASHOUT',
  approvals uuid[] NOT NULL DEFAULT '{}',
  status public.claim_status NOT NULL DEFAULT 'PENDING',
  review_note text,
  executed_tx_id uuid REFERENCES public.ledger_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Splitwise-style bill splits
CREATE TABLE IF NOT EXISTS public.split_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES public.profiles(id),
  title text NOT NULL,
  total_amount bigint NOT NULL CHECK (total_amount > 0 AND total_amount <= 10000000),
  include_creator boolean NOT NULL DEFAULT true,
  status public.split_status NOT NULL DEFAULT 'OPEN',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.split_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  split_id uuid NOT NULL REFERENCES public.split_requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  share_amount bigint NOT NULL CHECK (share_amount > 0 AND share_amount <= 10000000),
  status public.share_status NOT NULL DEFAULT 'PENDING',
  paid_tx_id uuid REFERENCES public.ledger_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (split_id, user_id)
);

-- 1v1 Match Escrow
CREATE TABLE IF NOT EXISTS public.escrow_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES public.profiles(id),
  opponent_id uuid NOT NULL REFERENCES public.profiles(id),
  wager_amount bigint NOT NULL CHECK (wager_amount > 0 AND wager_amount <= 10000000),
  title text NOT NULL,
  status public.escrow_status NOT NULL DEFAULT 'OPEN',
  winner_id uuid REFERENCES public.profiles(id),
  creator_report uuid REFERENCES public.profiles(id),
  opponent_report uuid REFERENCES public.profiles(id),
  creator_cancel boolean NOT NULL DEFAULT false,
  opponent_cancel boolean NOT NULL DEFAULT false,
  settled_tx_id uuid REFERENCES public.ledger_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT escrow_distinct_players CHECK (creator_id <> opponent_id)
);

-- Payment requests & trade reversal requests
CREATE TABLE IF NOT EXISTS public.payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind public.request_kind NOT NULL DEFAULT 'REQUEST',
  requester_id uuid NOT NULL REFERENCES public.profiles(id),
  payer_id uuid NOT NULL REFERENCES public.profiles(id),
  amount bigint NOT NULL CHECK (amount > 0 AND amount <= 10000000),
  note text NOT NULL DEFAULT '',
  related_tx_id uuid REFERENCES public.ledger_transactions(id),
  status public.request_status NOT NULL DEFAULT 'PENDING',
  response_tx_id uuid REFERENCES public.ledger_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_request_distinct_parties CHECK (requester_id <> payer_id)
);

-- Real-world bank / EasyPaisa cash reconciliations
CREATE TABLE IF NOT EXISTS public.fund_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recorded_by uuid NOT NULL REFERENCES public.profiles(id),
  bank_balance_pkr bigint NOT NULL CHECK (bank_balance_pkr >= 0),
  expected_pkr bigint NOT NULL,
  variance_pkr bigint NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- In-app notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  kind text NOT NULL DEFAULT 'INFO',
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, is_read, created_at DESC);

-- Admin audit log
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  action text NOT NULL,
  target_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 3.3 TRIGGERS & SIGNUP GATING
-- -----------------------------------------------------------------------------

-- Immutability trigger on ledger_transactions
CREATE OR REPLACE FUNCTION public.ledger_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'LEDGER_IMMUTABLE: ledger_transactions is append-only; UPDATE, DELETE, and TRUNCATE are forbidden.';
END;
$$;

DROP TRIGGER IF EXISTS trg_ledger_no_update_delete ON public.ledger_transactions;
CREATE TRIGGER trg_ledger_no_update_delete
  BEFORE UPDATE OR DELETE ON public.ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION public.ledger_immutable();

DROP TRIGGER IF EXISTS trg_ledger_no_truncate ON public.ledger_transactions;
CREATE TRIGGER trg_ledger_no_truncate
  BEFORE TRUNCATE ON public.ledger_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION public.ledger_immutable();

-- Signup trigger gating by invite_code and assigning first user as admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_expected_code text;
  v_supplied_code text;
  v_full_name text;
  v_profile_count int;
  v_role text;
BEGIN
  SELECT invite_code INTO v_expected_code FROM public.group_settings WHERE id = true;
  v_supplied_code := trim(COALESCE(NEW.raw_user_meta_data->>'invite_code', ''));

  IF v_expected_code IS NOT NULL AND v_supplied_code <> v_expected_code THEN
    RAISE EXCEPTION 'INVALID_INVITE_CODE: A valid group invite code is required to join Vagacoin.';
  END IF;

  v_full_name := trim(COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)));
  IF char_length(v_full_name) < 2 THEN
    v_full_name := 'Member';
  END IF;

  LOCK TABLE public.profiles IN EXCLUSIVE MODE;
  SELECT count(*) INTO v_profile_count FROM public.profiles;
  IF v_profile_count = 0 THEN
    v_role := 'admin';
  ELSE
    v_role := 'member';
  END IF;

  INSERT INTO public.profiles (id, full_name, role, is_active)
  VALUES (NEW.id, v_full_name, v_role, true);

  INSERT INTO public.user_secrets (user_id, pin_hash, failed_attempts)
  VALUES (NEW.id, NULL, 0);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 3.4 VIEWS
-- Note: Views run with definer privileges by default in Postgres (security_invoker
-- is NOT enabled) intentionally so they can aggregate across all users' escrow
-- matches, burn requests, and deposit claims that row-level RLS on underlying
-- tables would otherwise hide from non-admin members.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.wallet_balances AS
WITH rx AS (
  SELECT receiver_id AS user_id, COALESCE(SUM(amount), 0)::bigint AS total_received
  FROM public.ledger_transactions
  WHERE tx_kind IN ('MINT', 'TRADE') AND receiver_id IS NOT NULL
  GROUP BY receiver_id
),
tx AS (
  SELECT sender_id AS user_id, COALESCE(SUM(amount), 0)::bigint AS total_sent
  FROM public.ledger_transactions
  WHERE tx_kind IN ('TRADE', 'BURN') AND sender_id IS NOT NULL
  GROUP BY sender_id
),
esc AS (
  SELECT user_id, COALESCE(SUM(wager_amount), 0)::bigint AS locked_in_escrow
  FROM (
    SELECT creator_id AS user_id, wager_amount
    FROM public.escrow_matches
    WHERE status IN ('OPEN', 'LOCKED', 'DISPUTED')
    UNION ALL
    SELECT opponent_id AS user_id, wager_amount
    FROM public.escrow_matches
    WHERE status IN ('LOCKED', 'DISPUTED')
  ) e
  GROUP BY user_id
),
brn AS (
  SELECT requester_id AS user_id, COALESCE(SUM(amount), 0)::bigint AS reserved_for_burn
  FROM public.burn_requests
  WHERE status = 'PENDING'
  GROUP BY requester_id
)
SELECT
  p.id AS user_id,
  p.full_name,
  p.role,
  p.is_active,
  COALESCE(rx.total_received, 0)::bigint AS total_received,
  COALESCE(tx.total_sent, 0)::bigint AS total_sent,
  (COALESCE(rx.total_received, 0) - COALESCE(tx.total_sent, 0))::bigint AS ledger_balance,
  COALESCE(esc.locked_in_escrow, 0)::bigint AS locked_in_escrow,
  COALESCE(brn.reserved_for_burn, 0)::bigint AS reserved_for_burn,
  (COALESCE(rx.total_received, 0) - COALESCE(tx.total_sent, 0) - COALESCE(esc.locked_in_escrow, 0) - COALESCE(brn.reserved_for_burn, 0))::bigint AS available_vgc_balance
FROM public.profiles p
LEFT JOIN rx ON rx.user_id = p.id
LEFT JOIN tx ON tx.user_id = p.id
LEFT JOIN esc ON esc.user_id = p.id
LEFT JOIN brn ON brn.user_id = p.id;

CREATE OR REPLACE VIEW public.vagafund_summary AS
WITH totals AS (
  SELECT
    COALESCE(SUM(CASE WHEN tx_kind = 'MINT' THEN amount ELSE 0 END), 0)::bigint AS total_minted,
    COALESCE(SUM(CASE WHEN tx_kind = 'BURN' THEN amount ELSE 0 END), 0)::bigint AS total_burned
  FROM public.ledger_transactions
),
bals AS (
  SELECT
    COALESCE(SUM(ledger_balance), 0)::bigint AS sum_of_user_balances,
    COALESCE(MIN(available_vgc_balance), 0)::bigint AS min_available_balance
  FROM public.wallet_balances
),
claims AS (
  SELECT COALESCE(SUM(amount), 0)::bigint AS approved_claims_vgc
  FROM public.deposit_claims
  WHERE status = 'APPROVED'
),
cfg AS (
  SELECT peg FROM public.group_settings WHERE id = true
),
last_rec AS (
  SELECT bank_balance_pkr
  FROM public.fund_reconciliations
  ORDER BY created_at DESC
  LIMIT 1
)
SELECT
  t.total_minted,
  t.total_burned,
  (t.total_minted - t.total_burned)::bigint AS active_vgc_supply,
  b.sum_of_user_balances,
  ((c.approved_claims_vgc - t.total_burned) * cfg.peg)::bigint AS fund_cash_pkr,
  lr.bank_balance_pkr AS last_bank_balance_pkr,
  CASE
    WHEN lr.bank_balance_pkr IS NULL THEN NULL
    ELSE (lr.bank_balance_pkr - ((c.approved_claims_vgc - t.total_burned) * cfg.peg))::bigint
  END AS bank_variance_pkr,
  ((t.total_minted - t.total_burned) = b.sum_of_user_balances AND b.min_available_balance >= 0) AS is_ledger_synced
FROM totals t
CROSS JOIN bals b
CROSS JOIN claims c
CROSS JOIN cfg
LEFT JOIN last_rec lr ON true;

CREATE OR REPLACE VIEW public.monthly_deposit_status AS
WITH cur AS (
  SELECT to_char(now(), 'YYYY-MM') AS month_tag
)
SELECT
  p.id AS user_id,
  p.full_name,
  p.is_active,
  cur.month_tag,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM public.ledger_transactions lt
      WHERE lt.tx_kind = 'MINT' AND lt.receiver_id = p.id AND lt.month_tag = cur.month_tag
    ) THEN 'MINTED'
    WHEN EXISTS (
      SELECT 1 FROM public.deposit_claims dc
      WHERE dc.user_id = p.id AND dc.month_tag = cur.month_tag AND dc.status = 'PENDING'
    ) THEN 'PENDING'
    ELSE 'NOT_PAID'
  END AS status
FROM public.profiles p
CROSS JOIN cur;

-- -----------------------------------------------------------------------------
-- 3.5 RPC FUNCTIONS
-- -----------------------------------------------------------------------------

-- 21a. Golden Invariant Assertion (internal helper; raises exception to rollback on violation)
CREATE OR REPLACE FUNCTION public.assert_golden_invariant()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_minted bigint;
  v_burned bigint;
  v_supply bigint;
  v_sum_balances bigint;
  v_min_available bigint;
  v_min_ledger bigint;
BEGIN
  SELECT total_minted, total_burned, active_vgc_supply, sum_of_user_balances
  INTO v_minted, v_burned, v_supply, v_sum_balances
  FROM public.vagafund_summary;

  SELECT COALESCE(MIN(available_vgc_balance), 0), COALESCE(MIN(ledger_balance), 0)
  INTO v_min_available, v_min_ledger
  FROM public.wallet_balances;

  IF v_supply <> v_sum_balances THEN
    RAISE EXCEPTION 'GOLDEN_INVARIANT_VIOLATION: Supply (%) does not equal sum of user balances (%).', v_supply, v_sum_balances;
  END IF;

  IF v_min_ledger < 0 OR v_min_available < 0 THEN
    RAISE EXCEPTION 'GOLDEN_INVARIANT_VIOLATION: Negative balance detected (min_ledger=%, min_available=%).', v_min_ledger, v_min_available;
  END IF;
END;
$$;

-- Internal PIN verification helper (updates user_secrets without raising so failed attempts persist)
CREATE OR REPLACE FUNCTION public._verify_user_pin(p_user_id uuid, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_secret public.user_secrets%ROWTYPE;
  v_remaining int;
BEGIN
  SELECT * INTO v_secret FROM public.user_secrets WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_secret.pin_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PIN_NOT_SET', 'message', 'Please set up your 4-digit security PIN first.');
  END IF;

  IF v_secret.locked_until IS NOT NULL AND v_secret.locked_until > now() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'PIN_LOCKED',
      'locked_until', v_secret.locked_until,
      'message', 'PIN locked due to multiple failed attempts. Try again after ' || to_char(v_secret.locked_until, 'HH24:MI:SS') || '.'
    );
  END IF;

  IF p_pin IS NULL OR v_secret.pin_hash <> extensions.crypt(p_pin, v_secret.pin_hash) THEN
    v_secret.failed_attempts := v_secret.failed_attempts + 1;
    IF v_secret.failed_attempts >= 5 THEN
      v_secret.locked_until := now() + interval '15 minutes';
      v_secret.failed_attempts := 0;
      UPDATE public.user_secrets
      SET failed_attempts = v_secret.failed_attempts,
          locked_until = v_secret.locked_until,
          updated_at = now()
      WHERE user_id = p_user_id;
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'PIN_LOCKED',
        'locked_until', v_secret.locked_until,
        'message', 'Too many wrong PIN attempts. Account locked for 15 minutes.'
      );
    ELSE
      v_remaining := 5 - v_secret.failed_attempts;
      UPDATE public.user_secrets
      SET failed_attempts = v_secret.failed_attempts,
          locked_until = NULL,
          updated_at = now()
      WHERE user_id = p_user_id;
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'INVALID_PIN',
        'remaining_attempts', v_remaining,
        'message', 'Incorrect PIN (' || v_remaining || ' attempt(s) remaining before 15-min lockout).'
      );
    END IF;
  END IF;

  IF v_secret.failed_attempts > 0 OR v_secret.locked_until IS NOT NULL THEN
    UPDATE public.user_secrets
    SET failed_attempts = 0, locked_until = NULL, updated_at = now()
    WHERE user_id = p_user_id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Helper to check if current user has a PIN configured
CREATE OR REPLACE FUNCTION public.has_pin_set()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_hash text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED', 'message', 'Not logged in.');
  END IF;
  SELECT pin_hash INTO v_hash FROM public.user_secrets WHERE user_id = v_uid;
  RETURN jsonb_build_object('ok', true, 'has_pin', (v_hash IS NOT NULL));
END;
$$;

-- 1. set_pin
CREATE OR REPLACE FUNCTION public.set_pin(p_new_pin text, p_old_pin text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_secret public.user_secrets%ROWTYPE;
  v_verify jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED', 'message', 'Authentication required.');
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND OR NOT v_profile.is_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INACTIVE_USER', 'message', 'Your account is inactive.');
  END IF;

  IF p_new_pin IS NULL OR p_new_pin !~ '^\d{4}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PIN_FORMAT', 'message', 'PIN must be exactly 4 digits (0-9).');
  END IF;

  SELECT * INTO v_secret FROM public.user_secrets WHERE user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.user_secrets (user_id, pin_hash, failed_attempts)
    VALUES (v_uid, extensions.crypt(p_new_pin, extensions.gen_salt('bf')), 0);
    RETURN jsonb_build_object('ok', true, 'message', 'Security PIN configured.');
  END IF;

  IF v_secret.pin_hash IS NOT NULL THEN
    v_verify := public._verify_user_pin(v_uid, p_old_pin);
    IF NOT (v_verify->>'ok')::boolean THEN
      RETURN v_verify;
    END IF;
  END IF;

  UPDATE public.user_secrets
  SET pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf')),
      failed_attempts = 0,
      locked_until = NULL,
      updated_at = now()
  WHERE user_id = v_uid;

  RETURN jsonb_build_object('ok', true, 'message', 'Security PIN updated.');
END;
$$;

-- 2. trade_vagacoin
CREATE OR REPLACE FUNCTION public.trade_vagacoin(
  p_receiver_id uuid,
  p_amount bigint,
  p_note text,
  p_pin text,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sender public.profiles%ROWTYPE;
  v_receiver public.profiles%ROWTYPE;
  v_existing_tx public.ledger_transactions%ROWTYPE;
  v_pin_check jsonb;
  v_available bigint;
  v_tx_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED', 'message', 'Authentication required.');
  END IF;

  IF p_receiver_id IS NULL OR p_receiver_id = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_RECEIVER', 'message', 'Choose an active friend other than yourself.');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 10000000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT', 'message', 'Amount must be a positive whole number up to 10,000,000 VGC.');
  END IF;

  -- Lock involved profiles in deterministic UUID order to prevent deadlocks
  PERFORM 1 FROM public.profiles WHERE id = ANY(ARRAY[v_uid, p_receiver_id]) ORDER BY id FOR UPDATE;

  SELECT * INTO v_sender FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND OR NOT v_sender.is_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INACTIVE_SENDER', 'message', 'Your profile is not active.');
  END IF;

  SELECT * INTO v_receiver FROM public.profiles WHERE id = p_receiver_id;
  IF NOT FOUND OR NOT v_receiver.is_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INACTIVE_RECEIVER', 'message', 'Recipient profile is not active.');
  END IF;

  -- Check idempotency key before PIN/insert
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_tx FROM public.ledger_transactions WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'duplicate', true, 'tx_id', v_existing_tx.id, 'message', 'Transfer already processed.');
    END IF;
  END IF;

  -- Verify PIN
  v_pin_check := public._verify_user_pin(v_uid, p_pin);
  IF NOT (v_pin_check->>'ok')::boolean THEN
    RETURN v_pin_check;
  END IF;

  -- Re-check available balance after profile lock
  SELECT available_vgc_balance INTO v_available FROM public.wallet_balances WHERE user_id = v_uid;
  IF COALESCE(v_available, 0) < p_amount THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'INSUFFICIENT_BALANCE',
      'message', 'Insufficient available VGC balance (Available: ' || COALESCE(v_available, 0) || ' VGC).'
    );
  END IF;

  INSERT INTO public.ledger_transactions (tx_kind, sender_id, receiver_id, amount, note, ref_type, idempotency_key)
  VALUES ('TRADE', v_uid, p_receiver_id, p_amount, COALESCE(NULLIF(trim(p_note), ''), 'P2P Transfer'), 'P2P', p_idempotency_key)
  RETURNING id INTO v_tx_id;

  INSERT INTO public.notifications (user_id, title, body, kind)
  VALUES (
    p_receiver_id,
    'Received ' || p_amount || ' VGC',
    v_sender.full_name || ' sent you ' || p_amount || ' VGC (' || COALESCE(NULLIF(trim(p_note), ''), 'P2P Transfer') || ').',
    'TRADE'
  );

  PERFORM public.assert_golden_invariant();

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'tx_id', v_tx_id, 'message', 'Sent ' || p_amount || ' VGC to ' || v_receiver.full_name || '.');
END;
$$;

-- 3. create_payment_request
CREATE OR REPLACE FUNCTION public.create_payment_request(p_payer_id uuid, p_amount bigint, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_requester public.profiles%ROWTYPE;
  v_payer public.profiles%ROWTYPE;
  v_req_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED', 'message', 'Authentication required.');
  END IF;

  IF p_payer_id IS NULL OR p_payer_id = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PAYER', 'message', 'Select another active member to request VGC from.');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 10000000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT', 'message', 'Amount must be between 1 and 10,000,000 VGC.');
  END IF;

  SELECT * INTO v_requester FROM public.profiles WHERE id = v_uid;
  SELECT * INTO v_payer FROM public.profiles WHERE id = p_payer_id;

  IF NOT FOUND OR NOT v_requester.is_active OR NOT v_payer.is_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INACTIVE_USER', 'message', 'Both members must be active.');
  END IF;

  INSERT INTO public.payment_requests (kind, requester_id, payer_id, amount, note, status)
  VALUES ('REQUEST', v_uid, p_payer_id, p_amount, COALESCE(NULLIF(trim(p_note), ''), 'Payment request'), 'PENDING')
  RETURNING id INTO v_req_id;

  INSERT INTO public.notifications (user_id, title, body, kind)
  VALUES (
    p_payer_id,
    'VGC Request from ' || v_requester.full_name,
    v_requester.full_name || ' requested ' || p_amount || ' VGC: ' || COALESCE(NULLIF(trim(p_note), ''), 'Payment request'),
    'REQUEST'
  );

  PERFORM public.assert_golden_invariant();
  RETURN jsonb_build_object('ok', true, 'request_id', v_req_id, 'message', 'Requested ' || p_amount || ' VGC from ' || v_payer.full_name || '.');
END;
$$;

-- 4. request_reversal
CREATE OR REPLACE FUNCTION public.request_reversal(p_tx_id uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tx public.ledger_transactions%ROWTYPE;
  v_window_hours int;
  v_sender_name text;
  v_req_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED', 'message', 'Authentication required.');
  END IF;

  SELECT * INTO v_tx FROM public.ledger_transactions WHERE id = p_tx_id;
  IF NOT FOUND OR v_tx.tx_kind <> 'TRADE' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TX_NOT_FOUND', 'message', 'Only P2P TRADE transactions can be reversed.');
  END IF;

  IF v_tx.sender_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_SENDER', 'message', 'Only the original sender of a trade can request a reversal.');
  END IF;

  SELECT reversal_window_hours INTO v_window_hours FROM public.group_settings WHERE id = true;
  IF v_tx.created_at < now() - make_interval(hours => COALESCE(v_window_hours, 48)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'WINDOW_EXPIRED', 'message', 'Reversal window (' || COALESCE(v_window_hours, 48) || 'h) has expired for this trade.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_requests
    WHERE related_tx_id = p_tx_id AND kind = 'REVERSAL' AND status IN ('PENDING', 'ACCEPTED')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'REVERSAL_EXISTS', 'message', 'A reversal request already exists for this transaction.');
  END IF;

  SELECT full_name INTO v_sender_name FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.payment_requests (kind, requester_id, payer_id, amount, note, related_tx_id, status)
  VALUES (
    'REVERSAL',
    v_uid,
    v_tx.receiver_id,
    v_tx.amount,
    COALESCE(NULLIF(trim(p_note), ''), 'Wrong amount/recipient – please return'),
    p_tx_id,
    'PENDING'
  )
  RETURNING id INTO v_req_id;

  INSERT INTO public.notifications (user_id, title, body, kind)
  VALUES (
    v_tx.receiver_id,
    'Reversal Requested (' || v_tx.amount || ' VGC)',
    v_sender_name || ' requested a reversal of ' || v_tx.amount || ' VGC: ' || COALESCE(NULLIF(trim(p_note), ''), 'Wrong amount/recipient – please return'),
    'REVERSAL'
  );

  PERFORM public.assert_golden_invariant();
  RETURN jsonb_build_object('ok', true, 'request_id', v_req_id, 'message', 'Reversal request sent to recipient.');
END;
$$;

-- 5a. respond_payment_request
CREATE OR REPLACE FUNCTION public.respond_payment_request(p_request_id uuid, p_accept boolean, p_pin text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.payment_requests%ROWTYPE;
  v_pin_check jsonb;
  v_available bigint;
  v_tx_id uuid;
  v_payer_name text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED', 'message', 'Authentication required.');
  END IF;

  SELECT * INTO v_req FROM public.payment_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND', 'message', 'Payment request not found.');
  END IF;

  IF v_req.payer_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN', 'message', 'Only the designated payer can respond to this request.');
  END IF;

  IF v_req.status <> 'PENDING' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_HANDLED', 'message', 'This request has already been ' || lower(v_req.status::text) || '.');
  END IF;

  SELECT full_name INTO v_payer_name FROM public.profiles WHERE id = v_uid;

  IF NOT COALESCE(p_accept, false) THEN
    UPDATE public.payment_requests SET status = 'DECLINED' WHERE id = p_request_id;
    INSERT INTO public.notifications (user_id, title, body, kind)
    VALUES (
      v_req.requester_id,
      'Request Declined',
      v_payer_name || ' declined your ' || lower(v_req.kind::text) || ' for ' || v_req.amount || ' VGC.',
      'REQUEST'
    );
    PERFORM public.assert_golden_invariant();
    RETURN jsonb_build_object('ok', true, 'message', 'Request declined.');
  END IF;

  -- Lock both profiles in deterministic order
  PERFORM 1 FROM public.profiles WHERE id = ANY(ARRAY[v_req.payer_id, v_req.requester_id]) ORDER BY id FOR UPDATE;

  v_pin_check := public._verify_user_pin(v_uid, p_pin);
  IF NOT (v_pin_check->>'ok')::boolean THEN
    RETURN v_pin_check;
  END IF;

  SELECT available_vgc_balance INTO v_available FROM public.wallet_balances WHERE user_id = v_uid;
  IF COALESCE(v_available, 0) < v_req.amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_BALANCE', 'message', 'Insufficient available VGC balance.');
  END IF;

  INSERT INTO public.ledger_transactions (tx_kind, sender_id, receiver_id, amount, note, ref_type, ref_id)
  VALUES (
    'TRADE',
    v_uid,
    v_req.requester_id,
    v_req.amount,
    CASE WHEN v_req.kind = 'REVERSAL' THEN 'REVERSAL: ' || v_req.note ELSE 'REQUEST: ' || v_req.note END,
    v_req.kind::text,
    v_req.id
  )
  RETURNING id INTO v_tx_id;

  UPDATE public.payment_requests
  SET status = 'ACCEPTED', response_tx_id = v_tx_id
  WHERE id = p_request_id;

  INSERT INTO public.notifications (user_id, title, body, kind)
  VALUES (
    v_req.requester_id,
    'Request Paid (' || v_req.amount || ' VGC)',
    v_payer_name || ' accepted and sent ' || v_req.amount || ' VGC.',
    'TRADE'
  );

  PERFORM public.assert_golden_invariant();
  RETURN jsonb_build_object('ok', true, 'tx_id', v_tx_id, 'message', 'Sent ' || v_req.amount || ' VGC.');
END;
$$;

-- 5b. cancel_payment_request
CREATE OR REPLACE FUNCTION public.cancel_payment_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.payment_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM public.payment_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_req.requester_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN', 'message', 'Only the requester can cancel this request.');
  END IF;
  IF v_req.status <> 'PENDING' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_STATE', 'message', 'Only pending requests can be cancelled.');
  END IF;

  UPDATE public.payment_requests SET status = 'CANCELLED' WHERE id = p_request_id;
  PERFORM public.assert_golden_invariant();
  RETURN jsonb_build_object('ok', true, 'message', 'Request cancelled.');
END;
$$;

-- 6. submit_deposit_claim
CREATE OR REPLACE FUNCTION public.submit_deposit_claim(
  p_month_tag text,
  p_amount bigint,
  p_receipt_path text,
  p_reference_no text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_required_amount bigint;
  v_claim_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED', 'message', 'Authentication required.');
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND OR NOT v_profile.is_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INACTIVE_USER', 'message', 'Your account is inactive.');
  END IF;

  IF p_month_tag IS NULL OR p_month_tag !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_MONTH', 'message', 'Month tag must be YYYY-MM.');
  END IF;

  SELECT monthly_contribution INTO v_required_amount FROM public.group_settings WHERE id = true;
  IF p_amount IS NULL OR p_amount <> v_required_amount THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'INVALID_CONTRIBUTION_AMOUNT',
      'message', 'Monthly deposit claim must equal the fixed group contribution of ' || v_required_amount || ' VGC.'
    );
  END IF;

  IF p_receipt_path IS NULL OR position(v_uid::text || '/' in p_receipt_path) <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_RECEIPT_PATH', 'message', 'Receipt path must start with your user ID folder.');
  END IF;

  IF trim(COALESCE(p_reference_no, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MISSING_REFERENCE', 'message', 'Bank/EasyPaisa reference number is required.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ledger_transactions
    WHERE tx_kind = 'MINT' AND receiver_id = v_uid AND month_tag = p_month_tag
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_MINTED', 'message', 'Your deposit for ' || p_month_tag || ' has already been minted.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.deposit_claims
    WHERE user_id = v_uid AND month_tag = p_month_tag AND status IN ('PENDING', 'APPROVED')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CLAIM_EXISTS', 'message', 'You already have a pending or approved claim for ' || p_month_tag || '.');
  END IF;

  INSERT INTO public.deposit_claims (user_id, amount, month_tag, receipt_url, reference_no, status)
  VALUES (v_uid, p_amount, p_month_tag, p_receipt_path, trim(p_reference_no), 'PENDING')
  RETURNING id INTO v_claim_id;

  -- Notify all active admins
  INSERT INTO public.notifications (user_id, title, body, kind)
  SELECT id, 'New Deposit Claim (' || p_month_tag || ')', v_profile.full_name || ' submitted a deposit claim for ' || p_amount || ' VGC.', 'DEPOSIT'
  FROM public.profiles
  WHERE role = 'admin' AND is_active = true;

  PERFORM public.assert_golden_invariant();
  RETURN jsonb_build_object('ok', true, 'claim_id', v_claim_id, 'message', 'Deposit claim submitted for admin verification.');
END;
$$;

-- 7a. create_burn_request
CREATE OR REPLACE FUNCTION public.create_burn_request(
  p_amount bigint,
  p_reason text,
  p_kind public.burn_kind DEFAULT 'CASHOUT'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_available bigint;
  v_burn_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED', 'message', 'Authentication required.');
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND OR NOT v_profile.is_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INACTIVE_USER', 'message', 'Your profile is not active.');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 10000000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT', 'message', 'Burn amount must be a positive integer.');
  END IF;

  IF trim(COALESCE(p_reason, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MISSING_REASON', 'message', 'Please provide a reason for the cash-out or group expense burn.');
  END IF;

  SELECT available_vgc_balance INTO v_available FROM public.wallet_balances WHERE user_id = v_uid;
  IF COALESCE(v_available, 0) < p_amount THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'INSUFFICIENT_BALANCE',
      'message', 'Insufficient available balance to reserve ' || p_amount || ' VGC (Available: ' || COALESCE(v_available, 0) || ' VGC).'
    );
  END IF;

  INSERT INTO public.burn_requests (requester_id, amount, reason, kind, approvals, status)
  VALUES (v_uid, p_amount, trim(p_reason), COALESCE(p_kind, 'CASHOUT'), '{}', 'PENDING')
  RETURNING id INTO v_burn_id;

  INSERT INTO public.notifications (user_id, title, body, kind)
  SELECT id, 'New Burn Request (' || p_amount || ' VGC)', v_profile.full_name || ' requested a ' || COALESCE(p_kind, 'CASHOUT')::text || ' burn of ' || p_amount || ' VGC: ' || trim(p_reason), 'BURN'
  FROM public.profiles
  WHERE is_active = true AND id <> v_uid;

  PERFORM public.assert_golden_invariant();
  RETURN jsonb_build_object('ok', true, 'burn_id', v_burn_id, 'message', 'Burn request created and funds reserved pending consensus.');
END;
$$;

-- 7b. cancel_burn_request
CREATE OR REPLACE FUNCTION public.cancel_burn_request(p_burn_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_burn public.burn_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_burn FROM public.burn_requests WHERE id = p_burn_id FOR UPDATE;
  IF NOT FOUND OR v_burn.requester_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN', 'message', 'Only the requester can cancel this burn request.');
  END IF;
  IF v_burn.status <> 'PENDING' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_STATE', 'message', 'Only pending burn requests can be cancelled.');
  END IF;

  UPDATE public.burn_requests SET status = 'REJECTED', review_note = 'Cancelled by requester' WHERE id = p_burn_id;
  PERFORM public.assert_golden_invariant();
  RETURN jsonb_build_object('ok', true, 'message', 'Burn request cancelled and reserved VGC released.');
END;
$$;

-- 8. approve_and_execute_burn
CREATE OR REPLACE FUNCTION public.approve_and_execute_burn(p_burn_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_caller public.profiles%ROWTYPE;
  v_burn public.burn_requests%ROWTYPE;
  v_required int;
  v_peg bigint;
  v_new_approvals uuid[];
  v_has_admin boolean;
  v_ledger_bal bigint;
  v_locked_escrow bigint;
  v_other_reserved bigint;
  v_tx_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED', 'message', 'Authentication required.');
  END IF;

  SELECT * INTO v_burn FROM public.burn_requests WHERE id = p_burn_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND', 'message', 'Burn request not found.');
  END IF;

  IF v_burn.status <> 'PENDING' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_STATE', 'message', 'Burn request is no longer pending.');
  END IF;

  IF v_burn.requester_id = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SELF_APPROVAL_FORBIDDEN', 'message', 'You cannot approve your own burn request.');
  END IF;

  -- Lock profiles in deterministic order
  PERFORM 1 FROM public.profiles WHERE id = ANY(ARRAY[v_uid, v_burn.requester_id]) ORDER BY id FOR UPDATE;

  SELECT * INTO v_caller FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND OR NOT v_caller.is_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INACTIVE_USER', 'message', 'Your account is inactive.');
  END IF;

  IF v_uid = ANY(v_burn.approvals) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_APPROVED', 'message', 'You have already approved this burn request.');
  END IF;

  v_new_approvals := array_append(v_burn.approvals, v_uid);
  SELECT burn_approvals_required, peg INTO v_required, v_peg FROM public.group_settings WHERE id = true;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = ANY(v_new_approvals) AND role = 'admin' AND is_active = true
  ) INTO v_has_admin;

  IF cardinality(v_new_approvals) >= v_required AND v_has_admin THEN
    SELECT ledger_balance, locked_in_escrow, (reserved_for_burn - v_burn.amount)
    INTO v_ledger_bal, v_locked_escrow, v_other_reserved
    FROM public.wallet_balances
    WHERE user_id = v_burn.requester_id;

    IF (COALESCE(v_ledger_bal, 0) - COALESCE(v_locked_escrow, 0) - GREATEST(COALESCE(v_other_reserved, 0), 0)) < v_burn.amount THEN
      RETURN jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_BALANCE', 'message', 'Requester no longer has enough unencumbered balance.');
    END IF;

    INSERT INTO public.ledger_transactions (tx_kind, sender_id, receiver_id, amount, note, ref_type, ref_id)
    VALUES ('BURN', v_burn.requester_id, NULL, v_burn.amount, v_burn.kind::text || ': ' || v_burn.reason, 'BURN_REQUEST', v_burn.id)
    RETURNING id INTO v_tx_id;

    UPDATE public.burn_requests
    SET approvals = v_new_approvals,
        status = 'APPROVED',
        executed_tx_id = v_tx_id
    WHERE id = p_burn_id;

    INSERT INTO public.notifications (user_id, title, body, kind)
    VALUES (
      v_burn.requester_id,
      'Burn Executed (' || v_burn.amount || ' VGC)',
      'Your ' || v_burn.kind::text || ' burn of ' || v_burn.amount || ' VGC (PKR ' || (v_burn.amount * v_peg) || ') was approved and executed.',
      'BURN'
    );

    IF v_caller.role = 'admin' THEN
      INSERT INTO public.audit_log (actor_id, action, target_id, details)
      VALUES (v_uid, 'APPROVE_AND_EXECUTE_BURN', v_burn.id, jsonb_build_object('amount', v_burn.amount, 'requester_id', v_burn.requester_id, 'tx_id', v_tx_id));
    END IF;

    PERFORM public.assert_golden_invariant();
    RETURN jsonb_build_object(
      'ok', true,
      'executed', true,
      'tx_id', v_tx_id,
      'approvals', cardinality(v_new_approvals),
      'required', v_required,
      'pkr_payout', v_burn.amount * v_peg,
      'message', 'Consensus reached! Burned ' || v_burn.amount || ' VGC. Pay PKR ' || (v_burn.amount * v_peg) || ' from Vagafund.'
    );
  ELSE
    UPDATE public.burn_requests
    SET approvals = v_new_approvals
    WHERE id = p_burn_id;

    IF v_caller.role = 'admin' THEN
      INSERT INTO public.audit_log (actor_id, action, target_id, details)
      VALUES (v_uid, 'APPROVE_BURN_PARTIAL', v_burn.id, jsonb_build_object('amount', v_burn.amount, 'approvals', cardinality(v_new_approvals)));
    END IF;

    PERFORM public.assert_golden_invariant();
    RETURN jsonb_build_object(
      'ok', true,
      'executed', false,
      'approvals', cardinality(v_new_approvals),
      'required', v_required,
      'has_admin', v_has_admin,
      'message', 'Approval recorded (' || cardinality(v_new_approvals) || '/' || v_required || ').'
    );
  END IF;
END;
$$;

-- 9. create_split_request
CREATE OR REPLACE FUNCTION public.create_split_request(
  p_title text,
  p_total bigint,
  p_participant_ids uuid[],
  p_include_creator boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_creator public.profiles%ROWTYPE;
  v_clean_participants uuid[];
  v_all_payers uuid[];
  v_n int;
  v_base bigint;
  v_rem bigint;
  v_split_id uuid;
  v_idx int := 0;
  v_pid uuid;
  v_share bigint;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED', 'message', 'Authentication required.');
  END IF;

  SELECT * INTO v_creator FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND OR NOT v_creator.is_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INACTIVE_USER', 'message', 'Your account is inactive.');
  END IF;

  IF trim(COALESCE(p_title, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MISSING_TITLE', 'message', 'Split title is required.');
  END IF;

  IF p_total IS NULL OR p_total <= 0 OR p_total > 10000000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TOTAL', 'message', 'Total amount must be between 1 and 10,000,000 VGC.');
  END IF;

  -- Deduplicate and exclude creator from participant_ids
  SELECT ARRAY(
    SELECT DISTINCT p.id
    FROM public.profiles p
    WHERE p.id = ANY(p_participant_ids)
      AND p.id <> v_uid
      AND p.is_active = true
    ORDER BY p.id
  ) INTO v_clean_participants;

  IF cardinality(v_clean_participants) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_PARTICIPANTS', 'message', 'Select at least one active friend to split with.');
  END IF;

  IF COALESCE(p_include_creator, true) THEN
    SELECT ARRAY(
      SELECT u FROM unnest(array_append(v_clean_participants, v_uid)) AS u ORDER BY u
    ) INTO v_all_payers;
  ELSE
    v_all_payers := v_clean_participants;
  END IF;

  v_n := cardinality(v_all_payers);
  IF p_total < v_n THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TOTAL_TOO_SMALL', 'message', 'Total amount must be at least ' || v_n || ' VGC to split across ' || v_n || ' people.');
  END IF;

  v_base := p_total / v_n;
  v_rem := mod(p_total, v_n);

  INSERT INTO public.split_requests (creator_id, title, total_amount, include_creator, status)
  VALUES (v_uid, trim(p_title), p_total, COALESCE(p_include_creator, true), 'OPEN')
  RETURNING id INTO v_split_id;

  FOREACH v_pid IN ARRAY v_all_payers LOOP
    v_idx := v_idx + 1;
    IF v_idx <= v_rem THEN
      v_share := v_base + 1;
    ELSE
      v_share := v_base;
    END IF;

    -- Creator's own share is never collected
    IF v_pid <> v_uid THEN
      INSERT INTO public.split_participants (split_id, user_id, share_amount, status)
      VALUES (v_split_id, v_pid, v_share, 'PENDING');

      INSERT INTO public.notifications (user_id, title, body, kind)
      VALUES (
        v_pid,
        'Bill Split: ' || trim(p_title),
        v_creator.full_name || ' split ' || p_total || ' VGC. Your share is ' || v_share || ' VGC.',
        'SPLIT'
      );
    END IF;
  END LOOP;

  PERFORM public.assert_golden_invariant();
  RETURN jsonb_build_object('ok', true, 'split_id', v_split_id, 'message', 'Split request created and participants notified.');
END;
$$;

-- 10a. pay_split_share
CREATE OR REPLACE FUNCTION public.pay_split_share(p_participant_id uuid, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_part public.split_participants%ROWTYPE;
  v_split public.split_requests%ROWTYPE;
  v_pin_check jsonb;
  v_available bigint;
  v_tx_id uuid;
  v_payer_name text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED', 'message', 'Authentication required.');
  END IF;

  SELECT * INTO v_part FROM public.split_participants WHERE id = p_participant_id FOR UPDATE;
  IF NOT FOUND OR v_part.user_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN', 'message', 'This split share does not belong to you.');
  END IF;

  IF v_part.status <> 'PENDING' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_HANDLED', 'message', 'This share is already ' || lower(v_part.status::text) || '.');
  END IF;

  SELECT * INTO v_split FROM public.split_requests WHERE id = v_part.split_id FOR UPDATE;
  IF NOT FOUND OR v_split.status <> 'OPEN' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SPLIT_CLOSED', 'message', 'This bill split is no longer open.');
  END IF;

  PERFORM 1 FROM public.profiles WHERE id = ANY(ARRAY[v_uid, v_split.creator_id]) ORDER BY id FOR UPDATE;

  v_pin_check := public._verify_user_pin(v_uid, p_pin);
  IF NOT (v_pin_check->>'ok')::boolean THEN
    RETURN v_pin_check;
  END IF;

  SELECT available_vgc_balance INTO v_available FROM public.wallet_balances WHERE user_id = v_uid;
  IF COALESCE(v_available, 0) < v_part.share_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_BALANCE', 'message', 'Insufficient available VGC balance.');
  END IF;

  INSERT INTO public.ledger_transactions (tx_kind, sender_id, receiver_id, amount, note, ref_type, ref_id)
  VALUES ('TRADE', v_uid, v_split.creator_id, v_part.share_amount, 'Split: ' || v_split.title, 'SPLIT', v_split.id)
  RETURNING id INTO v_tx_id;

  UPDATE public.split_participants
  SET status = 'PAID', paid_tx_id = v_tx_id
  WHERE id = p_participant_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.split_participants WHERE split_id = v_split.id AND status = 'PENDING'
  ) THEN
    UPDATE public.split_requests SET status = 'COMPLETED' WHERE id = v_split.id;
  END IF;

  SELECT full_name INTO v_payer_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.notifications (user_id, title, body, kind)
  VALUES (
    v_split.creator_id,
    'Split Share Paid (' || v_part.share_amount || ' VGC)',
    v_payer_name || ' paid ' || v_part.share_amount || ' VGC for "' || v_split.title || '".',
    'SPLIT'
  );

  PERFORM public.assert_golden_invariant();
  RETURN jsonb_build_object('ok', true, 'tx_id', v_tx_id, 'message', 'Paid ' || v_part.share_amount || ' VGC for "' || v_split.title || '".');
END;
$$;

-- 10b. decline_split_share
CREATE OR REPLACE FUNCTION public.decline_split_share(p_participant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_part public.split_participants%ROWTYPE;
  v_split public.split_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_part FROM public.split_participants WHERE id = p_participant_id FOR UPDATE;
  IF NOT FOUND OR v_part.user_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN', 'message', 'This split share does not belong to you.');
  END IF;
  IF v_part.status <> 'PENDING' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_STATE', 'message', 'Share is not pending.');
  END IF;

  SELECT * INTO v_split FROM public.split_requests WHERE id = v_part.split_id FOR UPDATE;
  UPDATE public.split_participants SET status = 'DECLINED' WHERE id = p_participant_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.split_participants WHERE split_id = v_split.id AND status = 'PENDING'
  ) THEN
    UPDATE public.split_requests SET status = 'COMPLETED' WHERE id = v_split.id;
  END IF;

  PERFORM public.assert_golden_invariant();
  RETURN jsonb_build_object('ok', true, 'message', 'Split share declined.');
END;
$$;

-- 10c. cancel_split_request
CREATE OR REPLACE FUNCTION public.cancel_split_request(p_split_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_split public.split_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_split FROM public.split_requests WHERE id = p_split_id FOR UPDATE;
  IF NOT FOUND OR v_split.creator_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN', 'message', 'Only the split creator can cancel it.');
  END IF;
  IF v_split.status <> 'OPEN' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_STATE', 'message', 'Split is no longer open.');
  END IF;

  UPDATE public.split_requests SET status = 'CANCELLED' WHERE id = p_split_id;
  UPDATE public.split_participants SET status = 'DECLINED' WHERE split_id = p_split_id AND status = 'PENDING';

  PERFORM public.assert_golden_invariant();
  RETURN jsonb_build_object('ok', true, 'message', 'Split request cancelled (unpaid shares voided).');
END;
$$;

-- 11. create_escrow_match
CREATE OR REPLACE FUNCTION public.create_escrow_match(
  p_title text,
  p_wager bigint,
  p_opponent_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_creator public.profiles%ROWTYPE;
  v_opponent public.profiles%ROWTYPE;
  v_available bigint;
  v_match_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED', 'message', 'Authentication required.');
  END IF;

  IF p_opponent_id IS NULL OR p_opponent_id = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_OPPONENT', 'message', 'Select an active opponent other than yourself.');
  END IF;

  IF trim(COALESCE(p_title, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MISSING_TITLE', 'message', 'Match title is required.');
  END IF;

  IF p_wager IS NULL OR p_wager <= 0 OR p_wager > 10000000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_WAGER', 'message', 'Wager must be a positive whole amount.');
  END IF;

  PERFORM 1 FROM public.profiles WHERE id = ANY(ARRAY[v_uid, p_opponent_id]) ORDER BY id FOR UPDATE;

  SELECT * INTO v_creator FROM public.profiles WHERE id = v_uid;
  SELECT * INTO v_opponent FROM public.profiles WHERE id = p_opponent_id;
  IF NOT v_creator.is_active OR NOT v_opponent.is_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INACTIVE_PLAYER', 'message', 'Both players must be active members.');
  END IF;

  SELECT available_vgc_balance INTO v_available FROM public.wallet_balances WHERE user_id = v_uid;
  IF COALESCE(v_available, 0) < p_wager THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_BALANCE', 'message', 'Insufficient available VGC to lock wager.');
  END IF;

  INSERT INTO public.escrow_matches (creator_id, opponent_id, wager_amount, title, status)
  VALUES (v_uid, p_opponent_id, p_wager, trim(p_title), 'OPEN')
  RETURNING id INTO v_match_id;

  INSERT INTO public.notifications (user_id, title, body, kind)
  VALUES (
    p_opponent_id,
    '1v1 Escrow Challenge: ' || trim(p_title),
    v_creator.full_name || ' challenged you for ' || p_wager || ' VGC (' || (p_wager * 2) || ' VGC pot).',
    'ESCROW'
  );

  PERFORM public.assert_golden_invariant();
  RETURN jsonb_build_object('ok', true, 'match_id', v_match_id, 'message', 'Challenge created! Your ' || p_wager || ' VGC stake is now locked in escrow.');
END;
$$;

-- 12a. accept_escrow_match
CREATE OR REPLACE FUNCTION public.accept_escrow_match(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_match public.escrow_matches%ROWTYPE;
  v_available bigint;
  v_opponent_name text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED', 'message', 'Authentication required.');
  END IF;

  SELECT * INTO v_match FROM public.escrow_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND', 'message', 'Escrow match not found.');
  END IF;

  IF v_match.opponent_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN', 'message', 'Only the challenged opponent can accept this match.');
  END IF;

  IF v_match.status <> 'OPEN' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_STATE', 'message', 'Match is not open for acceptance.');
  END IF;

  PERFORM 1 FROM public.profiles WHERE id = ANY(ARRAY[v_match.creator_id, v_match.opponent_id]) ORDER BY id FOR UPDATE;

  SELECT available_vgc_balance INTO v_available FROM public.wallet_balances WHERE user_id = v_uid;
  IF COALESCE(v_available, 0) < v_match.wager_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_BALANCE', 'message', 'Insufficient available VGC to match the ' || v_match.wager_amount || ' VGC wager.');
  END IF;

  UPDATE public.escrow_matches SET status = 'LOCKED' WHERE id = p_match_id;

  SELECT full_name INTO v_opponent_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.notifications (user_id, title, body, kind)
  VALUES (
    v_match.creator_id,
    'Match Locked: ' || v_match.title,
    v_opponent_name || ' accepted your challenge! ' || (v_match.wager_amount * 2) || ' VGC pot is locked.',
    'ESCROW'
  );

  PERFORM public.assert_golden_invariant();
  RETURN jsonb_build_object('ok', true, 'message', 'Match accepted! Both stakes are locked in escrow.');
END;
$$;

-- 12b. cancel_escrow_match
CREATE OR REPLACE FUNCTION public.cancel_escrow_match(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_caller public.profiles%ROWTYPE;
  v_match public.escrow_matches%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED', 'message', 'Authentication required.');
  END IF;

  SELECT * INTO v_match FROM public.escrow_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND', 'message', 'Match not found.');
  END IF;

  SELECT * INTO v_caller FROM public.profiles WHERE id = v_uid;

  IF v_match.status = 'OPEN' THEN
    IF v_uid <> v_match.creator_id AND v_uid <> v_match.opponent_id AND v_caller.role <> 'admin' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN', 'message', 'Not authorized to cancel this match.');
    END IF;
    UPDATE public.escrow_matches SET status = 'CANCELLED' WHERE id = p_match_id;
    PERFORM public.assert_golden_invariant();
    RETURN jsonb_build_object('ok', true, 'message', 'Match cancelled and stake unlocked.');
  ELSIF v_match.status = 'LOCKED' THEN
    IF v_caller.role = 'admin' THEN
      UPDATE public.escrow_matches SET status = 'CANCELLED' WHERE id = p_match_id;
      INSERT INTO public.audit_log (actor_id, action, target_id, details)
      VALUES (v_uid, 'ADMIN_CANCEL_ESCROW', p_match_id, jsonb_build_object('title', v_match.title));
      PERFORM public.assert_golden_invariant();
      RETURN jsonb_build_object('ok', true, 'message', 'Match cancelled by admin and stakes unlocked.');
    END IF;

    IF v_uid = v_match.creator_id THEN
      v_match.creator_cancel := true;
    ELSIF v_uid = v_match.opponent_id THEN
      v_match.opponent_cancel := true;
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN', 'message', 'Only players or an admin can cancel.');
    END IF;

    IF v_match.creator_cancel AND v_match.opponent_cancel THEN
      UPDATE public.escrow_matches
      SET creator_cancel = true, opponent_cancel = true, status = 'CANCELLED'
      WHERE id = p_match_id;
      PERFORM public.assert_golden_invariant();
      RETURN jsonb_build_object('ok', true, 'message', 'Mutual cancellation complete! Both stakes unlocked.');
    ELSE
      UPDATE public.escrow_matches
      SET creator_cancel = v_match.creator_cancel, opponent_cancel = v_match.opponent_cancel
      WHERE id = p_match_id;
      PERFORM public.assert_golden_invariant();
      RETURN jsonb_build_object('ok', true, 'message', 'Cancel requested; waiting for opponent to agree.');
    END IF;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_STATE', 'message', 'Match cannot be cancelled in its current state.');
  END IF;
END;
$$;

-- 14. settle_escrow_match (defined before report_escrow_result so report_escrow_result can invoke it)
CREATE OR REPLACE FUNCTION public.settle_escrow_match(p_match_id uuid, p_winner_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_caller public.profiles%ROWTYPE;
  v_match public.escrow_matches%ROWTYPE;
  v_loser_id uuid;
  v_tx_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED', 'message', 'Authentication required.');
  END IF;

  SELECT * INTO v_match FROM public.escrow_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND', 'message', 'Escrow match not found.');
  END IF;

  IF v_match.status NOT IN ('LOCKED', 'DISPUTED') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_STATE', 'message', 'Match must be LOCKED or DISPUTED to settle.');
  END IF;

  IF p_winner_id IS NULL OR (p_winner_id <> v_match.creator_id AND p_winner_id <> v_match.opponent_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_WINNER', 'message', 'Winner must be one of the two match players.');
  END IF;

  SELECT * INTO v_caller FROM public.profiles WHERE id = v_uid;

  -- Must either be an admin resolving a dispute OR both player reports matching p_winner_id
  IF NOT (
    v_caller.role = 'admin' OR
    (v_match.creator_report = p_winner_id AND v_match.opponent_report = p_winner_id)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN', 'message', 'Only an admin or mutual player agreement can settle an escrow match.');
  END IF;

  PERFORM 1 FROM public.profiles WHERE id = ANY(ARRAY[v_match.creator_id, v_match.opponent_id]) ORDER BY id FOR UPDATE;

  IF p_winner_id = v_match.creator_id THEN
    v_loser_id := v_match.opponent_id;
  ELSE
    v_loser_id := v_match.creator_id;
  END IF;

  -- Flip status first or insert TRADE and update status in same atomic tx
  INSERT INTO public.ledger_transactions (tx_kind, sender_id, receiver_id, amount, note, ref_type, ref_id)
  VALUES ('TRADE', v_loser_id, p_winner_id, v_match.wager_amount, 'Escrow Match Won: ' || v_match.title, 'ESCROW', v_match.id)
  RETURNING id INTO v_tx_id;

  UPDATE public.escrow_matches
  SET status = 'SETTLED',
      winner_id = p_winner_id,
      settled_tx_id = v_tx_id
  WHERE id = p_match_id;

  INSERT INTO public.notifications (user_id, title, body, kind)
  VALUES
    (p_winner_id, 'Match Won! (+' || v_match.wager_amount || ' VGC)', 'Escrow settled for "' || v_match.title || '". You won ' || v_match.wager_amount || ' VGC!', 'ESCROW'),
    (v_loser_id, 'Match Settled (-' || v_match.wager_amount || ' VGC)', 'Escrow settled for "' || v_match.title || '". ' || v_match.wager_amount || ' VGC transferred to winner.', 'ESCROW');

  IF v_caller.role = 'admin' AND (v_match.creator_report IS DISTINCT FROM v_match.opponent_report) THEN
    INSERT INTO public.audit_log (actor_id, action, target_id, details)
    VALUES (v_uid, 'RESOLVE_ESCROW_DISPUTE', p_match_id, jsonb_build_object('winner_id', p_winner_id, 'wager_amount', v_match.wager_amount, 'tx_id', v_tx_id));
  END IF;

  PERFORM public.assert_golden_invariant();
  RETURN jsonb_build_object('ok', true, 'settled', true, 'winner_id', p_winner_id, 'tx_id', v_tx_id, 'message', 'Match settled! ' || v_match.wager_amount || ' VGC transferred to winner.');
END;
$$;

-- 13. report_escrow_result
CREATE OR REPLACE FUNCTION public.report_escrow_result(p_match_id uuid, p_winner_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_match public.escrow_matches%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED', 'message', 'Authentication required.');
  END IF;

  SELECT * INTO v_match FROM public.escrow_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND', 'message', 'Escrow match not found.');
  END IF;

  IF v_match.status <> 'LOCKED' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_STATE', 'message', 'Match must be LOCKED to report results.');
  END IF;

  IF v_uid <> v_match.creator_id AND v_uid <> v_match.opponent_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN', 'message', 'Only the two match players can report the result.');
  END IF;

  IF p_winner_id IS NULL OR (p_winner_id <> v_match.creator_id AND p_winner_id <> v_match.opponent_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_WINNER', 'message', 'Reported winner must be one of the two players.');
  END IF;

  IF v_uid = v_match.creator_id THEN
    v_match.creator_report := p_winner_id;
    UPDATE public.escrow_matches SET creator_report = p_winner_id WHERE id = p_match_id;
  ELSE
    v_match.opponent_report := p_winner_id;
    UPDATE public.escrow_matches SET opponent_report = p_winner_id WHERE id = p_match_id;
  END IF;

  IF v_match.creator_report IS NOT NULL AND v_match.opponent_report IS NOT NULL THEN
    IF v_match.creator_report = v_match.opponent_report THEN
      RETURN public.settle_escrow_match(p_match_id, v_match.creator_report);
    ELSE
      UPDATE public.escrow_matches SET status = 'DISPUTED' WHERE id = p_match_id;
      INSERT INTO public.notifications (user_id, title, body, kind)
      SELECT id, 'Escrow Match Disputed', 'Conflicting results reported for "' || v_match.title || '". Admin resolution required.', 'ESCROW'
      FROM public.profiles WHERE role = 'admin' AND is_active = true;

      PERFORM public.assert_golden_invariant();
      RETURN jsonb_build_object('ok', true, 'settled', false, 'disputed', true, 'message', 'Conflicting reports! Match marked DISPUTED for admin resolution.');
    END IF;
  END IF;

  PERFORM public.assert_golden_invariant();
  RETURN jsonb_build_object('ok', true, 'settled', false, 'disputed', false, 'message', 'Result recorded. Waiting for opponent confirmation.');
END;
$$;

-- 15. mark_notifications_read
CREATE OR REPLACE FUNCTION public.mark_notifications_read()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED', 'message', 'Authentication required.');
  END IF;
  UPDATE public.notifications SET is_read = true WHERE user_id = v_uid AND is_read = false;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 16. admin_approve_deposit
CREATE OR REPLACE FUNCTION public.admin_approve_deposit(p_claim_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_admin public.profiles%ROWTYPE;
  v_claim public.deposit_claims%ROWTYPE;
  v_admin_count int;
  v_note text;
  v_tx_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED', 'message', 'Authentication required.');
  END IF;

  SELECT * INTO v_admin FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND OR NOT v_admin.is_active OR v_admin.role <> 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ADMIN_ONLY', 'message', 'Admin privileges required.');
  END IF;

  SELECT * INTO v_claim FROM public.deposit_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND', 'message', 'Deposit claim not found.');
  END IF;

  IF v_claim.status <> 'PENDING' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_MINTED', 'message', 'Deposit claim has already been processed (' || v_claim.status::text || ').');
  END IF;

  PERFORM 1 FROM public.profiles WHERE id = v_claim.user_id FOR UPDATE;

  IF v_claim.user_id = v_uid THEN
    SELECT count(*) INTO v_admin_count FROM public.profiles WHERE role = 'admin' AND is_active = true;
    IF v_admin_count > 1 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'SELF_APPROVE_FORBIDDEN', 'message', 'Another active admin must verify your own deposit claim.');
    END IF;
    v_note := 'Monthly Deposit ' || v_claim.month_tag || ' [SELF-APPROVED (sole admin)]';
  ELSE
    v_note := 'Monthly Deposit ' || v_claim.month_tag || ' (Ref: ' || v_claim.reference_no || ')';
  END IF;

  BEGIN
    INSERT INTO public.ledger_transactions (tx_kind, sender_id, receiver_id, amount, month_tag, note, ref_type, ref_id)
    VALUES ('MINT', NULL, v_claim.user_id, v_claim.amount, v_claim.month_tag, v_note, 'DEPOSIT_CLAIM', v_claim.id)
    RETURNING id INTO v_tx_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_MINTED', 'message', 'MINT already exists for this member and month.');
  END;

  UPDATE public.deposit_claims
  SET status = 'APPROVED',
      reviewed_by = v_uid,
      review_note = v_note,
      reviewed_at = now()
  WHERE id = p_claim_id;

  INSERT INTO public.notifications (user_id, title, body, kind)
  VALUES (
    v_claim.user_id,
    'Deposit Approved (+' || v_claim.amount || ' VGC)',
    'Your ' || v_claim.month_tag || ' deposit claim was verified and ' || v_claim.amount || ' VGC has been minted to your wallet.',
    'MINT'
  );

  INSERT INTO public.audit_log (actor_id, action, target_id, details)
  VALUES (
    v_uid,
    'APPROVE_DEPOSIT_MINT',
    v_claim.id,
    jsonb_build_object('user_id', v_claim.user_id, 'month_tag', v_claim.month_tag, 'amount', v_claim.amount, 'tx_id', v_tx_id, 'self_approved', (v_claim.user_id = v_uid))
  );

  PERFORM public.assert_golden_invariant();
  RETURN jsonb_build_object('ok', true, 'tx_id', v_tx_id, 'message', 'Approved and minted ' || v_claim.amount || ' VGC for ' || v_claim.month_tag || '.');
END;
$$;

-- 17a. admin_reject_deposit
CREATE OR REPLACE FUNCTION public.admin_reject_deposit(p_claim_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_admin public.profiles%ROWTYPE;
  v_claim public.deposit_claims%ROWTYPE;
BEGIN
  SELECT * INTO v_admin FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND OR NOT v_admin.is_active OR v_admin.role <> 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ADMIN_ONLY', 'message', 'Admin privileges required.');
  END IF;

  IF trim(COALESCE(p_reason, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED', 'message', 'Rejection reason is required.');
  END IF;

  SELECT * INTO v_claim FROM public.deposit_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR v_claim.status <> 'PENDING' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_STATE', 'message', 'Deposit claim is not pending.');
  END IF;

  UPDATE public.deposit_claims
  SET status = 'REJECTED', reviewed_by = v_uid, review_note = trim(p_reason), reviewed_at = now()
  WHERE id = p_claim_id;

  INSERT INTO public.notifications (user_id, title, body, kind)
  VALUES (v_claim.user_id, 'Deposit Claim Rejected', 'Your ' || v_claim.month_tag || ' claim was rejected: ' || trim(p_reason), 'DEPOSIT');

  INSERT INTO public.audit_log (actor_id, action, target_id, details)
  VALUES (v_uid, 'REJECT_DEPOSIT', p_claim_id, jsonb_build_object('reason', trim(p_reason), 'user_id', v_claim.user_id));

  PERFORM public.assert_golden_invariant();
  RETURN jsonb_build_object('ok', true, 'message', 'Deposit claim rejected.');
END;
$$;

-- 17b. admin_reject_burn
CREATE OR REPLACE FUNCTION public.admin_reject_burn(p_burn_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_admin public.profiles%ROWTYPE;
  v_burn public.burn_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_admin FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND OR NOT v_admin.is_active OR v_admin.role <> 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ADMIN_ONLY', 'message', 'Admin privileges required.');
  END IF;

  IF trim(COALESCE(p_reason, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED', 'message', 'Rejection reason is required.');
  END IF;

  SELECT * INTO v_burn FROM public.burn_requests WHERE id = p_burn_id FOR UPDATE;
  IF NOT FOUND OR v_burn.status <> 'PENDING' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_STATE', 'message', 'Burn request is not pending.');
  END IF;

  UPDATE public.burn_requests
  SET status = 'REJECTED', review_note = trim(p_reason)
  WHERE id = p_burn_id;

  INSERT INTO public.notifications (user_id, title, body, kind)
  VALUES (v_burn.requester_id, 'Burn Request Rejected', 'Your burn request for ' || v_burn.amount || ' VGC was rejected: ' || trim(p_reason), 'BURN');

  INSERT INTO public.audit_log (actor_id, action, target_id, details)
  VALUES (v_uid, 'REJECT_BURN', p_burn_id, jsonb_build_object('reason', trim(p_reason), 'requester_id', v_burn.requester_id));

  PERFORM public.assert_golden_invariant();
  RETURN jsonb_build_object('ok', true, 'message', 'Burn request rejected and reserved VGC unlocked.');
END;
$$;

-- 18. admin_member_exit
CREATE OR REPLACE FUNCTION public.admin_member_exit(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_admin public.profiles%ROWTYPE;
  v_member public.profiles%ROWTYPE;
  v_bal public.wallet_balances%ROWTYPE;
  v_peg bigint;
  v_tx_id uuid := NULL;
BEGIN
  SELECT * INTO v_admin FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND OR NOT v_admin.is_active OR v_admin.role <> 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ADMIN_ONLY', 'message', 'Admin privileges required.');
  END IF;

  SELECT * INTO v_member FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND OR NOT v_member.is_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_INACTIVE', 'message', 'Member not found or already exited.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.escrow_matches
    WHERE (creator_id = p_user_id OR opponent_id = p_user_id)
      AND status IN ('OPEN', 'LOCKED', 'DISPUTED')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACTIVE_ESCROW_BLOCKER', 'message', 'Member has unresolved OPEN/LOCKED/DISPUTED escrow matches. Settle or cancel them before exit.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.burn_requests
    WHERE requester_id = p_user_id AND status = 'PENDING'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PENDING_BURN_BLOCKER', 'message', 'Member has a pending burn request. Approve or reject it before exit.');
  END IF;

  SELECT * INTO v_bal FROM public.wallet_balances WHERE user_id = p_user_id;
  SELECT peg INTO v_peg FROM public.group_settings WHERE id = true;

  IF COALESCE(v_bal.ledger_balance, 0) > 0 THEN
    INSERT INTO public.ledger_transactions (tx_kind, sender_id, receiver_id, amount, note, ref_type, ref_id)
    VALUES ('BURN', p_user_id, NULL, v_bal.ledger_balance, 'MEMBER_EXIT', 'MEMBER_EXIT', p_user_id)
    RETURNING id INTO v_tx_id;
  END IF;

  UPDATE public.profiles SET is_active = false WHERE id = p_user_id;

  INSERT INTO public.notifications (user_id, title, body, kind)
  VALUES (
    p_user_id,
    'Committee Exit Settlement',
    'Your membership was settled. Burned ' || COALESCE(v_bal.ledger_balance, 0) || ' VGC for a cash payout of PKR ' || (COALESCE(v_bal.ledger_balance, 0) * v_peg) || '.',
    'BURN'
  );

  INSERT INTO public.audit_log (actor_id, action, target_id, details)
  VALUES (
    v_uid,
    'MEMBER_EXIT',
    p_user_id,
    jsonb_build_object('member_name', v_member.full_name, 'burned_vgc', COALESCE(v_bal.ledger_balance, 0), 'pkr_settlement', COALESCE(v_bal.ledger_balance, 0) * v_peg, 'tx_id', v_tx_id)
  );

  PERFORM public.assert_golden_invariant();
  RETURN jsonb_build_object(
    'ok', true,
    'burned', COALESCE(v_bal.ledger_balance, 0),
    'pkr_settlement', COALESCE(v_bal.ledger_balance, 0) * v_peg,
    'tx_id', v_tx_id,
    'message', 'Burned ' || COALESCE(v_bal.ledger_balance, 0) || ' VGC — transfer PKR ' || (COALESCE(v_bal.ledger_balance, 0) * v_peg) || ' to ' || v_member.full_name || '.'
  );
END;
$$;

-- 19. admin_run_settlement
CREATE OR REPLACE FUNCTION public.admin_run_settlement(p_month_tag text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_admin public.profiles%ROWTYPE;
  v_cfg public.group_settings%ROWTYPE;
  v_rec RECORD;
  v_payouts jsonb := '[]'::jsonb;
  v_total_burned bigint := 0;
  v_tx_id uuid;
BEGIN
  SELECT * INTO v_admin FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND OR NOT v_admin.is_active OR v_admin.role <> 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ADMIN_ONLY', 'message', 'Admin privileges required.');
  END IF;

  SELECT * INTO v_cfg FROM public.group_settings WHERE id = true;
  IF v_cfg.rollover_mode <> 'MONTHLY_RESET' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROLLOVER_MODE_CONTINUOUS', 'message', 'Month-End Settlement is only enabled when rollover_mode is MONTHLY_RESET.');
  END IF;

  IF p_month_tag IS NULL OR p_month_tag !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_MONTH', 'message', 'Valid YYYY-MM month tag is required.');
  END IF;

  PERFORM 1 FROM public.profiles WHERE is_active = true ORDER BY id FOR UPDATE;

  FOR v_rec IN
    SELECT user_id, full_name, available_vgc_balance
    FROM public.wallet_balances
    WHERE is_active = true AND available_vgc_balance > 0
    ORDER BY full_name
  LOOP
    INSERT INTO public.ledger_transactions (tx_kind, sender_id, receiver_id, amount, note, ref_type)
    VALUES ('BURN', v_rec.user_id, NULL, v_rec.available_vgc_balance, 'MONTH_END_SETTLEMENT:' || p_month_tag, 'SETTLEMENT')
    RETURNING id INTO v_tx_id;

    v_total_burned := v_total_burned + v_rec.available_vgc_balance;
    v_payouts := v_payouts || jsonb_build_array(
      jsonb_build_object(
        'user_id', v_rec.user_id,
        'full_name', v_rec.full_name,
        'burned_vgc', v_rec.available_vgc_balance,
        'pkr_payout', v_rec.available_vgc_balance * v_cfg.peg,
        'tx_id', v_tx_id
      )
    );
  END LOOP;

  INSERT INTO public.audit_log (actor_id, action, target_id, details)
  VALUES (v_uid, 'MONTH_END_SETTLEMENT', NULL, jsonb_build_object('month_tag', p_month_tag, 'total_burned', v_total_burned, 'payouts', v_payouts));

  PERFORM public.assert_golden_invariant();
  RETURN jsonb_build_object('ok', true, 'total_burned', v_total_burned, 'payouts', v_payouts, 'message', 'Month-end settlement completed. Total burned: ' || v_total_burned || ' VGC.');
END;
$$;

-- 20a. admin_record_reconciliation
CREATE OR REPLACE FUNCTION public.admin_record_reconciliation(p_bank_balance_pkr bigint, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_admin public.profiles%ROWTYPE;
  v_expected bigint;
  v_variance bigint;
  v_rec_id uuid;
BEGIN
  SELECT * INTO v_admin FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND OR NOT v_admin.is_active OR v_admin.role <> 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ADMIN_ONLY', 'message', 'Admin privileges required.');
  END IF;

  IF p_bank_balance_pkr IS NULL OR p_bank_balance_pkr < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_BALANCE', 'message', 'Bank balance must be 0 or greater.');
  END IF;

  SELECT fund_cash_pkr INTO v_expected FROM public.vagafund_summary;
  v_variance := p_bank_balance_pkr - COALESCE(v_expected, 0);

  INSERT INTO public.fund_reconciliations (recorded_by, bank_balance_pkr, expected_pkr, variance_pkr, note)
  VALUES (v_uid, p_bank_balance_pkr, COALESCE(v_expected, 0), v_variance, COALESCE(trim(p_note), ''))
  RETURNING id INTO v_rec_id;

  INSERT INTO public.audit_log (actor_id, action, target_id, details)
  VALUES (v_uid, 'RECORD_RECONCILIATION', v_rec_id, jsonb_build_object('bank_balance_pkr', p_bank_balance_pkr, 'expected_pkr', v_expected, 'variance_pkr', v_variance));

  PERFORM public.assert_golden_invariant();
  RETURN jsonb_build_object('ok', true, 'reconciliation_id', v_rec_id, 'variance_pkr', v_variance, 'message', 'Reconciliation saved (Variance: PKR ' || v_variance || ').');
END;
$$;

-- 20b. admin_update_settings
CREATE OR REPLACE FUNCTION public.admin_update_settings(
  p_group_name text,
  p_monthly_contribution bigint,
  p_burn_approvals_required int,
  p_rollover_mode text,
  p_reversal_window_hours int,
  p_invite_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_admin public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_admin FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND OR NOT v_admin.is_active OR v_admin.role <> 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ADMIN_ONLY', 'message', 'Admin privileges required.');
  END IF;

  IF p_monthly_contribution IS NULL OR p_monthly_contribution <= 0 OR p_monthly_contribution > 10000000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_CONTRIBUTION', 'message', 'Monthly contribution must be between 1 and 10,000,000 VGC.');
  END IF;

  IF p_burn_approvals_required IS NULL OR p_burn_approvals_required < 1 OR p_burn_approvals_required > 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_APPROVALS', 'message', 'Approvals required must be between 1 and 20.');
  END IF;

  IF p_rollover_mode NOT IN ('CONTINUOUS', 'MONTHLY_RESET') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ROLLOVER_MODE', 'message', 'Rollover mode must be CONTINUOUS or MONTHLY_RESET.');
  END IF;

  UPDATE public.group_settings
  SET group_name = COALESCE(NULLIF(trim(p_group_name), ''), group_name),
      monthly_contribution = p_monthly_contribution,
      burn_approvals_required = p_burn_approvals_required,
      rollover_mode = p_rollover_mode,
      reversal_window_hours = COALESCE(p_reversal_window_hours, reversal_window_hours),
      invite_code = COALESCE(NULLIF(trim(p_invite_code), ''), invite_code),
      updated_at = now()
  WHERE id = true;

  INSERT INTO public.audit_log (actor_id, action, target_id, details)
  VALUES (v_uid, 'UPDATE_SETTINGS', NULL, jsonb_build_object('monthly_contribution', p_monthly_contribution, 'burn_approvals_required', p_burn_approvals_required, 'rollover_mode', p_rollover_mode));

  PERFORM public.assert_golden_invariant();
  RETURN jsonb_build_object('ok', true, 'message', 'Group settings updated.');
END;
$$;

-- Admin helper to fetch invite code
CREATE OR REPLACE FUNCTION public.admin_get_invite_code()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_admin public.profiles%ROWTYPE;
  v_code text;
BEGIN
  SELECT * INTO v_admin FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND OR v_admin.role <> 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ADMIN_ONLY', 'message', 'Admin only.');
  END IF;
  SELECT invite_code INTO v_code FROM public.group_settings WHERE id = true;
  RETURN jsonb_build_object('ok', true, 'invite_code', v_code);
END;
$$;

-- 21b. get_ping (keep-alive endpoint granted to anon & authenticated)
CREATE OR REPLACE FUNCTION public.get_ping()
RETURNS timestamptz
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT now();
$$;

-- -----------------------------------------------------------------------------
-- 3.6 RLS POLICIES & PRIVILEGES
-- -----------------------------------------------------------------------------

ALTER TABLE public.group_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposit_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.burn_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.split_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.split_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escrow_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fund_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Revoke all direct writes from anon and authenticated across tables
REVOKE ALL ON public.user_secrets FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ledger_transactions FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.group_settings FROM PUBLIC, anon, authenticated;
REVOKE INSERT, DELETE, TRUNCATE ON public.profiles FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.deposit_claims FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.burn_requests FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.split_requests FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.split_participants FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.escrow_matches FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.payment_requests FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.fund_reconciliations FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.notifications FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_log FROM PUBLIC, anon, authenticated;

-- Column-level SELECT on group_settings hiding invite_code from non-admin direct SELECT
REVOKE SELECT ON public.group_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, group_name, currency, peg, monthly_contribution, burn_approvals_required, rollover_mode, reversal_window_hours, updated_at)
  ON public.group_settings TO authenticated;

-- Column-level UPDATE on profiles (only full_name and avatar_url)
REVOKE UPDATE ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (full_name, avatar_url) ON public.profiles TO authenticated;

-- Policies
DROP POLICY IF EXISTS group_settings_select ON public.group_settings;
CREATE POLICY group_settings_select ON public.group_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS ledger_select_all ON public.ledger_transactions;
CREATE POLICY ledger_select_all ON public.ledger_transactions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS deposit_claims_select ON public.deposit_claims;
CREATE POLICY deposit_claims_select ON public.deposit_claims
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS burn_requests_select ON public.burn_requests;
CREATE POLICY burn_requests_select ON public.burn_requests
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS payment_requests_select ON public.payment_requests;
CREATE POLICY payment_requests_select ON public.payment_requests
  FOR SELECT TO authenticated
  USING (
    requester_id = auth.uid() OR payer_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS split_requests_select ON public.split_requests;
CREATE POLICY split_requests_select ON public.split_requests
  FOR SELECT TO authenticated
  USING (
    creator_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.split_participants sp WHERE sp.split_id = id AND sp.user_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS split_participants_select ON public.split_participants;
CREATE POLICY split_participants_select ON public.split_participants
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.split_requests sr WHERE sr.id = split_id AND sr.creator_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS escrow_matches_select ON public.escrow_matches;
CREATE POLICY escrow_matches_select ON public.escrow_matches
  FOR SELECT TO authenticated
  USING (
    creator_id = auth.uid() OR opponent_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS fund_reconciliations_select ON public.fund_reconciliations;
CREATE POLICY fund_reconciliations_select ON public.fund_reconciliations
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS audit_log_select_admin ON public.audit_log;
CREATE POLICY audit_log_select_admin ON public.audit_log
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- Views permissions
REVOKE ALL ON public.wallet_balances FROM PUBLIC, anon;
REVOKE ALL ON public.vagafund_summary FROM PUBLIC, anon;
REVOKE ALL ON public.monthly_deposit_status FROM PUBLIC, anon;
GRANT SELECT ON public.wallet_balances TO authenticated;
GRANT SELECT ON public.vagafund_summary TO authenticated;
GRANT SELECT ON public.monthly_deposit_status TO authenticated;

-- RPC Execute Grants
REVOKE EXECUTE ON FUNCTION public.assert_golden_invariant() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._verify_user_pin(uuid, text) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.has_pin_set() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_pin_set() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.set_pin(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_pin(text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.trade_vagacoin(uuid, bigint, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trade_vagacoin(uuid, bigint, text, text, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_payment_request(uuid, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_payment_request(uuid, bigint, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.request_reversal(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_reversal(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.respond_payment_request(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_payment_request(uuid, boolean, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.cancel_payment_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_payment_request(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.submit_deposit_claim(text, bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_deposit_claim(text, bigint, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_burn_request(bigint, text, public.burn_kind) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_burn_request(bigint, text, public.burn_kind) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.cancel_burn_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_burn_request(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.approve_and_execute_burn(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_and_execute_burn(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_split_request(text, bigint, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_split_request(text, bigint, uuid[], boolean) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.pay_split_share(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_split_share(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.decline_split_share(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_split_share(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.cancel_split_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_split_request(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_escrow_match(text, bigint, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_escrow_match(text, bigint, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.accept_escrow_match(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_escrow_match(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.cancel_escrow_match(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_escrow_match(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.report_escrow_result(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_escrow_result(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.settle_escrow_match(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_escrow_match(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.mark_notifications_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_approve_deposit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_approve_deposit(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_reject_deposit(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_deposit(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_reject_burn(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_burn(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_member_exit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_member_exit(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_run_settlement(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_run_settlement(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_record_reconciliation(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_record_reconciliation(bigint, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_update_settings(text, bigint, int, text, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_settings(text, bigint, int, text, int, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_get_invite_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_invite_code() TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_ping() TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3.7 STORAGE & REALTIME
-- -----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'receipts',
  'receipts',
  false,
  204800,
  ARRAY['image/webp', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 204800,
    allowed_mime_types = ARRAY['image/webp', 'image/jpeg', 'image/png'];

DROP POLICY IF EXISTS receipts_insert_own ON storage.objects;
CREATE POLICY receipts_insert_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'receipts' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS receipts_select_own_or_admin ON storage.objects;
CREATE POLICY receipts_select_own_or_admin ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'receipts' AND (
      (storage.foldername(name))[1] = auth.uid()::text OR
      EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

DO $$
DECLARE
  v_tbl text;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'ledger_transactions',
    'deposit_claims',
    'burn_requests',
    'split_requests',
    'split_participants',
    'escrow_matches',
    'payment_requests',
    'notifications',
    'fund_reconciliations'
  ] LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_tbl);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 3.8 SANITY CHECKS (Copy-paste in SQL Editor to verify invariants)
-- -----------------------------------------------------------------------------
/*
-- 1. Check Golden Invariant & Vault Sync (expect is_ledger_synced = true)
SELECT
  total_minted,
  total_burned,
  active_vgc_supply,
  sum_of_user_balances,
  fund_cash_pkr,
  last_bank_balance_pkr,
  bank_variance_pkr,
  is_ledger_synced
FROM public.vagafund_summary;

-- 2. Prove no user has a negative available or ledger balance (expect 0 rows)
SELECT user_id, full_name, ledger_balance, locked_in_escrow, reserved_for_burn, available_vgc_balance
FROM public.wallet_balances
WHERE ledger_balance < 0 OR available_vgc_balance < 0;

-- 3. Prove there are no duplicate MINTs per (receiver_id, month_tag) (expect 0 rows)
SELECT receiver_id, month_tag, count(*)
FROM public.ledger_transactions
WHERE tx_kind = 'MINT'
GROUP BY receiver_id, month_tag
HAVING count(*) > 1;
*/
