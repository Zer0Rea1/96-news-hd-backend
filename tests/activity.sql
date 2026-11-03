-- Disposable database only, after reporters.sql and activity_log.sql. All test data rolls back.
begin;
do $$
begin
  assert not has_function_privilege('anon', 'public.mutate_reporter(text,uuid,text,uuid,jsonb)', 'EXECUTE');
  assert not has_function_privilege('authenticated', 'public.mutate_reporter(text,uuid,text,uuid,jsonb)', 'EXECUTE');
  assert not has_table_privilege('anon', 'public.activity_log', 'SELECT');
  assert not has_table_privilege('authenticated', 'public.activity_log', 'SELECT');
  assert not has_table_privilege('service_role', 'public.activity_log', 'UPDATE');
  assert not has_table_privilege('service_role', 'public.activity_log', 'DELETE');
  assert not (select prosecdef from pg_proc where oid = 'public.mutate_reporter(text,uuid,text,uuid,jsonb)'::regprocedure);
end;
$$;
set local role service_role;
do $$
declare
  actor uuid := '11111111-1111-4111-8111-111111111111';
  today date := (now() at time zone 'UTC')::date;
  data jsonb;
  reporter uuid;
  photo text := 'https://res.cloudinary.com/news/image/upload/test.webp';
  fields text[];
begin
  data := public.mutate_reporter('create', actor, 'editor@96news.test', null,
    jsonb_build_object('name', 'Audit Test', 'serial_number', '00042', 'father_name', 'Test Father',
      'designation', 'Reporter', 'city', 'Lahore', 'cnic', '99999-1234567-0',
      'contact', '03000000000', 'whatsapp', '03000000000', 'address', 'Private address',
      'issue_date', today, 'expiry_date', today + 10, 'status', 'active', 'photo_url', photo));
  reporter := (data->'reporter'->>'id')::uuid;
  assert data->'reporter'->>'serial_number' = '00042';
  assert (select count(*) = 1 from public.activity_log where reporter_id = reporter and actor_id = actor and action = 'created');
  assert not exists(select 1 from public.activity_log where reporter_id = reporter and to_jsonb(activity_log)::text like '%Private address%');

  perform public.mutate_reporter('update', actor, 'editor@96news.test', reporter,
    '{"cnic":"99999-7654321-0","address":"Another private address"}');
  select changed_fields into fields from public.activity_log where reporter_id = reporter and action = 'updated';
  assert fields = array['address', 'cnic'];
  assert not exists(select 1 from public.activity_log where reporter_id = reporter and to_jsonb(activity_log)::text like '%7654321%');
  perform public.mutate_reporter('update', actor, 'editor@96news.test', reporter, '{"status":"revoked"}');
  begin
    perform public.mutate_reporter('renew', actor, 'editor@96news.test', reporter,
      jsonb_build_object('issue_date', today, 'expiry_date', today + 400));
    raise exception 'Revoked credential renewal was accepted';
  exception when raise_exception then
    if sqlerrm = 'Revoked credential renewal was accepted' then raise; end if;
  end;
  assert (select count(*) = 3 from public.activity_log where reporter_id = reporter);
  perform public.mutate_reporter('update', actor, 'editor@96news.test', reporter, '{"status":"active"}');
  data := public.mutate_reporter('renew', actor, 'editor@96news.test', reporter,
    jsonb_build_object('issue_date', today, 'expiry_date', today + 400));
  assert (data->'reporter'->>'id')::uuid = reporter;
  assert data->'reporter'->>'serial_number' = '00042';
  assert data->'reporter'->>'photo_url' = photo;
  assert (select count(*) = 1 from public.activity_log where reporter_id = reporter and action = 'renewed');
  begin
    perform public.mutate_reporter('renew', actor, 'editor@96news.test', reporter,
      jsonb_build_object('issue_date', today, 'expiry_date', today + 300));
    raise exception 'Shortened expiry was accepted';
  exception when raise_exception then
    if sqlerrm = 'Shortened expiry was accepted' then raise; end if;
  end;
  data := public.mutate_reporter('delete', actor, 'editor@96news.test', reporter);
  assert data->>'previous_photo_url' = photo;
  assert not exists(select 1 from public.reporters where id = reporter);
  assert (select count(*) = 6 from public.activity_log where reporter_id = reporter);
  assert public.mutate_reporter('delete', actor, 'editor@96news.test', reporter) is null;
end;
$$;
reset role;
revoke insert on public.activity_log from service_role;
set local role service_role;
do $$
begin
  begin
    perform public.mutate_reporter('create', '11111111-1111-4111-8111-111111111111', 'editor@96news.test', null,
      jsonb_build_object('name', 'Must Roll Back', 'father_name', 'Father', 'designation', 'Reporter',
        'city', 'Lahore', 'cnic', '99999-9999999-0', 'contact', '03000000000',
        'whatsapp', '03000000000', 'address', 'Private', 'issue_date', current_date, 'expiry_date', current_date + 10));
    raise exception 'Audit write failure did not fail mutation';
  exception when insufficient_privilege then null;
  end;
  assert not exists(select 1 from public.reporters where cnic = '99999-9999999-0');
end;
$$;
reset role;
rollback;
