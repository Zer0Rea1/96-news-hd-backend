-- Paid designation changes reuse private receipt review; no public profile changes before approval.
alter table public.membership_applications add column pending_designation jsonb check(pending_designation is null or jsonb_typeof(pending_designation)='object');
alter table public.membership_reviews add column source text not null default 'payment' check(source in ('payment','waiver')),
 add column request_snapshot jsonb;

create function public.request_member_designation(p_user_id uuid,p_version integer,p_role_id uuid,p_role_version integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.membership_applications; r public.membership_roles; profile public.reporters;
begin
 select * into a from public.membership_applications where user_id=p_user_id for update;
 if not found or a.status<>'approved' or a.version<>p_version or coalesce(a.renewal_status,'')='pending' then raise exception 'Application changed' using errcode='40001'; end if;
 select * into r from public.membership_roles where id=p_role_id for share;
 if not found or not r.active or r.version<>p_role_version then raise exception 'Role changed' using errcode='40001'; end if;
 select * into profile from public.reporters where id=a.reporter_id for update;
 if not found or profile.status<>'active' then raise exception 'Profile unavailable' using errcode='40001'; end if;
 if profile.designation=r.name then raise exception 'Choose a different designation' using errcode='22023'; end if;
 update public.membership_applications set pending_designation=jsonb_build_object('role_id',r.id,'role',r.name,'fee',r.fee,'role_version',r.version),renewal_status=null,rejection_reason='',version=version+1 where id=a.id returning * into a;
 return to_jsonb(a)-'proof_path'-'photo_path';
end $$;

create function public.cancel_member_designation(p_user_id uuid,p_version integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.membership_applications;
begin
 update public.membership_applications set pending_designation=null,renewal_status=null,rejection_reason='',version=version+1
 where user_id=p_user_id and status='approved' and version=p_version and coalesce(renewal_status,'')<>'pending' and pending_designation is not null returning * into a;
 if not found then raise exception 'Application changed' using errcode='40001'; end if;
 return to_jsonb(a)-'proof_path'-'photo_path';
end $$;

create function public.renew_membership_without_payment(p_id uuid,p_actor uuid,p_actor_email text,p_version integer,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.membership_applications; profile public.reporters;
begin
 if not exists(select 1 from public.news_owner where user_id=p_actor) then raise exception 'Owner required' using errcode='42501'; end if;
 if coalesce(length(trim(p_reason)),0) not between 1 and 1000 then raise exception 'Reason required' using errcode='22023'; end if;
 select * into a from public.membership_applications where id=p_id for update;
 if not found or a.status<>'approved' or a.version<>p_version or coalesce(a.renewal_status,'')='pending' or a.pending_designation is not null then raise exception 'Resolve the pending request first' using errcode='40001'; end if;
 update public.reporters set membership_started_at=now(),membership_expires_at=greatest(now(),membership_expires_at)+interval '30 days'
 where id=a.reporter_id and status='active' returning * into profile;
 if not found then raise exception 'Profile unavailable' using errcode='40001'; end if;
 update public.membership_applications set renewal_status=null,rejection_reason='',reviewed_at=now(),version=version+1 where id=a.id returning * into a;
 insert into public.membership_reviews(application_id,actor_id,decision,reason,fee,source) values(a.id,p_actor,'approve',trim(p_reason),0,'waiver');
 insert into public.activity_log(actor_id,actor_email,reporter_id,reporter_name,serial_number,action,changed_fields)
 values(p_actor,p_actor_email,profile.id,profile.name,profile.serial_number,'renewed',array['membership','payment_waiver']);
 return to_jsonb(a)-'proof_path'-'photo_path';
end $$;
revoke all on function public.request_member_designation(uuid,integer,uuid,integer),public.cancel_member_designation(uuid,integer),public.renew_membership_without_payment(uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.request_member_designation(uuid,integer,uuid,integer),public.cancel_member_designation(uuid,integer),public.renew_membership_without_payment(uuid,uuid,text,integer,text) to service_role;

create or replace function public.review_membership_application(p_id uuid,p_actor uuid,p_actor_email text,p_input jsonb,p_photo_url text default '')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.membership_applications; profile public.reporters; original_details jsonb; today date=(now() at time zone 'UTC')::date;
begin
  if not exists(select 1 from public.news_owner where user_id=p_actor) then
    raise exception 'Owner access required' using errcode='42501';
  end if;
  select * into a from public.membership_applications where id=p_id for update;
  if not found or (a.status<>'pending' and not (a.status='approved' and coalesce(a.renewal_status,'')='pending')) or a.proof_path is null or a.version<>(p_input->>'version')::integer then
    raise exception 'Application changed' using errcode='40001';
  end if;
  original_details=a.details;
  if p_input->>'decision'='approve' then
    if a.status<>'approved' and coalesce(trim(a.details->>'father_name'),'')='' then raise exception 'Father name required' using errcode='22023'; end if;
    if a.status='approved' then
      update public.reporters set membership_started_at=now(), membership_expires_at=greatest(now(),membership_expires_at)+interval '30 days',
       designation=coalesce(a.pending_designation->>'role',designation)
       where id=a.reporter_id returning * into profile;
      if not found then raise exception 'Profile unavailable' using errcode='22023'; end if;
    else
    -- A CNIC collision aborts approval; never attach an applicant to an existing printed credential.
    insert into public.reporters(name,father_name,designation,city,cnic,contact,whatsapp,address,issue_date,expiry_date,status,show_sensitive,photo_url,membership_started_at,membership_expires_at)
    values(a.details->>'name',a.details->>'father_name',a.details->>'role',a.details->>'designation_area',a.details->>'cnic',a.details->>'phone',a.details->>'phone',a.details->>'address',today,(today+interval '1 year')::date,'active',false,p_photo_url,now(),now()+interval '30 days')
    returning * into profile;
    end if;
    insert into public.activity_log(actor_id,actor_email,reporter_id,reporter_name,serial_number,action,changed_fields)
    values(p_actor,p_actor_email,profile.id,profile.name,profile.serial_number,case when a.status='approved' then 'renewed' else 'created' end,case when a.pending_designation is null then array['membership'] else array['membership','designation'] end);
    update public.membership_applications set role_id=coalesce((pending_designation->>'role_id')::uuid,role_id),
     fee=coalesce((pending_designation->>'fee')::integer,fee),
     details=details || coalesce(pending_designation-'fee'-'role_id'-'role_version','{}'::jsonb),
     status='approved',renewal_status=null,rejection_reason='',reporter_id=profile.id,reviewed_at=now(),version=version+1 where id=a.id returning * into a;
  elsif p_input->>'decision'='reject' and length(trim(p_input->>'reason')) between 1 and 1000 then
    update public.membership_applications set status=case when status='approved' then 'approved' else 'rejected' end,renewal_status=case when status='approved' then 'rejected' end,rejection_reason=p_input->>'reason',reviewed_at=now(),version=version+1 where id=a.id returning * into a;
  else raise exception 'Invalid decision' using errcode='22023';
  end if;
  insert into public.membership_reviews(application_id,actor_id,decision,reason,proof_path,fee,request_snapshot) values(a.id,p_actor,p_input->>'decision',a.rejection_reason,a.proof_path,coalesce((a.pending_designation->>'fee')::integer,a.fee),coalesce(a.pending_designation,a.details) || jsonb_build_object('previous_details',original_details));
  if p_input->>'decision'='approve' then
    update public.membership_applications set pending_designation=null where id=a.id returning * into a;
  end if;
  return to_jsonb(a)-'proof_path'-'photo_path';
end $$;
