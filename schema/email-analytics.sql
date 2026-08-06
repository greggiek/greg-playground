create table public.crm_email_messages (
  id uuid primary key default gen_random_uuid(), recipient_email text not null, recipient_name text not null default '', subject text not null,
  status text not null default 'queued' check (status in ('queued','sent','failed')), gmail_message_id text, open_token uuid not null unique default gen_random_uuid(),
  first_opened_at timestamptz, first_clicked_at timestamptz, created_by text not null, created_at timestamptz not null default now(), sent_at timestamptz, error text
);
create table public.crm_email_links (
  id uuid primary key default gen_random_uuid(), message_id uuid not null references public.crm_email_messages(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(), url text not null, first_clicked_at timestamptz, created_at timestamptz not null default now()
);
alter table public.crm_email_messages enable row level security;
alter table public.crm_email_links enable row level security;
revoke all on public.crm_email_messages, public.crm_email_links from anon, authenticated;
grant select, insert, update, delete on public.crm_email_messages, public.crm_email_links to service_role;
