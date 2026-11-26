create or replace function public.mutate_news_post(p_action text,p_id text,p_actor_id uuid,p_input jsonb default '{}',p_expected_version integer default null)
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
     values(p_id,p_input->>'slug',p_input->>'title',p_input->>'article',p_input->>'thumbnailImage',coalesce(nullif(btrim(p_input->>'author_name'),''),'96 News Desk'),coalesce(p_input->>'status','draft')) returning * into result;
   else
     update public.news_posts set title=p_input->>'title',article=p_input->>'article',thumbnail_url=p_input->>'thumbnailImage',
       author_name=coalesce(nullif(btrim(p_input->>'author_name'),''),previous.author_name),
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
