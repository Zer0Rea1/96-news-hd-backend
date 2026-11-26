alter table public.membership_roles add column if not exists renewal_fee integer not null default 1000 check(renewal_fee between 1 and 1000000);

create or replace function public.save_membership_role(p_actor uuid,p_id uuid,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result public.membership_roles;
begin
 if not exists(select 1 from public.news_owner where user_id=p_actor) then raise exception 'Owner required' using errcode='42501'; end if;
 if p_id is null then
  insert into public.membership_roles(name,level,fixed_province,fee,renewal_fee,active)
  values(p_input->>'name',p_input->>'level',p_input->>'fixed_province',(p_input->>'fee')::integer,coalesce((p_input->>'renewal_fee')::integer,1000),(p_input->>'active')::boolean)
  returning * into result;
 else
  update public.membership_roles set
    name=p_input->>'name',
    level=p_input->>'level',
    fixed_province=p_input->>'fixed_province',
    fee=(p_input->>'fee')::integer,
    renewal_fee=coalesce((p_input->>'renewal_fee')::integer,renewal_fee,1000),
    active=(p_input->>'active')::boolean,
    version=version+1
   where id=p_id and version=(p_input->>'version')::integer returning * into result;
  if not found then raise exception 'Role changed' using errcode='40001'; end if;
 end if;
 return to_jsonb(result);
end $$;
revoke all on function public.save_membership_role(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_membership_role(uuid,uuid,jsonb) to service_role;

create or replace function public.review_membership_application(p_id uuid,p_actor uuid,p_actor_email text,p_input jsonb,p_photo_url text default '')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.membership_applications; profile public.reporters; original_details jsonb; today date=(now() at time zone 'UTC')::date; review_fee integer;
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
  review_fee := coalesce(
    (a.pending_designation->>'fee')::integer,
    case
      when a.reporter_id is not null and a.pending_designation is null then coalesce((select renewal_fee from public.membership_roles where id=a.role_id), 1000)
      else a.fee
    end
  );
  insert into public.membership_reviews(application_id,actor_id,decision,reason,proof_path,fee,request_snapshot) values(a.id,p_actor,p_input->>'decision',a.rejection_reason,a.proof_path,review_fee,coalesce(a.pending_designation,a.details) || jsonb_build_object('previous_details',original_details));
  if p_input->>'decision'='approve' then
    update public.membership_applications set pending_designation=null where id=a.id returning * into a;
  end if;
  return to_jsonb(a)-'proof_path'-'photo_path';
end $$;
