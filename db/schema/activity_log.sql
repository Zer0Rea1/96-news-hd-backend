create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid not null,
  actor_email text not null,
  reporter_id uuid not null,
  reporter_name text not null,
  serial_number text not null default '',
  action text not null check (action in ('created', 'updated', 'revoked', 'renewed', 'deleted')),
  changed_fields text[] not null default '{}'
);
create index activity_log_created_at_idx on public.activity_log (created_at desc, id desc);
alter table public.activity_log enable row level security;
revoke all on public.activity_log from public, anon, authenticated, service_role;
grant select, insert on public.activity_log to service_role;

-- One transaction keeps each application mutation and its audit entry together.
-- shortcut: direct SQL edits bypass this log; add reporter triggers before introducing other writers.
create function public.mutate_reporter(
  p_action text,
  p_actor_id uuid,
  p_actor_email text,
  p_reporter_id uuid default null,
  p_input jsonb default '{}'
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  previous public.reporters;
  desired public.reporters;
  result public.reporters;
  activity_action text;
  changed text[];
begin
  if p_actor_id is null or coalesce(p_actor_email, '') = '' then
    raise exception 'Administrator identity is required' using errcode = '22023';
  end if;
  if p_action is null or p_action not in ('create', 'update', 'delete', 'renew') then
    raise exception 'Invalid reporter action' using errcode = '22023';
  end if;
  if jsonb_typeof(p_input) is distinct from 'object' or exists (
    select 1 from jsonb_object_keys(p_input) k
    where k not in ('name', 'serial_number', 'father_name', 'designation', 'city', 'cnic',
      'contact', 'whatsapp', 'address', 'issue_date', 'expiry_date', 'status', 'show_sensitive', 'photo_url')
  ) then
    raise exception 'Invalid reporter fields' using errcode = '22023';
  end if;

  if p_action = 'create' then
    desired := jsonb_populate_record(null::public.reporters, p_input);
    insert into public.reporters (name, serial_number, father_name, designation, city, cnic,
      contact, whatsapp, address, issue_date, expiry_date, status, show_sensitive, photo_url)
    values (desired.name, coalesce(desired.serial_number, ''), desired.father_name,
      desired.designation, desired.city, desired.cnic, desired.contact, desired.whatsapp,
      desired.address, desired.issue_date, desired.expiry_date, coalesce(desired.status, 'draft'),
      coalesce(desired.show_sensitive, false), coalesce(desired.photo_url, ''))
    returning * into result;
    activity_action := 'created';
  else
    select * into previous from public.reporters where id = p_reporter_id for update;
    if not found then return null; end if;
    if p_action = 'delete' then
      delete from public.reporters where id = p_reporter_id returning * into result;
      activity_action := 'deleted';
    elsif p_action = 'renew' then
      if previous.status in ('draft', 'revoked') then
        raise exception 'Edit this credential before renewing it' using errcode = 'P0001';
      end if;
      if p_input->>'expiry_date' is null or p_input->>'issue_date' is null
        or (p_input->>'expiry_date')::date <= previous.expiry_date
        or (p_input->>'expiry_date')::date < (now() at time zone 'UTC')::date then
        raise exception 'Renewal must extend the current expiry date' using errcode = 'P0001';
      end if;
      update public.reporters set issue_date = (p_input->>'issue_date')::date,
        expiry_date = (p_input->>'expiry_date')::date, status = 'active'
      where id = p_reporter_id returning * into result;
      activity_action := 'renewed';
    else
      desired := jsonb_populate_record(previous, p_input);
      update public.reporters set name = desired.name, serial_number = desired.serial_number,
        father_name = desired.father_name, designation = desired.designation, city = desired.city,
        cnic = desired.cnic, contact = desired.contact, whatsapp = desired.whatsapp,
        address = desired.address, issue_date = desired.issue_date, expiry_date = desired.expiry_date,
        status = desired.status, show_sensitive = desired.show_sensitive, photo_url = desired.photo_url
      where id = p_reporter_id returning * into result;
      activity_action := case when previous.status <> 'revoked' and result.status = 'revoked'
        then 'revoked' else 'updated' end;
    end if;
  end if;

  select coalesce(array_agg(key order by key), '{}') into changed
  from jsonb_each(to_jsonb(result) - array['id', 'card_number', 'created_at', 'updated_at'])
  where value is distinct from to_jsonb(previous)->key;
  insert into public.activity_log (actor_id, actor_email, reporter_id, reporter_name,
    serial_number, action, changed_fields)
  values (p_actor_id, p_actor_email, result.id, result.name, result.serial_number,
    activity_action, case when p_action = 'delete' then '{}' else changed end);
  return jsonb_build_object('reporter', to_jsonb(result), 'previous_photo_url', coalesce(previous.photo_url, ''));
end;
$$;
revoke all on function public.mutate_reporter(text, uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.mutate_reporter(text, uuid, text, uuid, jsonb) to service_role;
