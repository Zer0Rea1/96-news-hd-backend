begin;
set local role service_role;
update public.membership_signup_guard set enabled=true;
select public.save_membership_signup_form('66666666-6666-4666-8666-666666666666','new@example.test','{"name":"Saved before signup","father_name":"Father","cnic":"35202-6666666-6","phone":"03001234567","address":"Private address","role":"fake","designation_area":"Lahore"}',(select id from public.membership_roles where name='رپورٹر'),1,'signup/66666666-6666-4666-8666-666666666666/portrait.webp');
set local role supabase_auth_admin;
do $$ begin
 begin insert into auth.users(id,email) values('77777777-7777-4777-8777-777777777770','direct@example.test'); raise exception 'Direct signup accepted'; exception when check_violation then null; end;
 begin insert into auth.users(id,email,raw_user_meta_data) values('77777777-7777-4777-8777-777777777771','wrong@example.test','{"application_token":"66666666-6666-4666-8666-666666666666"}'); raise exception 'Token accepted for wrong email'; exception when check_violation then null; end;
 insert into auth.users(id,email,raw_user_meta_data) values('77777777-7777-4777-8777-777777777772','new@example.test','{"application_token":"66666666-6666-4666-8666-666666666666"}');
 begin insert into auth.users(id,email,raw_user_meta_data) values('77777777-7777-4777-8777-777777777773','new@example.test','{"application_token":"66666666-6666-4666-8666-666666666666"}'); raise exception 'Token replay accepted'; exception when check_violation then null; end;
end $$;
reset role;
do $$ begin
 assert not exists(select 1 from auth.users where email='direct@example.test');
 assert exists(select 1 from public.membership_applications where user_id='77777777-7777-4777-8777-777777777772' and details->>'phone'='03001234567' and details->>'name'='Saved before signup' and details->>'role'='رپورٹر' and fee=4000 and status='awaiting_payment' and proof_path is null);
 assert (select email_confirmed_at is null from auth.users where id='77777777-7777-4777-8777-777777777772'), 'Form must exist before email confirmation';
 assert not exists(select 1 from public.membership_signup_forms where id='66666666-6666-4666-8666-666666666666');
 assert not has_table_privilege('authenticated','public.membership_signup_forms','SELECT');
 assert not has_table_privilege('anon','public.membership_signup_forms','INSERT');
 assert not has_function_privilege('authenticated','public.save_membership_signup_form(uuid,text,jsonb,uuid,integer,text)','EXECUTE');
end $$;
set local role service_role;
select public.save_membership_signup_form('66666666-6666-4666-8666-666666666667','expired@example.test','{"name":"Expired","father_name":"Father","cnic":"35202-6666666-7","phone":"03001234567","address":"Private","role":"رپورٹر","designation_area":"Lahore"}',(select id from public.membership_roles where name='رپورٹر'),1);
update public.membership_signup_forms set expires_at=now()-interval '1 minute' where id='66666666-6666-4666-8666-666666666667';
set local role supabase_auth_admin;
do $$ begin
 begin insert into auth.users(id,email,raw_user_meta_data) values('77777777-7777-4777-8777-777777777774','expired@example.test','{"application_token":"66666666-6666-4666-8666-666666666667"}'); raise exception 'Expired form accepted'; exception when check_violation then null; end;
end $$;
set local role service_role;
do $$ begin assert exists(select 1 from public.claim_signup_form_cleanup() where id='66666666-6666-4666-8666-666666666667'); end $$;
rollback;
