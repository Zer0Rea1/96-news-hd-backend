create or replace function public.assign_reporter_serial() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if nullif(btrim(coalesce(new.serial_number,'')),'') is not null then
  new.serial_number=btrim(new.serial_number);
 elsif tg_op='UPDATE' and nullif(btrim(coalesce(old.serial_number,'')),'') is not null then
  new.serial_number=old.serial_number;
 else
  new.serial_number='96N/'||nextval('public.reporter_serial_seq')::text||'/'||extract(year from new.expiry_date)::integer::text;
 end if;
 return new;
end $$;
