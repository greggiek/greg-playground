create table public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  notes text not null default '',
  task_type text not null default 'follow_up' check (task_type in ('follow_up','call','email','quote','admin')),
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  due_date date not null,
  assigned_to text not null,
  prospect_id uuid references public.crm_prospects(id) on delete set null,
  status text not null default 'open' check (status in ('open','completed')),
  created_by text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.crm_tasks enable row level security;
revoke all on public.crm_tasks from anon, authenticated;
grant select, insert, update, delete on public.crm_tasks to service_role;
create index crm_tasks_assignee_due_idx on public.crm_tasks(assigned_to, status, due_date);
create index crm_tasks_prospect_idx on public.crm_tasks(prospect_id);
