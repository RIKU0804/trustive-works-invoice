-- ============================================================
-- RLS（Row Level Security）ポリシー
-- ============================================================

-- organizations
alter table organizations enable row level security;
create policy "members can read own org"
  on organizations for select
  using (id in (select organization_id from memberships where user_id = auth.uid()));

-- memberships
alter table memberships enable row level security;
create policy "members can read own memberships"
  on memberships for select
  using (user_id = auth.uid() or
         organization_id in (select organization_id from memberships where user_id = auth.uid() and role in ('owner','admin')));

-- users
alter table users enable row level security;
create policy "users can read own profile"
  on users for select using (id = auth.uid());
create policy "users can update own profile"
  on users for update using (id = auth.uid());

-- Helper: org membership check
create or replace function is_org_member(org_id uuid)
returns boolean language sql security definer stable as $$
  select exists(select 1 from memberships where user_id = auth.uid() and organization_id = org_id);
$$;

create or replace function is_org_admin(org_id uuid)
returns boolean language sql security definer stable as $$
  select exists(select 1 from memberships where user_id = auth.uid() and organization_id = org_id and role in ('owner','admin'));
$$;

-- staff_members
alter table staff_members enable row level security;
create policy "members can read staff" on staff_members for select using (is_org_member(organization_id));
create policy "admins can write staff" on staff_members for insert with check (is_org_admin(organization_id));
create policy "admins can update staff" on staff_members for update using (is_org_admin(organization_id));
create policy "admins can delete staff" on staff_members for delete using (is_org_admin(organization_id));

-- payment_notices
alter table payment_notices enable row level security;
create policy "members can read notices" on payment_notices for select using (is_org_member(organization_id));
create policy "members can insert notices" on payment_notices for insert with check (is_org_member(organization_id));
create policy "members can update notices" on payment_notices for update using (is_org_member(organization_id));
create policy "admins can delete notices" on payment_notices for delete using (is_org_admin(organization_id));

-- properties
alter table properties enable row level security;
create policy "members can read properties" on properties for select using (is_org_member(organization_id));
create policy "members can insert properties" on properties for insert with check (is_org_member(organization_id));
create policy "members can update properties" on properties for update using (is_org_member(organization_id));
create policy "admins can delete properties" on properties for delete using (is_org_admin(organization_id));

-- property_lines
alter table property_lines enable row level security;
create policy "members can read lines" on property_lines for select using (is_org_member(organization_id));
create policy "members can insert lines" on property_lines for insert with check (is_org_member(organization_id));
create policy "members can update lines" on property_lines for update using (is_org_member(organization_id));
create policy "admins can delete lines" on property_lines for delete using (is_org_admin(organization_id));

-- monthly_memos
alter table monthly_memos enable row level security;
create policy "members can read memos" on monthly_memos for select using (is_org_member(organization_id));
create policy "members can write memos" on monthly_memos for insert with check (is_org_member(organization_id));
create policy "members can update memos" on monthly_memos for update using (is_org_member(organization_id));

-- audit_logs
alter table audit_logs enable row level security;
create policy "admins can read logs" on audit_logs for select using (is_org_admin(organization_id));
create policy "members can insert logs" on audit_logs for insert with check (is_org_member(organization_id));
