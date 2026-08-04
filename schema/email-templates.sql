create table public.crm_email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  subject text not null check (char_length(subject) between 1 and 300),
  body text not null check (char_length(body) between 1 and 20000),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.crm_email_templates enable row level security;
revoke all on table public.crm_email_templates from anon, authenticated;
grant select, insert, update, delete on table public.crm_email_templates to service_role;
create index crm_email_templates_updated_idx on public.crm_email_templates (updated_at desc);
