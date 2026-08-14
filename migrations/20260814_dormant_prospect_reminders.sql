create extension if not exists pg_cron;

create table if not exists public.crm_dormant_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  inactivity_days integer not null default 30 check (inactivity_days between 1 and 365),
  due_in_days integer not null default 1 check (due_in_days between 0 and 30),
  stages text[] not null default array['New Lead','Contacted','Quoting','Follow-Up']::text[],
  skip_if_open_task boolean not null default true,
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  updated_by text not null default 'System',
  last_run_at timestamptz,
  last_created_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.crm_dormant_settings (id)
values (true)
on conflict (id) do nothing;

alter table public.crm_dormant_settings enable row level security;

alter table public.crm_prospects
  add column if not exists last_dormant_reminder_at timestamptz;

alter table public.crm_tasks
  add column if not exists automation_type text;

create index if not exists crm_activities_prospect_created_idx
  on public.crm_activities (prospect_id, created_at desc);

create index if not exists crm_tasks_open_prospect_idx
  on public.crm_tasks (prospect_id)
  where status = 'open';

create index if not exists crm_email_messages_recipient_sent_idx
  on public.crm_email_messages (lower(recipient_email), sent_at desc)
  where status = 'sent';

create or replace function public.crm_run_dormant_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  config public.crm_dormant_settings%rowtype;
  created_count integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('bm_prospect_dormant_reminders'));

  select *
  into config
  from public.crm_dormant_settings
  where id = true;

  if not found or not config.enabled then
    return 0;
  end if;

  with contact_activity as (
    select
      p.id,
      p.company_name,
      p.owner_name,
      greatest(
        p.created_at,
        coalesce(p.last_dormant_reminder_at, p.created_at),
        coalesce((
          select max(a.created_at)
          from public.crm_activities a
          where a.prospect_id = p.id
            and a.activity_type not in ('created', 'dormant_reminder')
        ), p.created_at),
        coalesce((
          select max(q.created_at)
          from public.crm_quotes q
          where q.prospect_id = p.id
        ), p.created_at),
        coalesce((
          select max(coalesce(m.sent_at, m.created_at))
          from public.crm_email_messages m
          where nullif(trim(p.email), '') is not null
            and lower(m.recipient_email) = lower(trim(p.email))
            and m.status = 'sent'
        ), p.created_at)
      ) as last_contact_at
    from public.crm_prospects p
    where p.stage = any(config.stages)
      and exists (
        select 1
        from public.crm_users u
        where u.active = true
          and u.name = p.owner_name
      )
  ),
  eligible as (
    select ca.*
    from contact_activity ca
    where ca.last_contact_at <= now() - make_interval(days => config.inactivity_days)
      and (
        not config.skip_if_open_task
        or not exists (
          select 1
          from public.crm_tasks t
          where t.prospect_id = ca.id
            and t.status = 'open'
        )
      )
  ),
  inserted as (
    insert into public.crm_tasks (
      title,
      notes,
      task_type,
      priority,
      due_date,
      assigned_to,
      prospect_id,
      status,
      created_by,
      automation_type
    )
    select
      'Reach out to ' || e.company_name,
      'Automatic dormant-prospect reminder: no recorded contact for ' || config.inactivity_days || ' days.',
      'follow_up',
      config.priority,
      current_date + config.due_in_days,
      e.owner_name,
      e.id,
      'open',
      'BM Prospect Automation',
      'dormant_prospect'
    from eligible e
    returning prospect_id
  ),
  updated as (
    update public.crm_prospects p
    set last_dormant_reminder_at = now()
    where p.id in (select prospect_id from inserted)
    returning p.id
  )
  select count(*) into created_count from inserted;

  update public.crm_dormant_settings
  set last_run_at = now(),
      last_created_count = created_count,
      updated_at = now()
  where id = true;

  return created_count;
end;
$function$;

revoke all on function public.crm_run_dormant_reminders() from public;
grant execute on function public.crm_run_dormant_reminders() to service_role;

do $schedule$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'bm-prospect-dormant-reminders'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'bm-prospect-dormant-reminders',
    '0 13 * * *',
    'select public.crm_run_dormant_reminders();'
  );
end;
$schedule$;
