-- 2026-11-02 (bunk bed, Våningssäng2): a reviewed drawing of a 70-part
-- construction could not be stored. The request keeps the construction pin,
-- its parameters and the reviewed candidate, which together passed the
-- 300 kB check from 2026-09-29; every save was refused and reported as a
-- generic outage, so the drawer tried again. The limit rises to 4 MB, and a
-- request above it is refused with its own code so it is not retried blindly.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create function bob_private.drawing_request_size() returns trigger language plpgsql set search_path='' as $$
begin
 if octet_length(new.payload::text)>4000000 then raise exception 'drawing_request_too_large' using errcode='22023'; end if;
 return new;
end $$;
revoke all on function bob_private.drawing_request_size() from public,anon,authenticated;
create trigger drawing_request_size before insert or update of payload on bob_private.drawing_requests
 for each row execute function bob_private.drawing_request_size();
alter table bob_private.drawing_requests drop constraint drawing_requests_payload_check;
alter table bob_private.drawing_requests add constraint drawing_requests_payload_check
 check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=4000000);
commit;
