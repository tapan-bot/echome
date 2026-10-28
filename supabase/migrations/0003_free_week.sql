-- ---------------------------------------------------------------------------
-- The free introduction becomes a free week.
--
-- It used to be one free conversation, marked as used by the first message, which
-- ended it after a single message. Now a person's first message starts a week
-- (7 days, set in lib/config/pricing.ts) in which they can hold as many
-- conversations as they like.
--
-- RUN THIS BEFORE DEPLOYING the code that reads it.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists free_week_started_at timestamptz;

comment on column public.profiles.free_week_started_at is
  'When this person''s free week began: their first message. Null until then. Once per account, forever.';

-- Anyone who already used the old one-conversation introduction (which ended after one
-- message) gets their week starting now, rather than being left with nothing.
update public.profiles
   set free_week_started_at = now()
 where free_intro_used
   and free_week_started_at is null;
