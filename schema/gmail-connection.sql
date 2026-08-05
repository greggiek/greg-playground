create table if not exists public.crm_gmail_connections (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  refresh_token_encrypted text not null,
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.crm_gmail_connections enable row level security;
revoke all on public.crm_gmail_connections from anon, authenticated;
grant select, insert, update, delete on public.crm_gmail_connections to service_role;
