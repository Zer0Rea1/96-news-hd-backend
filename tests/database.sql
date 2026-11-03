-- Run only against a disposable database after applying reporters.sql.
begin;
insert into public.reporters (name, father_name, designation, city, cnic, contact, whatsapp, address, issue_date, expiry_date)
values ('Test Reporter','Test Father','Reporter','Lahore','35202-1234567-1','+923001234567','+923001234567','Private address','2026-01-01','2027-12-31');
do $$
declare row public.reporters;
begin
  select * into row from public.reporters limit 1;
  assert row.card_number = 1001, 'Card numbering must start at 1001';
  assert row.status = 'draft', 'New credentials must be private';
  assert row.serial_number = '', 'Existing clients must be able to omit serial numbers';
  update public.reporters set serial_number = '00042' where id = row.id;
  assert (select serial_number = '00042' from public.reporters where id = row.id), 'Serial numbers must preserve leading zeros';
  assert not row.show_sensitive, 'CNIC and address must be private by default';
  assert (select relrowsecurity from pg_class where oid = 'public.reporters'::regclass), 'RLS must be enabled';
  assert not has_table_privilege('anon','public.reporters','SELECT'), 'Anonymous access must be denied';
  assert not has_table_privilege('authenticated','public.reporters','UPDATE'), 'Authenticated users must not bypass the API';
  assert has_table_privilege('service_role','public.reporters','INSERT'), 'Server must be able to create reporters';
  begin
    insert into public.reporters (name, father_name, designation, city, cnic, contact, whatsapp, address, issue_date, expiry_date)
    values ('Duplicate','Father','Reporter','Lahore','35202-1234567-1','+923001234567','+923001234567','Address','2026-01-01','2027-12-31');
    raise exception 'Duplicate CNIC was accepted';
  exception when unique_violation then null;
  end;
  begin
    update public.reporters set expiry_date = '2025-01-01' where id = row.id;
    raise exception 'Invalid date range was accepted';
  exception when check_violation then null;
  end;
  update public.reporters set updated_at = '2020-01-01' where id = row.id;
  assert (select updated_at > '2020-01-01'::timestamptz from public.reporters where id = row.id), 'Update timestamp trigger must run';
end;
$$;
rollback;
