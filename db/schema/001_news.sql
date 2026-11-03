create extension if not exists pg_trgm with schema extensions;
create table public.news_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id) on delete restrict
);
insert into public.news_owner(user_id) values (current_setting('news.owner_id')::uuid);
create table public.news_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  slug text not null unique check (length(slug) between 1 and 100),
  legacy_category text unique
);
create unique index news_tags_name_idx on public.news_tags(lower(name));
insert into public.news_tags(name,slug,legacy_category) values
 ('پاکستان','pakistan','pakistan-news'),('دنیا','world','international-news'),
 ('کھیل','sports','sports-news'),('کاروبار','business','business-news'),
 ('صحت','health','health-news'),('سائنس','science','science-news');
create table public.news_posts (
  id text primary key check (length(id) between 1 and 100),
  slug text not null unique check (length(slug) between 1 and 200),
  title text not null check (length(trim(title)) between 1 and 500),
  article text not null check (length(article) between 1 and 100000),
  thumbnail_url text not null check (thumbnail_url ~ '^https://res[.]cloudinary[.]com/'),
  cloudinary_public_id text,
  author_name text not null,
  status text not null default 'draft' check (status in ('draft','published')),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  legacy_document jsonb
);
create index news_posts_published_idx on public.news_posts(published_at desc,id desc) where status='published';
create index news_posts_admin_idx on public.news_posts(published_at desc,id desc);
create index news_posts_title_idx on public.news_posts using gin(title extensions.gin_trgm_ops);
create table public.news_post_tags (
  post_id text not null references public.news_posts(id) on delete cascade,
  tag_id uuid not null references public.news_tags(id) on delete restrict,
  position integer not null check(position between 0 and 9),
  primary key(post_id,tag_id), unique(post_id,position)
);
create index news_post_tags_lookup_idx on public.news_post_tags(tag_id,post_id);
create table public.news_activity (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid not null,
  post_id text not null,
  action text not null check(action in ('created','updated','deleted')),
  version integer not null
);
create index news_activity_created_idx on public.news_activity(created_at desc,id desc);
create table public.news_imports (
  snapshot_hash text primary key,
  source_count integer not null,
  imported_at timestamptz not null default now()
);
alter table public.news_owner enable row level security;
alter table public.news_posts enable row level security;
alter table public.news_tags enable row level security;
alter table public.news_post_tags enable row level security;
alter table public.news_activity enable row level security;
alter table public.news_imports enable row level security;
revoke all on public.news_owner,public.news_posts,public.news_tags,public.news_post_tags,public.news_activity,public.news_imports from public,anon,authenticated,service_role;
grant select on public.news_owner,public.news_imports to service_role;
grant select,insert,update,delete on public.news_posts,public.news_tags,public.news_post_tags to service_role;
grant select,insert on public.news_activity to service_role;

create function public.news_post_json(p public.news_posts,p_private boolean default false)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare labels jsonb; category text;
begin
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'slug',t.slug,'legacy_category',t.legacy_category) order by pt.position),'[]'::jsonb)
 into labels from public.news_post_tags pt join public.news_tags t on t.id=pt.tag_id where pt.post_id=p.id;
 select t.legacy_category into category from public.news_post_tags pt join public.news_tags t on t.id=pt.tag_id
 where pt.post_id=p.id and t.legacy_category is not null order by pt.position limit 1;
 return jsonb_build_object('_id',p.id,'id',p.id,'slug',p.slug,'title',p.title,'article',p.article,
   'thumbnailImage',p.thumbnail_url,'authorname',p.author_name,'dateandtime',p.published_at,
   'tags',labels,'category',coalesce(category,'latest-news')) ||
   case when p_private then jsonb_build_object('status',p.status,'version',p.version,'updated_at',p.updated_at) else '{}'::jsonb end;
end;
$$;
create function public.get_news(p_limit integer default 10,p_skip integer default 0,p_tag text default null,p_query text default null,p_include_drafts boolean default false)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare rows jsonb; total bigint; pattern text;
begin
 if p_limit is null or p_limit not between 1 and 100 or p_skip is null or p_skip not between 0 and 1000000
   or length(p_tag)>100 or length(p_query)>100 then raise exception 'Invalid query' using errcode='22023'; end if;
 pattern := '%' || replace(replace(replace(p_query,chr(92),chr(92)||chr(92)),'%',chr(92)||'%'),'_',chr(92)||'_') || '%';
 with filtered as (
   select p.* from public.news_posts p where (p_include_drafts or p.status='published')
   and (p_query is null or p.title ilike pattern escape E'\\')
   and (p_tag is null or exists(select 1 from public.news_post_tags pt join public.news_tags t on t.id=pt.tag_id
     where pt.post_id=p.id and (t.slug=p_tag or t.legacy_category=p_tag)))
 ), page as (select * from filtered order by published_at desc,id desc limit p_limit offset p_skip)
 select (select count(*) from filtered),coalesce(jsonb_agg(public.news_post_json(page,p_include_drafts) order by page.published_at desc,page.id desc),'[]'::jsonb)
 into total,rows from page;
 return jsonb_build_object('posts',rows,'totalCount',total);
end;
$$;
create function public.get_news_post(p_reference text,p_include_drafts boolean default false)
returns jsonb language sql stable security invoker set search_path='' as $$
 select public.news_post_json(p,p_include_drafts) from public.news_posts p
 where (p.id=p_reference or p.slug=p_reference) and (p_include_drafts or p.status='published')
 order by (p.id=p_reference) desc limit 1;
$$;
create function public.get_news_tags(p_include_drafts boolean default false)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(t) order by t.post_count desc,t.name),'[]'::jsonb) from (
   select t.id,t.name,t.slug,t.legacy_category,count(p.id) as post_count from public.news_tags t
   left join public.news_post_tags pt on pt.tag_id=t.id
   left join public.news_posts p on p.id=pt.post_id and (p_include_drafts or p.status='published')
   group by t.id having p_include_drafts or t.legacy_category is not null or count(p.id)>0
 ) t;
$$;
create function public.mutate_news_post(p_action text,p_id text,p_actor_id uuid,p_input jsonb default '{}',p_expected_version integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous public.news_posts; result public.news_posts; label_ids uuid[]; label_count integer;
begin
 if not exists(select 1 from public.news_owner where user_id=p_actor_id) then raise exception 'Owner required' using errcode='42501'; end if;
 if p_action is null or p_action not in ('create','update','delete') then raise exception 'Invalid action' using errcode='22023'; end if;
 if p_action<>'create' then
   select * into previous from public.news_posts where id=p_id for update;
   if not found then return null; end if;
   if p_expected_version is null or previous.version<>p_expected_version then raise exception 'Stale post version' using errcode='40001'; end if;
 end if;
 if p_action='delete' then
   delete from public.news_posts where id=p_id returning * into result;
 else
   if jsonb_typeof(p_input->'tags') is distinct from 'array' or jsonb_array_length(p_input->'tags') not between 1 and 10 then
     raise exception 'One to ten labels required' using errcode='22023'; end if;
   select array_agg(value::uuid) into label_ids from jsonb_array_elements_text(p_input->'tags');
   select count(*) into label_count from public.news_tags where id=any(label_ids);
   if label_count<>cardinality(label_ids) then raise exception 'Unknown or duplicate labels' using errcode='22023'; end if;
   if p_action='create' then
     insert into public.news_posts(id,slug,title,article,thumbnail_url,author_name,status)
     values(p_id,p_input->>'slug',p_input->>'title',p_input->>'article',p_input->>'thumbnailImage',p_input->>'author_name',coalesce(p_input->>'status','draft')) returning * into result;
   else
     update public.news_posts set title=p_input->>'title',article=p_input->>'article',thumbnail_url=p_input->>'thumbnailImage',
       status=p_input->>'status',updated_at=now(),version=version+1,
       published_at=case when previous.status='draft' and p_input->>'status'='published' then now() else published_at end
       where id=p_id returning * into result;
     delete from public.news_post_tags where post_id=p_id;
   end if;
   insert into public.news_post_tags(post_id,tag_id,position)
     select p_id,value,(ordinality-1)::integer from unnest(label_ids) with ordinality as labels(value,ordinality);
 end if;
 insert into public.news_activity(actor_id,post_id,action,version)
 values(p_actor_id,p_id,case p_action when 'create' then 'created' when 'update' then 'updated' else 'deleted' end,result.version);
 return public.news_post_json(result,true);
end;
$$;
revoke all on function public.news_post_json(public.news_posts,boolean),public.get_news(integer,integer,text,text,boolean),public.get_news_post(text,boolean),public.get_news_tags(boolean),public.mutate_news_post(text,text,uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.news_post_json(public.news_posts,boolean),public.get_news(integer,integer,text,text,boolean),public.get_news_post(text,boolean),public.get_news_tags(boolean),public.mutate_news_post(text,text,uuid,jsonb,integer) to service_role;
