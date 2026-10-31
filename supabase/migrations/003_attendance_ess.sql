-- Muqeem Desk — attendance self-service (run after 001_init.sql and 002_first_admin.sql).
-- Adds: correction requests from employees, a safe "my context" lookup for the phone check-in screen,
-- and lets HR record punches imported from devices / Excel.

------------------------------------------------------------------ employees ask HR to fix a missed punch
create table if not exists public.attendance_requests (
  id bigserial primary key,
  emp_no text not null,
  email text not null,
  day date not null,
  kind text not null check (kind in ('in','out','break_start','break_end')),
  at_time text not null check (at_time ~ '^\d{2}:\d{2}$'),           -- KSA local time HH:MM
  reason text not null check (length(reason) between 3 and 500),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_by text, reviewed_at timestamptz, review_note text
);
create index if not exists attendance_requests_emp on public.attendance_requests(emp_no, day desc);
alter table public.attendance_requests enable row level security;

create policy attreq_read on public.attendance_requests for select to authenticated
  using (emp_no = public.app_emp_no() or public.app_role() in ('admin','hr','finance','viewer'));
create policy attreq_insert_own on public.attendance_requests for insert to authenticated
  with check (emp_no = public.app_emp_no() and email = lower(auth.jwt()->>'email') and status = 'pending');
create policy attreq_review on public.attendance_requests for update to authenticated
  using (public.app_role() in ('admin','hr')) with check (public.app_role() in ('admin','hr'));
revoke all on public.attendance_requests from anon;

------------------------------------------------------------------ device / Excel imports are recorded by HR as 'manual'
-- (001 already allows admin/hr to insert rows with status = 'manual'; this index keeps imports idempotent)
create unique index if not exists attendance_unique_punch on public.attendance(emp_no, kind, at);

------------------------------------------------------------------ what the phone check-in screen may know about the signed-in employee
-- Employees cannot read company records. This returns only their own name, job, shift and the attendance rules.
create or replace function public.my_context() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'empNo', e.id,
    'nameEn', e.data->>'nameEn', 'nameAr', e.data->>'nameAr',
    'jobTitle', e.data->>'jobTitle', 'department', e.data->>'department',
    'hr', jsonb_build_object('shiftId', e.data->'hr'->>'shiftId', 'branchId', e.data->'hr'->>'branchId', 'branchIds', e.data->'hr'->'branchIds', 'hireDate', e.data->'hr'->>'hireDate'),
    'attendance', coalesce((select c.data from public.records c where c.collection = 'config' and c.id = 'attendance'), '{}'::jsonb)
  )
  from public.records e
  where e.collection = 'employees' and e.id = public.app_emp_no();
$$;
revoke all on function public.my_context() from public, anon;
grant execute on function public.my_context() to authenticated;

------------------------------------------------------------------ stricter server-side punch()
-- Rules come from records config/attendance (edited in Shifts & Branches):
--   geoMode 'assigned' → only the employee's assigned branch(es) (employee hr.branchId / hr.branchIds) count
--   blockOutside true  → a punch outside every allowed zone (or with GPS accuracy worse than maxAccuracyM) is refused
--   impossible travel  → a punch more than 5 km from the previous one at > 250 km/h is recorded with status 'outside' and a note
alter table public.attendance add column if not exists flags text[];
create or replace function public.punch(p_kind text, p_lat double precision, p_lng double precision,
                                        p_accuracy double precision, p_device text default null, p_note text default null)
returns public.attendance
language plpgsql security definer set search_path = public as $$
declare
  v_emp text := public.app_emp_no();
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
  v_cfg jsonb := coalesce((select data from public.records where collection='config' and id='attendance'), '{}'::jsonb);
  v_empdoc jsonb := (select data from public.records where collection='employees' and id = public.app_emp_no());
  v_mode text := coalesce(v_cfg->>'geoMode','any');
  v_block boolean := coalesce((v_cfg->>'blockOutside')::boolean, false);
  v_maxacc double precision := coalesce((v_cfg->>'maxAccuracyM')::double precision, 100);
  v_allowed text[];
  b record; best_id text; best_d double precision; best_r integer; v_row public.attendance; v_last timestamptz;
  v_prev public.attendance; v_status text; v_inside boolean; v_flags text[] := '{}'; v_km double precision; v_h double precision;
begin
  if v_emp is null then raise exception 'This login is not linked to an employee.'; end if;
  if p_kind not in ('in','out','break_start','break_end') then raise exception 'Invalid punch type'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'A GPS location is required to check in.'; end if;
  select max(at) into v_last from public.attendance where emp_no = v_emp and kind = p_kind and status <> 'rejected';
  if v_last is not null and now() - v_last < interval '60 seconds' then raise exception 'Duplicate punch — wait a minute.'; end if;
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
  v_inside := coalesce(best_d <= best_r, false);
  v_status := case when p_accuracy is null or p_accuracy > v_maxacc then 'low_accuracy' when v_inside then 'ok' else 'outside' end;
  if v_block and v_status <> 'ok' then
    raise exception '%', case when v_status = 'low_accuracy' then 'GPS signal too weak (±' || round(coalesce(p_accuracy,0)) || ' m). Move outdoors and try again.'
                             when best_id is null then 'No branch zone is set up for you. Ask HR.'
                             else 'You are ' || round(best_d - best_r) || ' m outside the check-in zone.' end;
  end if;
  select * into v_prev from public.attendance where emp_no = v_emp and lat is not null order by at desc limit 1;
  if found then
    v_km := 2 * 6371 * asin(sqrt(power(sin(radians(p_lat - v_prev.lat) / 2), 2) + cos(radians(v_prev.lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - v_prev.lng) / 2), 2)));
    v_h := extract(epoch from (now() - v_prev.at)) / 3600.0;
    if v_km > 5 and (v_h <= 0 or v_km / v_h > 250) then v_flags := v_flags || 'IMPOSSIBLE_TRAVEL'; v_status := 'outside'; end if;
  end if;
  insert into public.attendance(emp_no, email, kind, lat, lng, accuracy_m, branch_id, distance_m, inside, status, note, device, flags)
  values (v_emp, v_email, p_kind, p_lat, p_lng, p_accuracy, best_id, round(best_d::numeric,1), v_inside, v_status,
          left(p_note, 500), left(p_device, 300), v_flags)
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.punch(text,double precision,double precision,double precision,text,text) from public, anon;
grant execute on function public.punch(text,double precision,double precision,double precision,text,text) to authenticated;

alter publication supabase_realtime add table public.attendance_requests;
