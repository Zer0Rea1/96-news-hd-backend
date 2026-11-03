-- Apply once in Supabase SQL Editor. Only the Express service client accesses this table.
create table public.reporters (
  id uuid primary key default gen_random_uuid(),
  card_number bigint generated always as identity (start with 1001) unique,
  name text not null check (length(name) between 1 and 100),
  father_name text not null check (length(father_name) between 1 and 100),
  designation text not null check (length(designation) between 1 and 100),
  city text not null check (length(city) between 1 and 100),
  cnic text not null unique check (cnic ~ '^\d{5}-\d{7}-\d$'),
  contact text not null,
  whatsapp text not null,
  address text not null check (length(address) between 1 and 500),
  issue_date date not null,
  expiry_date date not null check (expiry_date >= issue_date),
  status text not null default 'draft' check (status in ('active', 'draft', 'revoked')),
  show_sensitive boolean not null default false,
  photo_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  serial_number text not null default '' check (length(serial_number) <= 100)
);
alter table public.reporters enable row level security;
revoke all on table public.reporters from anon, authenticated;
grant all on table public.reporters to service_role;
grant usage, select on sequence public.reporters_card_number_seq to service_role;
create function public.reporter_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger reporter_updated_at before update on public.reporters for each row execute function public.reporter_updated_at();
