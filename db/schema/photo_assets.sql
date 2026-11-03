-- Only new uploads registered by this app are eligible for cleanup; legacy images remain untouched.
create table public.photo_assets (
  public_id text primary key check (public_id ~ '^96news/reporters/[a-zA-Z0-9_-]+$'),
  url text not null unique check (url ~ '^https://res[.]cloudinary[.]com/[a-zA-Z0-9_-]+/image/upload/v[0-9]+/96news/reporters/[a-zA-Z0-9_-]+[.]webp$'),
  status text not null default 'ready' check (status in ('ready', 'deleting', 'deleted')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  check (status = 'ready' or claimed_at is not null)
);
alter table public.photo_assets enable row level security;
revoke all on table public.photo_assets from public, anon, authenticated;
grant select, insert, update on table public.photo_assets to service_role;
create index photo_assets_cleanup_idx on public.photo_assets (status, created_at);

-- Versions, transformations and delivery formats can refer to the same Cloudinary image.
create function public.photo_asset_key(p_url text) returns text
language plpgsql immutable strict parallel safe set search_path = '' as $$
declare
  raw_url text := split_part(split_part(p_url, '?', 1), '#', 1);
  decoded_url text := '';
  cursor_position integer := 1;
  current_character text;
  byte_value integer;
  parts text[];
begin
  -- Decode only the managed path alphabet; encoded delimiters must remain part of the path.
  while cursor_position <= length(raw_url) loop
    current_character := substr(raw_url, cursor_position, 1);
    if current_character = '%' and substr(raw_url, cursor_position + 1, 2) ~ '^[0-9a-fA-F]{2}$' then
      byte_value := get_byte(decode(substr(raw_url, cursor_position + 1, 2), 'hex'), 0);
      if byte_value between 48 and 57 or byte_value between 65 and 90
        or byte_value between 97 and 122 or byte_value in (45, 46, 47, 95) then
        decoded_url := decoded_url || chr(byte_value);
      else
        decoded_url := decoded_url || substr(raw_url, cursor_position, 3);
      end if;
      cursor_position := cursor_position + 3;
    else
      decoded_url := decoded_url || current_character;
      cursor_position := cursor_position + 1;
    end if;
  end loop;
  parts := regexp_match(decoded_url, '^https://res[.]cloudinary[.]com/([a-zA-Z0-9_-]+)/image/upload/(?:[^?#]*/)?(96news/reporters/[a-zA-Z0-9_-]+)(?:[.][a-zA-Z0-9]+)?(?:[?#].*)?$');
  return lower(parts[1]) || '/' || parts[2];
end;
$$;
revoke execute on function public.photo_asset_key(text) from public, anon, authenticated;
grant execute on function public.photo_asset_key(text) to service_role;
create index reporters_photo_asset_idx on public.reporters (public.photo_asset_key(photo_url));

create function public.guard_reporter_photo() returns trigger
language plpgsql set search_path = '' as $$
declare photo_status text;
begin
  select a.status into photo_status from public.photo_assets a
  where public.photo_asset_key(a.url) = public.photo_asset_key(new.photo_url)
  for share;
  if found and photo_status <> 'ready' then
    raise exception using errcode = '55000', message = 'This photo is no longer available. Upload another photo.';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_reporter_photo() from public, anon, authenticated;
grant execute on function public.guard_reporter_photo() to service_role;
create trigger reporter_photo_guard before insert or update of photo_url on public.reporters
for each row execute function public.guard_reporter_photo();

create function public.claim_photo_cleanup(p_prior_url text default null, p_limit integer default 25)
returns table (public_id text, url text)
language plpgsql set search_path = '' as $$
begin
  if p_limit is null or p_limit not between 1 and 25 then
    raise exception using errcode = '22023', message = 'Invalid cleanup batch size.';
  end if;
  return query
  with candidates as (
    select a.public_id from public.photo_assets a
    where (
      (a.status = 'ready' and (a.created_at < now() - interval '24 hours'
        or public.photo_asset_key(a.url) = public.photo_asset_key(p_prior_url)))
      or (a.status = 'deleting' and a.claimed_at < now() - interval '15 minutes')
    ) and not exists (
      select 1 from public.reporters r where public.photo_asset_key(r.photo_url) = public.photo_asset_key(a.url)
    )
    order by a.created_at, a.public_id
    for update skip locked
    limit p_limit
  )
  update public.photo_assets a set status = 'deleting', claimed_at = now()
  from candidates c where a.public_id = c.public_id
  returning a.public_id, a.url;
end;
$$;
revoke execute on function public.claim_photo_cleanup(text, integer) from public, anon, authenticated;
grant execute on function public.claim_photo_cleanup(text, integer) to service_role;
