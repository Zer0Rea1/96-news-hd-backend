alter table public.membership_payment_settings add column if not exists card_renewal_fee integer not null default 400 check(card_renewal_fee between 1 and 1000000);
alter table public.membership_applications add column if not exists card_renewal_status text check(card_renewal_status in ('pending','rejected'));
alter table public.membership_applications add column if not exists card_proof_path text;
alter table public.membership_applications add column if not exists card_rejection_reason text not null default '';

create or replace function public.save_membership_payment_settings(p_actor uuid,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result public.membership_payment_settings;
begin
 if not exists(select 1 from public.news_owner where user_id=p_actor) then raise exception 'Owner required' using errcode='42501'; end if;
 update public.membership_payment_settings set
   enabled=(p_input->>'enabled')::boolean,
   accounts=p_input->'accounts',
   instructions=p_input->>'instructions',
   card_renewal_fee=coalesce((p_input->>'card_renewal_fee')::integer, card_renewal_fee, 400),
   version=version+1
 where singleton and version=(p_input->>'version')::integer returning * into result;
 if not found then raise exception 'Payment settings changed' using errcode='40001'; end if;
 return to_jsonb(result)-'singleton';
end $$;
revoke all on function public.save_membership_payment_settings(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_membership_payment_settings(uuid,jsonb) to service_role;

create or replace function public.submit_card_renewal_payment(p_user_id uuid, p_version integer, p_path text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result public.membership_applications; profile public.reporters; today date=(now() at time zone 'UTC')::date;
begin
  select * into result from public.membership_applications where user_id=p_user_id for update;
  if not found or result.status<>'approved' or result.reporter_id is null or result.version<>p_version or coalesce(result.card_renewal_status,'')='pending' then
    raise exception 'Application changed' using errcode='40001';
  end if;
  select * into profile from public.reporters where id=result.reporter_id;
  if not found or (profile.expiry_date - today) > 30 then
    raise exception 'Card is not eligible for renewal yet' using errcode='40001';
  end if;
  if p_path is null or p_path not like result.id::text || '/%' then
    raise exception 'Invalid receipt' using errcode='22023';
  end if;
  update public.membership_applications set card_proof_path=p_path, card_renewal_status='pending', card_rejection_reason='', version=version+1
    where id=result.id returning * into result;
  return to_jsonb(result);
end $$;
revoke all on function public.submit_card_renewal_payment(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.submit_card_renewal_payment(uuid,integer,text) to service_role;

create or replace function public.review_card_renewal(p_id uuid, p_actor uuid, p_actor_email text, p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.membership_applications; profile public.reporters; today date=(now() at time zone 'UTC')::date; card_fee integer;
begin
  if not exists(select 1 from public.news_owner where user_id=p_actor) then
    raise exception 'Owner access required' using errcode='42501';
  end if;
  select * into a from public.membership_applications where id=p_id for update;
  if not found or a.status<>'approved' or a.reporter_id is null or a.card_renewal_status<>'pending' or a.card_proof_path is null or a.version<>(p_input->>'version')::integer then
    raise exception 'Application changed' using errcode='40001';
  end if;
  select card_renewal_fee into card_fee from public.membership_payment_settings where singleton;
  card_fee := coalesce(card_fee, 400);
  if p_input->>'decision'='approve' then
    update public.reporters set expiry_date=(greatest(today, expiry_date)+interval '1 year')::date
      where id=a.reporter_id returning * into profile;
    if not found then raise exception 'Profile unavailable' using errcode='22023'; end if;
    insert into public.activity_log(actor_id,actor_email,reporter_id,reporter_name,serial_number,action,changed_fields)
      values(p_actor,p_actor_email,profile.id,profile.name,profile.serial_number,'renewed',array['card_expiry']);
    update public.membership_applications set card_renewal_status=null, card_rejection_reason='', reviewed_at=now(), version=version+1
      where id=a.id returning * into a;
    insert into public.membership_reviews(application_id,actor_id,decision,reason,proof_path,fee,source)
      values(a.id,p_actor,'approve','Card renewal approved',a.card_proof_path,card_fee,'payment');
  elsif p_input->>'decision'='reject' and length(trim(p_input->>'reason')) between 1 and 1000 then
    update public.membership_applications set card_renewal_status='rejected', card_rejection_reason=p_input->>'reason', reviewed_at=now(), version=version+1
      where id=a.id returning * into a;
    insert into public.membership_reviews(application_id,actor_id,decision,reason,proof_path,fee,source)
      values(a.id,p_actor,'reject',p_input->>'reason',a.card_proof_path,card_fee,'payment');
  else
    raise exception 'Invalid decision' using errcode='22023';
  end if;
  return to_jsonb(a)-'proof_path'-'photo_path'-'card_proof_path';
end $$;
revoke all on function public.review_card_renewal(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.review_card_renewal(uuid,uuid,text,jsonb) to service_role;
