-- Additive: existing reporters, public UUIDs and credentials are never rewritten.
create table public.membership_roles (
  id uuid primary key default gen_random_uuid(), name text not null unique check(length(trim(name)) between 1 and 100),
  level text not null check(level in ('province','district','tehsil','city')),
  fixed_province text check(fixed_province in ('Punjab','Sindh','Khyber Pakhtunkhwa','Balochistan','Azad Kashmir','Gilgit Baltistan','Islamabad')),
  fee integer not null check(fee between 1 and 1000000), active boolean not null default true,
  version integer not null default 1 check(version>0)
);
alter table public.membership_roles enable row level security;
revoke all on public.membership_roles from public,anon,authenticated;
grant select,insert,update on public.membership_roles to service_role;
insert into public.membership_roles(name,level,fee,fixed_province) values
 ('رپورٹر','city',4000,null),('سٹی رپورٹر','city',4500,null),('کرائم رپورٹر','city',4500,null),
 ('تحصیل رپورٹر','tehsil',5000,null),('ڈپٹی بیورو چیف','city',6000,null),('بیورو چیف','city',6500,null),
 ('ڈسٹرکٹ چیف رپورٹر','district',7000,null),('چیف رپورٹر پنجاب','province',10000,'Punjab'),('انچارج نمائندگان پنجاب','province',20000,'Punjab');
create function public.save_membership_role(p_actor uuid,p_id uuid,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result public.membership_roles;
begin
 if not exists(select 1 from public.news_owner where user_id=p_actor) then raise exception 'Owner required' using errcode='42501'; end if;
 if p_id is null then
  insert into public.membership_roles(name,level,fixed_province,fee,active) values(p_input->>'name',p_input->>'level',p_input->>'fixed_province',(p_input->>'fee')::integer,(p_input->>'active')::boolean) returning * into result;
 else
  update public.membership_roles set name=p_input->>'name',level=p_input->>'level',fixed_province=p_input->>'fixed_province',fee=(p_input->>'fee')::integer,active=(p_input->>'active')::boolean,version=version+1
   where id=p_id and version=(p_input->>'version')::integer returning * into result;
  if not found then raise exception 'Role changed' using errcode='40001'; end if;
 end if;
 return to_jsonb(result);
end $$;
revoke all on function public.save_membership_role(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_membership_role(uuid,uuid,jsonb) to service_role;

create table public.membership_payment_settings (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 accounts jsonb not null default '[]' check(jsonb_typeof(accounts)='array'), instructions text not null default '' check(length(instructions)<=2000),
 version integer not null default 1 check(version>0), check(not enabled or jsonb_array_length(accounts)>0)
);
alter table public.membership_payment_settings enable row level security;
revoke all on public.membership_payment_settings from public,anon,authenticated;
grant select,update on public.membership_payment_settings to service_role;
insert into public.membership_payment_settings(accounts,instructions) values
 ('[{"name":"Bank of Punjab","number":"6020266587200018","title":"96 News HD Pakistan LIMITED"},{"name":"JazzCash","number":"0300-8687435","title":"96 News HD Pakistan LIMITED"}]', 'ادائیگی کے بعد رسید اپ لوڈ کریں۔ منظوری انتظامیہ کی تصدیق کے بعد ہو گی۔');
create function public.save_membership_payment_settings(p_actor uuid,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result public.membership_payment_settings;
begin
 if not exists(select 1 from public.news_owner where user_id=p_actor) then raise exception 'Owner required' using errcode='42501'; end if;
 update public.membership_payment_settings set enabled=(p_input->>'enabled')::boolean,accounts=p_input->'accounts',instructions=p_input->>'instructions',version=version+1
 where singleton and version=(p_input->>'version')::integer returning * into result;
 if not found then raise exception 'Payment settings changed' using errcode='40001'; end if;
 return to_jsonb(result)-'singleton';
end $$;
revoke all on function public.save_membership_payment_settings(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_membership_payment_settings(uuid,jsonb) to service_role;

create table public.membership_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete restrict,
  email text not null,
  role_id uuid not null references public.membership_roles(id),
  details jsonb not null check (jsonb_typeof(details) = 'object'),
  fee integer not null check (fee > 0),
  status text not null default 'awaiting_payment' check (status in ('awaiting_payment','pending','approved','rejected')),
  proof_path text,
  photo_path text,
  rejection_reason text not null default '',
  reporter_id uuid unique references public.reporters(id) on delete set null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  check (status = 'awaiting_payment' or proof_path is not null)
);
create index membership_applications_created_idx on public.membership_applications(created_at desc,id);
alter table public.membership_applications enable row level security;
revoke all on public.membership_applications from public,anon,authenticated;
grant select,insert,update on public.membership_applications to service_role;

create table public.membership_reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.membership_applications(id),
  actor_id uuid not null,
  decision text not null check (decision in ('approve','reject')),
  reason text not null default '',
  created_at timestamptz not null default now()
);
alter table public.membership_reviews enable row level security;
revoke all on public.membership_reviews from public,anon,authenticated;
grant select,insert on public.membership_reviews to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('membership-private','membership-private',false,4194304,array['image/webp'])
on conflict(id) do nothing;
do $$ begin
  if exists(select 1 from storage.buckets where id='membership-private' and public) then
    raise exception 'Membership storage must be private';
  end if;
end $$;
-- Restrictive policy also blocks broad permissive policies from an older app.
create policy membership_private_api_only on storage.objects as restrictive for all to anon,authenticated
using (bucket_id <> 'membership-private') with check (bucket_id <> 'membership-private');

create function public.create_membership_application(p_user_id uuid,p_email text,p_details jsonb,p_role_id uuid,p_role_version integer,p_photo_path text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result public.membership_applications; role public.membership_roles;
begin
  select * into role from public.membership_roles where id=p_role_id for share;
  if not found or not role.active or role.version<>p_role_version then raise exception 'Role changed' using errcode='40001'; end if;
  if exists(select 1 from public.news_owner where user_id=p_user_id) then
    raise exception 'Owner cannot apply' using errcode='42501';
  end if;
  -- Email identity is verified with Supabase Auth getUser before this service-only call.
  insert into public.membership_applications(user_id,email,role_id,details,fee,photo_path)
    values(p_user_id,p_email,role.id,p_details || jsonb_build_object('role',role.name,'level',role.level),role.fee,p_photo_path) on conflict(user_id) do nothing;
  select * into result from public.membership_applications where user_id=p_user_id;
  return to_jsonb(result);
end $$;

create function public.submit_membership_payment(p_user_id uuid,p_version integer,p_path text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result public.membership_applications;
begin
  select * into result from public.membership_applications where user_id=p_user_id for update;
  if not found or result.status not in ('awaiting_payment','rejected') or result.version<>p_version then
    raise exception 'Application changed' using errcode='40001';
  end if;
  if p_path is null or p_path not like result.id::text || '/%' then
    raise exception 'Invalid receipt' using errcode='22023';
  end if;
  update public.membership_applications set proof_path=p_path,status='pending',rejection_reason='',version=version+1
    where id=result.id returning * into result;
  return to_jsonb(result);
end $$;

create function public.review_membership_application(p_id uuid,p_actor uuid,p_actor_email text,p_input jsonb,p_photo_url text default '')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.membership_applications; profile public.reporters; today date=(now() at time zone 'UTC')::date;
begin
  if not exists(select 1 from public.news_owner where user_id=p_actor) then
    raise exception 'Owner access required' using errcode='42501';
  end if;
  select * into a from public.membership_applications where id=p_id for update;
  if not found or a.status<>'pending' or a.proof_path is null or a.version<>(p_input->>'version')::integer then
    raise exception 'Application changed' using errcode='40001';
  end if;
  if p_input->>'decision'='approve' then
    if coalesce(trim(p_input->>'father_name'),'')='' then raise exception 'Father name required' using errcode='22023'; end if;
    -- A CNIC collision aborts approval; never attach an applicant to an existing printed credential.
    insert into public.reporters(name,father_name,designation,city,cnic,contact,whatsapp,address,issue_date,expiry_date,status,show_sensitive,photo_url)
    values(a.details->>'name',p_input->>'father_name',a.details->>'role',a.details->>'designation_area',a.details->>'cnic',a.details->>'phone',a.details->>'phone',a.details->>'address',today,today+30,'active',false,p_photo_url)
    returning * into profile;
    insert into public.activity_log(actor_id,actor_email,reporter_id,reporter_name,serial_number,action,changed_fields)
    values(p_actor,p_actor_email,profile.id,profile.name,profile.serial_number,'created',array['membership']);
    update public.membership_applications set status='approved',reporter_id=profile.id,reviewed_at=now(),version=version+1 where id=a.id returning * into a;
  elsif p_input->>'decision'='reject' and length(trim(p_input->>'reason')) between 1 and 1000 then
    update public.membership_applications set status='rejected',rejection_reason=p_input->>'reason',reviewed_at=now(),version=version+1 where id=a.id returning * into a;
  else raise exception 'Invalid decision' using errcode='22023';
  end if;
  insert into public.membership_reviews(application_id,actor_id,decision,reason) values(a.id,p_actor,p_input->>'decision',a.rejection_reason);
  return to_jsonb(a)-'proof_path'-'photo_path';
end $$;
revoke all on function public.create_membership_application(uuid,text,jsonb,uuid,integer,text),public.submit_membership_payment(uuid,integer,text),public.review_membership_application(uuid,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.create_membership_application(uuid,text,jsonb,uuid,integer,text),public.submit_membership_payment(uuid,integer,text),public.review_membership_application(uuid,uuid,text,jsonb,text) to service_role;
