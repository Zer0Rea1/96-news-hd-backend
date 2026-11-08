-- Persist validated forms before Auth; activate strict enforcement after the new client is live.
create table public.membership_signup_guard(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into public.membership_signup_guard default values;
alter table public.membership_signup_guard enable row level security;
revoke all on public.membership_signup_guard from public,anon,authenticated;
grant select,update on public.membership_signup_guard to service_role;
grant select on public.membership_signup_guard to supabase_auth_admin;
create policy signup_guard_auth_read on public.membership_signup_guard for select to supabase_auth_admin using(true);

create table public.membership_signup_forms(
 id uuid primary key,email text not null check(length(email) between 3 and 254),
 role_id uuid not null references public.membership_roles(id),details jsonb not null check(jsonb_typeof(details)='object'),
 fee integer not null check(fee>0),photo_path text,
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '1 hour',claimed_at timestamptz
);
create index signup_forms_expiry_idx on public.membership_signup_forms(expires_at);
alter table public.membership_signup_forms enable row level security;
revoke all on public.membership_signup_forms from public,anon,authenticated;
grant select,insert,update,delete on public.membership_signup_forms to service_role;
grant select,delete on public.membership_signup_forms to supabase_auth_admin;
create policy signup_forms_auth_consume on public.membership_signup_forms for all to supabase_auth_admin using(true) with check(true);
grant usage on schema public to supabase_auth_admin;
grant insert on public.membership_applications to supabase_auth_admin;
create policy signup_application_auth_insert on public.membership_applications for insert to supabase_auth_admin with check(true);

create function public.save_membership_signup_form(p_id uuid,p_email text,p_details jsonb,p_role_id uuid,p_role_version integer,p_photo_path text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.membership_roles; f public.membership_signup_forms;
begin
 select * into r from public.membership_roles where id=p_role_id for share;
 if not found or not r.active or r.version<>p_role_version then raise exception 'Role changed' using errcode='40001'; end if;
 if p_photo_path is not null and p_photo_path not like 'signup/'||p_id::text||'/%' then raise exception 'Invalid portrait path' using errcode='22023'; end if;
 insert into public.membership_signup_forms(id,email,role_id,details,fee,photo_path)
 values(p_id,lower(trim(p_email)),r.id,p_details||jsonb_build_object('role',r.name,'level',r.level),r.fee,p_photo_path) returning * into f;
 return jsonb_build_object('token',f.id,'expires_at',f.expires_at);
end $$;
revoke all on function public.save_membership_signup_form(uuid,text,jsonb,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.save_membership_signup_form(uuid,text,jsonb,uuid,integer,text) to service_role;

-- Metadata is untrusted: only an unused, email-bound private form token is accepted.
create function public.attach_signup_application() returns trigger
language plpgsql security invoker set search_path='' as $$
declare token text=new.raw_user_meta_data->>'application_token'; f public.membership_signup_forms; required boolean;
begin
 select enabled into required from public.membership_signup_guard where singleton;
 if token is null and not coalesce(required,false) then return new; end if;
 if token is null or token !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Complete the application form before signup' using errcode='23514'; end if;
 delete from public.membership_signup_forms where id=token::uuid and email=lower(new.email) and expires_at>now() and claimed_at is null returning * into f;
 if not found then raise exception 'Application token expired or does not match this email' using errcode='23514'; end if;
 insert into public.membership_applications(user_id,email,role_id,details,fee,photo_path) values(new.id,lower(new.email),f.role_id,f.details,f.fee,f.photo_path);
 return new;
end $$;
revoke all on function public.attach_signup_application() from public,anon,authenticated;
grant execute on function public.attach_signup_application() to supabase_auth_admin;
create trigger membership_form_on_signup after insert on auth.users for each row execute function public.attach_signup_application();

create function public.claim_signup_form_cleanup() returns table(id uuid,photo_path text)
language plpgsql security invoker set search_path='' as $$
begin
 return query with expired as (
 select f.id from public.membership_signup_forms f where f.expires_at<now() and (f.claimed_at is null or f.claimed_at<now()-interval '15 minutes') order by f.expires_at for update skip locked limit 25
 ) update public.membership_signup_forms f set claimed_at=now() from expired e where f.id=e.id returning f.id,f.photo_path;
end $$;
revoke all on function public.claim_signup_form_cleanup() from public,anon,authenticated;
grant execute on function public.claim_signup_form_cleanup() to service_role;
