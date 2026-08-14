alter table public.crm_prospects
  add column if not exists product_interests text[] not null default '{}'::text[];

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_prospects_product_interests_allowed'
      and conrelid = 'public.crm_prospects'::regclass
  ) then
    alter table public.crm_prospects
      add constraint crm_prospects_product_interests_allowed
      check (
        product_interests <@ array['Doors','Moulding','PVC','Kitchen','Entry Doors']::text[]
      );
  end if;
end $$;

create index if not exists crm_prospects_product_interests_idx
  on public.crm_prospects using gin (product_interests);
