create extension if not exists pgcrypto;
create type public.punch_action as enum ('clock_in','clock_out');
create table public.locations(id uuid primary key default gen_random_uuid(),name text not null unique,code text not null unique,active boolean not null default true);
create table public.job_titles(id uuid primary key default gen_random_uuid(),name text not null unique,active boolean not null default true);
create table public.employees(id uuid primary key default gen_random_uuid(),employee_number text not null unique,first_name text not null,last_name text not null,pin_hash text not null,primary_location_id uuid not null references public.locations(id),job_title_id uuid references public.job_titles(id),active boolean not null default true,created_at timestamptz not null default now());
create table public.kiosks(id uuid primary key default gen_random_uuid(),location_id uuid not null references public.locations(id),name text not null,token text not null unique,active boolean not null default true,created_at timestamptz not null default now());
create table public.punch_events(id uuid primary key default gen_random_uuid(),employee_id uuid not null references public.employees(id),location_id uuid not null references public.locations(id),kiosk_id uuid not null references public.kiosks(id),action public.punch_action not null,occurred_at timestamptz not null default now());
create index punch_events_employee_time_idx on public.punch_events(employee_id,occurred_at desc);
alter table public.locations enable row level security;alter table public.job_titles enable row level security;alter table public.employees enable row level security;alter table public.kiosks enable row level security;alter table public.punch_events enable row level security;
insert into public.locations(name,code) values ('Amityville','336'),('Bohemia','1611'),('Riverhead','1133'),('Windham','730') on conflict do nothing;
insert into public.job_titles(name) values ('Branch Manager'),('Sales'),('Warehouse'),('Driver'),('Administration'),('Director of Operations') on conflict do nothing;
-- Create employees through the Supabase SQL editor after generating a bcrypt PIN hash.
-- The server service-role key is the only key allowed to read or write these protected tables.
