-- Muqeem Desk: one employee requests inbox (run after 004).
-- Staff send requests from their phone; admin/HR decide. Grievances are visible to admin/HR and the sender only.
create table if not exists public.hr_requests (
  id bigserial primary key,
  emp_no text not null,
  email text not null,
  type text not null check (type in ('salary_certificate','employment_letter','noc','exit_reentry','salary_advance','excuse','overtime','expense','data_change','grievance','other')),
  details jsonb not null default '{}'::jsonb,
  note text check (note is null or length(note) <= 1000),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  created_at timestamptz not null default now(),
  decided_by text, decided_at timestamptz, decision_note text check (decision_note is null or length(decision_note) <= 500)
);
create index if not exists hr_requests_emp on public.hr_requests(emp_no, created_at desc);
create index if not exists hr_requests_status on public.hr_requests(status, created_at desc);
alter table public.hr_requests enable row level security;

create policy hrreq_read on public.hr_requests for select to authenticated using (
  emp_no = public.app_emp_no() or public.app_role() in ('admin','hr')
  or (public.app_role() in ('finance','viewer') and type <> 'grievance'));
create policy hrreq_insert_own on public.hr_requests for insert to authenticated with check (
  emp_no = public.app_emp_no() and email = lower(auth.jwt()->>'email')
  and status = 'pending' and decided_by is null and decided_at is null and decision_note is null);
create policy hrreq_decide on public.hr_requests for update to authenticated
  using (public.app_role() in ('admin','hr')) with check (public.app_role() in ('admin','hr'));
revoke all on public.hr_requests from anon;

-- Employees may withdraw their own request while it is still pending; nothing else about it can change.
create or replace function public.cancel_request(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.hr_requests set status = 'cancelled' where id = p_id and emp_no = public.app_emp_no() and status = 'pending';
  if not found then raise exception 'This request can no longer be cancelled.'; end if;
end $$;
revoke all on function public.cancel_request(bigint) from public, anon;
grant execute on function public.cancel_request(bigint) to authenticated;

alter publication supabase_realtime add table public.hr_requests;
