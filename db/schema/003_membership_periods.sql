-- Only application-linked credentials receive membership dates; legacy printed cards are untouched.
alter table public.reporters add column membership_started_at timestamptz, add column membership_expires_at timestamptz;
alter table public.reporters add constraint membership_period_valid check (
 (membership_started_at is null and membership_expires_at is null) or
 (membership_started_at is not null and membership_expires_at is not null and membership_expires_at > membership_started_at));
alter table public.membership_applications add column renewal_status text check (renewal_status in ('pending','rejected'));
update public.reporters r set membership_started_at=a.reviewed_at,
 membership_expires_at=a.reviewed_at+interval '30 days',
 expiry_date=case when r.expiry_date=r.issue_date+30 then (r.issue_date+interval '1 year')::date else r.expiry_date end
from public.membership_applications a where a.reporter_id=r.id and a.status='approved';

create function public.complete_application_father(p_user_id uuid,p_version integer,p_father text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.membership_applications;
begin
 if length(trim(p_father)) not between 1 and 100 then raise exception 'Father name required' using errcode='22023'; end if;
 update public.membership_applications set details=jsonb_set(details,'{father_name}',to_jsonb(trim(p_father))),version=version+1
 where user_id=p_user_id and status<>'approved' and coalesce(trim(details->>'father_name'),'')='' and version=p_version returning * into a;
 if not found then raise exception 'Application changed' using errcode='40001'; end if;
 return to_jsonb(a)-'proof_path'-'photo_path';
end $$;
revoke all on function public.complete_application_father(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.complete_application_father(uuid,integer,text) to service_role;

create or replace function public.submit_membership_payment(p_user_id uuid,p_version integer,p_path text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result public.membership_applications;
begin
  select * into result from public.membership_applications where user_id=p_user_id for update;
  if not found or (result.status not in ('awaiting_payment','rejected','approved') or coalesce(result.renewal_status,'')='pending') or result.version<>p_version then
    raise exception 'Application changed' using errcode='40001';
  end if;
  if p_path is null or p_path not like result.id::text || '/%' then
    raise exception 'Invalid receipt' using errcode='22023';
  end if;
  update public.membership_applications set proof_path=p_path,status=case when status='approved' then 'approved' else 'pending' end,renewal_status=case when status='approved' then 'pending' end,rejection_reason='',version=version+1
    where id=result.id returning * into result;
  return to_jsonb(result);
end $$;


create or replace function public.review_membership_application(p_id uuid,p_actor uuid,p_actor_email text,p_input jsonb,p_photo_url text default '')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.membership_applications; profile public.reporters; today date=(now() at time zone 'UTC')::date;
begin
  if not exists(select 1 from public.news_owner where user_id=p_actor) then
    raise exception 'Owner access required' using errcode='42501';
  end if;
  select * into a from public.membership_applications where id=p_id for update;
  if not found or (a.status<>'pending' and not (a.status='approved' and coalesce(a.renewal_status,'')='pending')) or a.proof_path is null or a.version<>(p_input->>'version')::integer then
    raise exception 'Application changed' using errcode='40001';
  end if;
  if p_input->>'decision'='approve' then
    if a.status<>'approved' and coalesce(trim(a.details->>'father_name'),'')='' then raise exception 'Father name required' using errcode='22023'; end if;
    if a.status='approved' then
      update public.reporters set membership_started_at=now(), membership_expires_at=greatest(now(),membership_expires_at)+interval '30 days'
       where id=a.reporter_id returning * into profile;
      if not found then raise exception 'Profile unavailable' using errcode='22023'; end if;
    else
    -- A CNIC collision aborts approval; never attach an applicant to an existing printed credential.
    insert into public.reporters(name,father_name,designation,city,cnic,contact,whatsapp,address,issue_date,expiry_date,status,show_sensitive,photo_url,membership_started_at,membership_expires_at)
    values(a.details->>'name',a.details->>'father_name',a.details->>'role',a.details->>'designation_area',a.details->>'cnic',a.details->>'phone',a.details->>'phone',a.details->>'address',today,(today+interval '1 year')::date,'active',false,p_photo_url,now(),now()+interval '30 days')
    returning * into profile;
    end if;
    insert into public.activity_log(actor_id,actor_email,reporter_id,reporter_name,serial_number,action,changed_fields)
    values(p_actor,p_actor_email,profile.id,profile.name,profile.serial_number,case when a.status='approved' then 'renewed' else 'created' end,array['membership']);
    update public.membership_applications set status='approved',renewal_status=null,rejection_reason='',reporter_id=profile.id,reviewed_at=now(),version=version+1 where id=a.id returning * into a;
  elsif p_input->>'decision'='reject' and length(trim(p_input->>'reason')) between 1 and 1000 then
    update public.membership_applications set status=case when status='approved' then 'approved' else 'rejected' end,renewal_status=case when status='approved' then 'rejected' end,rejection_reason=p_input->>'reason',reviewed_at=now(),version=version+1 where id=a.id returning * into a;
  else raise exception 'Invalid decision' using errcode='22023';
  end if;
  insert into public.membership_reviews(application_id,actor_id,decision,reason,proof_path,fee) values(a.id,p_actor,p_input->>'decision',a.rejection_reason,a.proof_path,a.fee);
  return to_jsonb(a)-'proof_path'-'photo_path';
end $$;

-- Deleting a login preserves submitted applications, payment reviews and printed credentials.
alter table public.membership_applications alter column user_id drop not null;
alter table public.membership_applications drop constraint membership_applications_user_id_fkey;
alter table public.membership_applications add constraint membership_applications_user_id_fkey foreign key(user_id) references auth.users(id) on delete set null;
create index membership_applications_role_idx on public.membership_applications(role_id);
create index membership_reviews_application_idx on public.membership_reviews(application_id);

-- Validate new JSON identity snapshots without rewriting historical applications.
alter table public.membership_applications add constraint application_cnic_valid check (details->>'cnic' is not null and details->>'cnic' ~ '^\d{5}-\d{7}-\d$') not valid;
alter table public.membership_reviews add column proof_path text, add column fee integer;
