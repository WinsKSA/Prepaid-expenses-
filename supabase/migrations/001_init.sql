-- Muqeem Desk — Supabase schema (records + roles + audit + GPS attendance)
-- Security model: every table has RLS; clients use the publishable key and act as the signed-in user.

------------------------------------------------------------------ users & roles
create table public.app_users (
  email text primary key check (email = lower(email)),
  role text not null check (role in ('admin','hr','finance','viewer','employee')),
  emp_no text,                                   -- links an 'employee' login to an employee record
  created_at timestamptz not null default now()
);

create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.app_users where email = lower(coalesce(auth.jwt()->>'email',''));
$$;
create or replace function public.app_emp_no() returns text
language sql stable security definer set search_path = public as $$
  select emp_no from public.app_users where email = lower(coalesce(auth.jwt()->>'email',''));
$$;
revoke all on function public.app_role(), public.app_emp_no() from public;
grant execute on function public.app_role(), public.app_emp_no() to authenticated;

------------------------------------------------------------------ business records (document model used by the app)
create table public.records (
  collection text not null check (collection in ('employees','renewals','visas','contracts','leaves','loans','payruns','config','shifts')),
  id text not null check (length(id) between 1 and 200),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (collection, id)
);

create table public.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text,
  collection text not null,
  record_id text not null,
  action text not null,
  old_data jsonb,
  new_data jsonb
);

create or replace function public.records_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := lower(coalesce(auth.jwt()->>'email','system'));
  return new;
end $$;

create or replace function public.records_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log(actor, collection, record_id, action, old_data, new_data)
  values (lower(coalesce(auth.jwt()->>'email','system')),
          coalesce(new.collection, old.collection), coalesce(new.id, old.id), lower(tg_op),
          case when tg_op in ('UPDATE','DELETE') then old.data end,
          case when tg_op in ('INSERT','UPDATE') then new.data end);
  return null;
end $$;

create trigger records_stamp before insert or update on public.records
  for each row execute function public.records_stamp();
create trigger records_audit after insert or update or delete on public.records
  for each row execute function public.records_audit();

------------------------------------------------------------------ GPS attendance
create table public.branches (
  id text primary key,
  name text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  radius_m integer not null default 150 check (radius_m between 20 and 5000),
  active boolean not null default true
);

create table public.attendance (
  id bigserial primary key,
  emp_no text not null,
  email text not null,
  kind text not null check (kind in ('in','out','break_start','break_end')),
  at timestamptz not null default now(),             -- server time, not device time
  lat double precision, lng double precision, accuracy_m double precision,
  branch_id text references public.branches(id),
  distance_m double precision,
  inside boolean not null default false,             -- within the branch geofence (decided by the server)
  status text not null default 'ok' check (status in ('ok','outside','low_accuracy','manual','approved','rejected')),
  note text,
  device text,
  reviewed_by text, reviewed_at timestamptz
);
create index attendance_emp_at on public.attendance(emp_no, at desc);

-- Employees punch only through this function: the server stamps the time, finds the nearest branch,
-- measures the distance (haversine) and decides whether the punch is inside the geofence.
create or replace function public.punch(p_kind text, p_lat double precision, p_lng double precision,
                                        p_accuracy double precision, p_device text default null, p_note text default null)
returns public.attendance
language plpgsql security definer set search_path = public as $$
declare
  v_emp text := public.app_emp_no();
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
  b record; best_id text; best_d double precision; best_r integer; v_row public.attendance; v_last timestamptz;
begin
  if v_emp is null then raise exception 'This login is not linked to an employee.'; end if;
  if p_kind not in ('in','out','break_start','break_end') then raise exception 'Invalid punch type'; end if;
  select max(at) into v_last from public.attendance where emp_no = v_emp and kind = p_kind;
  if v_last is not null and now() - v_last < interval '60 seconds' then raise exception 'Duplicate punch — wait a minute.'; end if;
  for b in select * from public.branches where active loop
    declare d double precision := 2 * 6371000 * asin(sqrt(
        power(sin(radians(p_lat - b.lat) / 2), 2) +
        cos(radians(b.lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - b.lng) / 2), 2)));
    begin
      if best_d is null or d < best_d then best_d := d; best_id := b.id; best_r := b.radius_m; end if;
    end;
  end loop;
  insert into public.attendance(emp_no, email, kind, lat, lng, accuracy_m, branch_id, distance_m, inside, status, note, device)
  values (v_emp, v_email, p_kind, p_lat, p_lng, p_accuracy, best_id, round(best_d::numeric,1),
          coalesce(best_d <= best_r, false),
          case when p_accuracy is null or p_accuracy > 100 then 'low_accuracy'
               when coalesce(best_d <= best_r, false) then 'ok' else 'outside' end,
          left(p_note, 500), left(p_device, 300))
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.punch(text,double precision,double precision,double precision,text,text) from public;
grant execute on function public.punch(text,double precision,double precision,double precision,text,text) to authenticated;

------------------------------------------------------------------ row level security
alter table public.app_users enable row level security;
alter table public.records enable row level security;
alter table public.audit_log enable row level security;
alter table public.branches enable row level security;
alter table public.attendance enable row level security;

-- records: office roles read; admin/hr/finance write. Employees never see company records.
create policy records_read on public.records for select to authenticated using (public.app_role() in ('admin','hr','finance','viewer'));
create policy records_insert on public.records for insert to authenticated with check (public.app_role() in ('admin','hr','finance'));
create policy records_update on public.records for update to authenticated using (public.app_role() in ('admin','hr','finance')) with check (public.app_role() in ('admin','hr','finance'));
create policy records_delete on public.records for delete to authenticated using (public.app_role() in ('admin','hr','finance'));

-- app_users: see own row; admin manages everyone
create policy app_users_read on public.app_users for select to authenticated using (email = lower(auth.jwt()->>'email') or public.app_role() = 'admin');
create policy app_users_admin_ins on public.app_users for insert to authenticated with check (public.app_role() = 'admin');
create policy app_users_admin_upd on public.app_users for update to authenticated using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy app_users_admin_del on public.app_users for delete to authenticated using (public.app_role() = 'admin');

-- audit log: readable by admin/hr/finance; written only by the trigger
create policy audit_read on public.audit_log for select to authenticated using (public.app_role() in ('admin','hr','finance'));

-- branches: everyone signed in reads (the phone shows the nearest branch); admin/hr manage
create policy branches_read on public.branches for select to authenticated using (public.app_role() is not null);
create policy branches_write on public.branches for all to authenticated using (public.app_role() in ('admin','hr')) with check (public.app_role() in ('admin','hr'));

-- attendance: employees read their own punches; office roles read all; HR reviews; inserts only via punch()
create policy attendance_read_own on public.attendance for select to authenticated using (emp_no = public.app_emp_no() or public.app_role() in ('admin','hr','finance','viewer'));
create policy attendance_review on public.attendance for update to authenticated using (public.app_role() in ('admin','hr')) with check (public.app_role() in ('admin','hr'));
create policy attendance_manual on public.attendance for insert to authenticated with check (public.app_role() in ('admin','hr') and status = 'manual');

revoke all on public.records, public.app_users, public.audit_log, public.branches, public.attendance from anon;

alter publication supabase_realtime add table public.records, public.attendance;

------------------------------------------------------------------ hardening (applied as migration harden_function_execute)
revoke execute on function public.app_role() from anon;
revoke execute on function public.app_emp_no() from anon;
revoke execute on function public.punch(text,double precision,double precision,double precision,text,text) from anon;
revoke execute on function public.records_audit() from anon, authenticated, public;
revoke execute on function public.records_stamp() from anon, authenticated, public;
