-- Muqeem Desk: attendance trust layer and branch kiosk (run after 003_attendance_ess.sql).
-- Adds: per-employee punch policy, GPS-accuracy tolerance, device binding, shared-device and fake-GPS signals,
-- optional selfie, and a branch kiosk (employee number + PIN) for staff without an email or a smartphone.

------------------------------------------------------------------ schema
alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check check (role in ('admin','hr','finance','viewer','employee','kiosk'));
alter table public.app_users add column if not exists branch_id text references public.branches(id) on delete set null;

alter table public.attendance add column if not exists device_id text;
alter table public.attendance add column if not exists photo_path text;
alter table public.attendance add column if not exists source text;
create index if not exists attendance_device_at on public.attendance(device_id, at desc);

create table if not exists public.devices (
  emp_no text not null,
  device_id text not null check (length(device_id) between 8 and 80),
  label text,
  status text not null default 'pending' check (status in ('approved','pending','revoked')),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  reviewed_by text, reviewed_at timestamptz,
  primary key (emp_no, device_id)
);
alter table public.devices enable row level security;
create policy devices_read on public.devices for select to authenticated
  using (emp_no = public.app_emp_no() or public.app_role() in ('admin','hr','finance','viewer'));
create policy devices_review on public.devices for update to authenticated
  using (public.app_role() in ('admin','hr')) with check (public.app_role() in ('admin','hr'));
create policy devices_delete on public.devices for delete to authenticated using (public.app_role() in ('admin','hr'));
revoke all on public.devices from anon;

-- PIN hashes are never readable by any client role: there are no policies, access is only through the functions below.
create table if not exists public.employee_pins (
  emp_no text primary key,
  pin_hash text not null,
  failed integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.employee_pins enable row level security;
revoke all on public.employee_pins from anon, authenticated;

------------------------------------------------------------------ devices
create or replace function public.device_register(v_emp text, p_device_id text, p_label text)
returns text language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select status into v_status from public.devices where emp_no = v_emp and device_id = p_device_id;
  if v_status is not null then
    update public.devices set last_seen = now() where emp_no = v_emp and device_id = p_device_id;
    return v_status;
  end if;
  v_status := case when exists (select 1 from public.devices where emp_no = v_emp and status = 'approved') then 'pending' else 'approved' end;
  insert into public.devices(emp_no, device_id, label, status) values (v_emp, p_device_id, left(p_label, 120), v_status);
  return v_status;
end $$;

-- Called when the check-in screen opens, so a new phone is on HR's list even if the punch itself is refused.
create or replace function public.device_hello(p_device_id text, p_label text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_emp text := public.app_emp_no();
begin
  if v_emp is null or p_device_id is null or length(p_device_id) not between 8 and 80 then return null; end if;
  return public.device_register(v_emp, p_device_id, p_label);
end $$;

------------------------------------------------------------------ the punch rule, shared by phone and kiosk
-- Rules come from records config/attendance:
--   geoMode 'any' | 'assigned'; blockOutside; maxAccuracyM; accuracyTolerance (default on); deviceLock; selfie
-- Employee hr.punchPolicy overrides the company rule: 'any' | 'assigned' | 'anywhere' (field staff) | 'none' (may not punch).
-- Trust signals never reject a punch by themselves: they add a flag that sends it to HR review.
create or replace function public.punch_core(v_emp text, v_email text, p_kind text, p_lat double precision, p_lng double precision,
  p_accuracy double precision, p_device text, p_note text, p_device_id text, p_photo text, p_source text)
returns public.attendance
language plpgsql security definer set search_path = public as $$
declare
  v_cfg jsonb := coalesce((select data from public.records where collection='config' and id='attendance'), '{}'::jsonb);
  v_empdoc jsonb := (select data from public.records where collection='employees' and id = v_emp);
  v_policy text := coalesce(nullif(v_empdoc->'hr'->>'punchPolicy',''), 'company');
  v_mode text;
  v_block boolean := coalesce((v_cfg->>'blockOutside')::boolean, false);
  v_maxacc double precision := coalesce((v_cfg->>'maxAccuracyM')::double precision, 100);
  v_tol double precision := 0;
  v_lock boolean := coalesce((v_cfg->>'deviceLock')::boolean, false);
  v_selfie boolean := coalesce((v_cfg->>'selfie')::boolean, false);
  v_allowed text[]; v_dev text; v_photo text;
  b record; best_id text; best_d double precision; best_r integer; v_row public.attendance; v_last timestamptz;
  v_prev public.attendance; v_status text; v_inside boolean; v_flags text[] := '{}'; v_km double precision; v_h double precision;
begin
  if p_kind not in ('in','out','break_start','break_end') then raise exception 'Invalid punch type'; end if;
  if v_policy = 'none' then raise exception 'Check-in is switched off for you. Ask HR.'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'A GPS location is required to check in.'; end if;
  select max(at) into v_last from public.attendance where emp_no = v_emp and kind = p_kind and status <> 'rejected';
  if v_last is not null and now() - v_last < interval '60 seconds' then raise exception 'Duplicate punch — wait a minute.'; end if;

  if p_source = 'phone' then
    if p_device_id is null or length(p_device_id) not between 8 and 80 then
      v_flags := array_append(v_flags, 'NO_DEVICE_ID'); p_device_id := null;
    else
      v_dev := public.device_register(v_emp, p_device_id, p_device);
      if v_dev = 'revoked' then raise exception 'This phone was removed from your account. Ask HR.'; end if;
      if v_dev = 'pending' then
        if v_lock then raise exception 'This phone is waiting for HR approval.'; end if;
        v_flags := array_append(v_flags, 'NEW_DEVICE');
      end if;
      if exists (select 1 from public.attendance a where a.device_id = p_device_id and a.emp_no <> v_emp and a.source = 'phone' and a.at > now() - interval '12 hours') then
        v_flags := array_append(v_flags, 'SHARED_DEVICE');
      end if;
    end if;
  end if;

  v_mode := case when v_policy in ('any','assigned') then v_policy else coalesce(v_cfg->>'geoMode','any') end;
  select array_agg(x) into v_allowed from (
    select v_empdoc->'hr'->>'branchId' as x
    union select jsonb_array_elements_text(coalesce(v_empdoc->'hr'->'branchIds','[]'::jsonb))) s where x is not null and x <> '';
  for b in select * from public.branches where active
           and (v_mode <> 'assigned' or v_allowed is null or id = any(v_allowed)) loop
    declare d double precision := 2 * 6371000 * asin(sqrt(
        power(sin(radians(p_lat - b.lat) / 2), 2) +
        cos(radians(b.lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - b.lng) / 2), 2)));
    begin
      if best_d is null or d < best_d then best_d := d; best_id := b.id; best_r := b.radius_m; end if;
    end;
  end loop;

  -- a fix reported as ±30 m may really be 30 m closer: allow for it, capped at 50 m so a client cannot widen a zone
  if coalesce((v_cfg->>'accuracyTolerance')::boolean, true) then v_tol := least(greatest(coalesce(p_accuracy, 0), 0), 50); end if;
  v_inside := v_policy = 'anywhere' or coalesce(best_d - v_tol <= best_r, false);
  v_status := case when p_accuracy is null or p_accuracy > v_maxacc then 'low_accuracy' when v_inside then 'ok' else 'outside' end;
  if v_block and v_status <> 'ok' then
    raise exception '%', case when v_status = 'low_accuracy' then 'GPS signal too weak (±' || round(coalesce(p_accuracy,0)) || ' m). Move outdoors and try again.'
                             when best_id is null then 'No branch zone is set up for you. Ask HR.'
                             else 'You are ' || round(best_d - best_r) || ' m outside the check-in zone.' end;
  end if;

  if p_accuracy is not null and p_accuracy <= 0 then v_flags := array_append(v_flags, 'ZERO_ACCURACY'); end if;
  select * into v_prev from public.attendance where emp_no = v_emp and lat is not null order by at desc limit 1;
  if found then
    v_km := 2 * 6371 * asin(sqrt(power(sin(radians(p_lat - v_prev.lat) / 2), 2) + cos(radians(v_prev.lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - v_prev.lng) / 2), 2)));
    v_h := extract(epoch from (now() - v_prev.at)) / 3600.0;
    if v_km > 5 and (v_h <= 0 or v_km / v_h > 250) then v_flags := array_append(v_flags, 'IMPOSSIBLE_TRAVEL'); v_status := 'outside'; end if;
    if v_prev.lat = p_lat and v_prev.lng = p_lng and v_prev.at < now() - interval '12 hours' then v_flags := array_append(v_flags, 'SAME_FIX'); end if;
  end if;

  if p_photo is not null and (p_photo like v_emp || '/%' or (p_source = 'kiosk' and p_photo like 'kiosk/%')) and p_photo !~ '\.\.' then v_photo := left(p_photo, 200); end if;
  if v_selfie and v_photo is null then v_flags := array_append(v_flags, 'NO_PHOTO'); end if;

  insert into public.attendance(emp_no, email, kind, lat, lng, accuracy_m, branch_id, distance_m, inside, status, note, device, flags, device_id, photo_path, source)
  values (v_emp, v_email, p_kind, p_lat, p_lng, p_accuracy, best_id, round(best_d::numeric,1), v_inside, v_status,
          left(p_note, 500), left(p_device, 300), v_flags, p_device_id, v_photo, p_source)
  returning * into v_row;
  return v_row;
end $$;

drop function if exists public.punch(text,double precision,double precision,double precision,text,text);
create or replace function public.punch(p_kind text, p_lat double precision, p_lng double precision, p_accuracy double precision,
  p_device text default null, p_note text default null, p_device_id text default null, p_photo text default null)
returns public.attendance
language plpgsql security definer set search_path = public as $$
declare v_emp text := public.app_emp_no();
begin
  if v_emp is null then raise exception 'This login is not linked to an employee.'; end if;
  return public.punch_core(v_emp, lower(coalesce(auth.jwt()->>'email','')), p_kind, p_lat, p_lng, p_accuracy, p_device, p_note, p_device_id, p_photo, 'phone');
end $$;

------------------------------------------------------------------ branch kiosk
-- A shared tablet or supervisor phone signs in with role 'kiosk'. Staff enter their number and PIN. The server decides in or out.
-- Wrong PINs return a result instead of raising, so the failure counter survives; 5 wrong tries lock that number for 15 minutes.
create or replace function public.kiosk_punch(p_emp text, p_pin text, p_lat double precision, p_lng double precision, p_accuracy double precision,
  p_device text default null, p_photo text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id text; v_name text; r public.employee_pins; v_last public.attendance; v_kind text; v_row public.attendance;
  bad constant jsonb := jsonb_build_object('ok', false, 'error', 'Wrong number or PIN.');
begin
  if public.app_role() is distinct from 'kiosk' then raise exception 'Kiosk sign-in required.'; end if;
  p_emp := trim(coalesce(p_emp, ''));
  if p_emp = '' or coalesce(p_pin, '') = '' then return bad; end if;
  select id, coalesce(nullif(data->>'nameEn',''), data->>'nameAr') into v_id, v_name from public.records
   where collection = 'employees' and (id = upper(p_emp) or data->>'hrNo' = p_emp) and coalesce(data->>'status','Active') = 'Active' limit 1;
  if v_id is null then return bad; end if;
  select * into r from public.employee_pins where emp_no = v_id for update;
  if not found then return bad; end if;
  if r.locked_until is not null and r.locked_until > now() then return jsonb_build_object('ok', false, 'error', 'Too many wrong tries. Wait 15 minutes or ask HR.'); end if;
  if r.pin_hash <> crypt(p_pin, r.pin_hash) then
    update public.employee_pins set failed = case when failed + 1 >= 5 then 0 else failed + 1 end,
      locked_until = case when failed + 1 >= 5 then now() + interval '15 minutes' else null end where emp_no = v_id;
    return bad;
  end if;
  update public.employee_pins set failed = 0, locked_until = null where emp_no = v_id;
  select * into v_last from public.attendance where emp_no = v_id and status <> 'rejected' and at > now() - interval '18 hours' order by at desc limit 1;
  if found and now() - v_last.at < interval '60 seconds' then return jsonb_build_object('ok', false, 'error', 'Already recorded a moment ago.'); end if;
  v_kind := case when found and v_last.kind <> 'out' then 'out' else 'in' end;
  v_row := public.punch_core(v_id, lower(coalesce(auth.jwt()->>'email','')), v_kind, p_lat, p_lng, p_accuracy, p_device, null, null, p_photo, 'kiosk');
  return jsonb_build_object('ok', true, 'kind', v_row.kind, 'at', v_row.at, 'name', v_name, 'status', v_row.status, 'branchId', v_row.branch_id);
end $$;

create or replace function public.set_pin(p_emp text, p_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if public.app_role() not in ('admin','hr') then raise exception 'Only HR can set a PIN.'; end if;
  if p_pin !~ '^\d{4,6}$' then raise exception 'A PIN is 4 to 6 digits.'; end if;
  if not exists (select 1 from public.records where collection='employees' and id = p_emp) then raise exception 'Unknown employee.'; end if;
  insert into public.employee_pins(emp_no, pin_hash, updated_by) values (p_emp, crypt(p_pin, gen_salt('bf', 8)), lower(coalesce(auth.jwt()->>'email','')))
  on conflict (emp_no) do update set pin_hash = excluded.pin_hash, failed = 0, locked_until = null, updated_at = now(), updated_by = excluded.updated_by;
end $$;

create or replace function public.pins_set()
returns setof text language plpgsql stable security definer set search_path = public as $$
begin
  if public.app_role() not in ('admin','hr') then raise exception 'Only HR can see this.'; end if;
  return query select emp_no from public.employee_pins;
end $$;

create or replace function public.kiosk_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.app_role() is null then null else jsonb_build_object(
    'selfie', coalesce((c.data->>'selfie')::boolean, false), 'maxAccuracyM', coalesce((c.data->>'maxAccuracyM')::numeric, 100),
    'branchId', (select branch_id from public.app_users where email = lower(coalesce(auth.jwt()->>'email','')))) end
  from (select (select data from public.records where collection='config' and id='attendance') as data) c;
$$;

create or replace function public.my_context() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'empNo', e.id,
    'nameEn', e.data->>'nameEn', 'nameAr', e.data->>'nameAr',
    'jobTitle', e.data->>'jobTitle', 'department', e.data->>'department',
    'hr', jsonb_build_object('shiftId', e.data->'hr'->>'shiftId', 'branchId', e.data->'hr'->>'branchId', 'branchIds', e.data->'hr'->'branchIds', 'hireDate', e.data->'hr'->>'hireDate', 'punchPolicy', e.data->'hr'->>'punchPolicy'),
    'attendance', coalesce((select c.data from public.records c where c.collection = 'config' and c.id = 'attendance'), '{}'::jsonb)
  )
  from public.records e
  where e.collection = 'employees' and e.id = public.app_emp_no();
$$;

------------------------------------------------------------------ function access
revoke all on function public.punch_core(text,text,text,double precision,double precision,double precision,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.device_register(text,text,text) from public, anon, authenticated;
revoke all on function public.punch(text,double precision,double precision,double precision,text,text,text,text) from public, anon;
revoke all on function public.device_hello(text,text) from public, anon;
revoke all on function public.kiosk_punch(text,text,double precision,double precision,double precision,text,text) from public, anon;
revoke all on function public.set_pin(text,text) from public, anon;
revoke all on function public.pins_set() from public, anon;
revoke all on function public.kiosk_config() from public, anon;
grant execute on function public.punch(text,double precision,double precision,double precision,text,text,text,text) to authenticated;
grant execute on function public.device_hello(text,text) to authenticated;
grant execute on function public.kiosk_punch(text,text,double precision,double precision,double precision,text,text) to authenticated;
grant execute on function public.set_pin(text,text) to authenticated;
grant execute on function public.pins_set() to authenticated;
grant execute on function public.kiosk_config() to authenticated;

------------------------------------------------------------------ selfie storage (private bucket; small JPEGs only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('punch-photos', 'punch-photos', false, 400000, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 400000, allowed_mime_types = array['image/jpeg'];

create policy punch_photos_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'punch-photos' and (
    (storage.foldername(name))[1] = public.app_emp_no()
    or (public.app_role() = 'kiosk' and (storage.foldername(name))[1] = 'kiosk')));
create policy punch_photos_read on storage.objects for select to authenticated using (
  bucket_id = 'punch-photos' and (public.app_role() in ('admin','hr') or (storage.foldername(name))[1] = public.app_emp_no()));
