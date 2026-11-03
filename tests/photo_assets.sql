-- Disposable database only, after reporters.sql, activity_log.sql and photo_assets.sql.
begin;
do $$
begin
  assert not has_table_privilege('anon', 'public.photo_assets', 'SELECT');
  assert not has_table_privilege('authenticated', 'public.photo_assets', 'UPDATE');
  assert not has_function_privilege('anon', 'public.claim_photo_cleanup(text,integer)', 'EXECUTE');
  assert not has_function_privilege('authenticated', 'public.claim_photo_cleanup(text,integer)', 'EXECUTE');
  assert public.photo_asset_key('https://res.cloudinary.com/news/image/upload/v1/96news/reporters/shared.webp')
    = public.photo_asset_key('https://res.cloudinary.com/news/image/upload/w_100/v99/96news/reporters/shared.jpg?x=1');
  assert public.photo_asset_key('https://res.cloudinary.com/news/image/upload/96news/reporters/shared.png') = 'news/96news/reporters/shared';
  assert public.photo_asset_key('https://res.cloudinary.com/NEWS/image/upload/w_100/v99/96news%2Freporters%2F%73hared.jpg') = 'news/96news/reporters/shared';
  assert public.photo_asset_key('https://res.cloudinary.com/news/image/upload/v1/96news/reporters/shared.webp?note=%E2%9C%93') = 'news/96news/reporters/shared';
  assert public.photo_asset_key('https://res.cloudinary.com/other/image/upload/v1/96news/reporters/shared.webp') <> 'news/96news/reporters/shared';
end;
$$;
set local role service_role;
insert into public.photo_assets (public_id, url, created_at, status, claimed_at) values
  ('96news/reporters/shared', 'https://res.cloudinary.com/news/image/upload/v1/96news/reporters/shared.webp', now() - interval '2 days', 'ready', null),
  ('96news/reporters/old', 'https://res.cloudinary.com/news/image/upload/v1/96news/reporters/old.webp', now() - interval '2 days', 'ready', null),
  ('96news/reporters/fresh', 'https://res.cloudinary.com/news/image/upload/v1/96news/reporters/fresh.webp', now(), 'ready', null),
  ('96news/reporters/prior', 'https://res.cloudinary.com/news/image/upload/v1/96news/reporters/prior.webp', now(), 'ready', null),
  ('96news/reporters/stale', 'https://res.cloudinary.com/news/image/upload/v1/96news/reporters/stale.webp', now() - interval '2 days', 'deleting', now() - interval '16 minutes'),
  ('96news/reporters/leased', 'https://res.cloudinary.com/news/image/upload/v1/96news/reporters/leased.webp', now() - interval '2 days', 'deleting', now()),
  ('96news/reporters/deleted', 'https://res.cloudinary.com/news/image/upload/v1/96news/reporters/deleted.webp', now() - interval '2 days', 'deleted', now());
do $$
declare
  data jsonb;
  reporter uuid;
  assets text[];
  rejected text;
  actor uuid := '11111111-1111-4111-8111-111111111111';
begin
  data := public.mutate_reporter('create', actor, 'editor@96news.test', null,
    jsonb_build_object('name', 'Photo Test', 'father_name', 'Father', 'designation', 'Reporter',
      'city', 'Lahore', 'cnic', '99999-1111111-0', 'contact', '03000000000',
      'whatsapp', '03000000000', 'address', 'Private', 'issue_date', current_date, 'expiry_date', current_date + 10,
      'photo_url', 'https://res.cloudinary.com/NEWS/image/upload/w_100/v99/96news%2Freporters%2F%73hared.jpg?note=%E2%9C%93'));
  reporter := (data->'reporter'->>'id')::uuid;
  select array_agg(public_id order by public_id) into assets from public.claim_photo_cleanup();
  assert assets = array['96news/reporters/old', '96news/reporters/stale'];
  select array_agg(public_id) into assets from public.claim_photo_cleanup('https://res.cloudinary.com/news/image/upload/v9/96news/reporters/prior.png');
  assert assets = array['96news/reporters/prior'];
  assert not exists(select 1 from public.claim_photo_cleanup());

  foreach rejected in array array[
    'https://res.cloudinary.com/news/image/upload/v2/96news/reporters/old.webp',
    'https://res.cloudinary.com/NEWS/image/upload/v2/96news%2Freporters%2F%6Fld.webp?note=%E2%9C%93',
    'https://res.cloudinary.com/news/image/upload/w_100/v5/96news/reporters/deleted.jpg'
  ] loop
    begin
      perform public.mutate_reporter('update', actor, 'editor@96news.test', reporter, jsonb_build_object('photo_url', rejected));
      raise exception 'Unavailable photo attachment was accepted';
    exception when sqlstate '55000' then null;
    end;
  end loop;
  assert (select count(*) = 1 from public.activity_log where reporter_id = reporter);
  assert (select photo_url like '%73hared.jpg?note=%E2%9C%93' from public.reporters where id = reporter);
  perform public.mutate_reporter('delete', actor, 'editor@96news.test', reporter);
  select array_agg(public_id) into assets from public.claim_photo_cleanup();
  assert assets = array['96news/reporters/shared'];
end;
$$;
reset role;
rollback;
