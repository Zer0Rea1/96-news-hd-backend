-- Preserve printed serials; issue new ones atomically across every reporter creation path.
lock table public.reporters in share row exclusive mode;
create sequence public.reporter_serial_seq as bigint start with 1;
select setval('public.reporter_serial_seq',coalesce(max(substring(serial_number from '^96N/([0-9]{1,15})/[0-9]{4}$')::bigint),0)+1,false) from public.reporters;
revoke all on sequence public.reporter_serial_seq from public,anon,authenticated;
grant usage,select on sequence public.reporter_serial_seq to service_role;
create function public.assign_reporter_serial() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and nullif(btrim(old.serial_number),'') is not null then
  new.serial_number=old.serial_number;
 else
  new.serial_number='96N/'||nextval('public.reporter_serial_seq')::text||'/'||extract(year from new.expiry_date)::integer::text;
 end if;
 return new;
end $$;
revoke all on function public.assign_reporter_serial() from public,anon,authenticated;
grant execute on function public.assign_reporter_serial() to service_role;
create trigger reporter_serial before insert or update of serial_number on public.reporters for each row execute function public.assign_reporter_serial();
update public.reporters set serial_number='' where btrim(serial_number)='';
create unique index reporters_serial_unique on public.reporters(serial_number) where serial_number<>'';
