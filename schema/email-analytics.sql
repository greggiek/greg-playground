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

create table public.crm_email_campaigns (
  id uuid primary key default gen_random_uuid(), name text not null, subject text not null, body text not null,
  status text not null default 'sending' check (status in ('sending','completed','completed_with_errors','failed')),
  total_recipients integer not null default 0, created_by text not null, created_at timestamptz not null default now(), completed_at timestamptz
);
create table public.crm_email_unsubscribes (
  email text primary key, token uuid not null unique default gen_random_uuid(), unsubscribed_at timestamptz not null default now(),
  source_campaign_id uuid references public.crm_email_campaigns(id) on delete set null
);
alter table public.crm_email_messages add column campaign_id uuid references public.crm_email_campaigns(id) on delete set null;
alter table public.crm_email_messages add column unsubscribe_token uuid not null default gen_random_uuid();
alter table public.crm_email_campaigns enable row level security;
alter table public.crm_email_unsubscribes enable row level security;
revoke all on public.crm_email_campaigns, public.crm_email_unsubscribes from anon, authenticated;
grant select, insert, update, delete on public.crm_email_campaigns, public.crm_email_unsubscribes to service_role;

create table public.crm_users (
  id uuid primary key default gen_random_uuid(), email text not null unique, name text not null,
  role text not null default 'sales_rep' check (role in ('manager','sales_rep')),
  access_code_hash text not null unique, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.crm_users enable row level security;
revoke all on public.crm_users from anon, authenticated;
grant select, insert, update, delete on public.crm_users to service_role;
alter table public.crm_email_messages add column sender_email text not null;
alter table public.crm_email_campaigns add column sender_email text not null;
