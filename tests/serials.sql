begin;
set local role service_role;
do $$
declare a jsonb; b jsonb; original text; actor uuid='11111111-1111-4111-8111-111111111111';
begin
 a=public.mutate_reporter('create',actor,'owner@example.test',null,'{"name":"Auto serial","father_name":"Father","designation":"Reporter","city":"Lahore","cnic":"35202-4444444-4","contact":"03001234567","whatsapp":"03001234567","address":"Private","issue_date":"2026-01-01","expiry_date":"2027-01-01","status":"active"}');
 original=a->'reporter'->>'serial_number';
 assert original ~ '^96N/[0-9]+/2027$';
 b=public.mutate_reporter('create',actor,'owner@example.test',null,'{"name":"Second member","father_name":"Father","designation":"Reporter","city":"Lahore","cnic":"35202-4444444-5","contact":"03001234567","whatsapp":"03001234567","address":"Private","issue_date":"2026-01-01","expiry_date":"2027-01-01","status":"active","serial_number":" 00042 "}');
 assert b->'reporter'->>'serial_number'='00042';
 a=public.mutate_reporter('update',actor,'owner@example.test',(a->'reporter'->>'id')::uuid,'{"serial_number":"","city":"Karachi"}');
 assert a->'reporter'->>'serial_number'=original;
 a=public.mutate_reporter('update',actor,'owner@example.test',(a->'reporter'->>'id')::uuid,'{"serial_number":"00043"}');
 assert a->'reporter'->>'serial_number'='00043';
 a=public.mutate_reporter('renew',actor,'owner@example.test',(a->'reporter'->>'id')::uuid,'{"issue_date":"2027-01-01","expiry_date":"2028-01-01"}');
 assert a->'reporter'->>'serial_number'='00043', 'Renewals must preserve printed serials';
 assert exists(select 1 from public.activity_log where reporter_id=(a->'reporter'->>'id')::uuid and action='created' and serial_number=original);
 assert exists(select 1 from public.activity_log where reporter_id=(a->'reporter'->>'id')::uuid and action='updated' and serial_number='00043');
 assert not has_sequence_privilege('authenticated','public.reporter_serial_seq','USAGE');
end $$;
rollback;
