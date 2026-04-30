-- ============================================================
-- 初期スキーマ
-- ============================================================

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  display_name text,
  plan text not null default 'free',
  subscription_status text default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  role text not null check (role in ('owner','admin','member')),
  invited_by uuid references users(id),
  joined_at timestamptz not null default now(),
  unique(user_id, organization_id)
);
create index on memberships(organization_id);
create index on memberships(user_id);

create table staff_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(organization_id, name)
);
create index on staff_members(organization_id);

create table payment_notices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  report_month date not null,
  payment_date date,
  construction_total numeric,
  transfer_amount numeric,
  offset_incl_tax numeric,
  parse_status text not null default 'pending' check (parse_status in ('pending','parsing','completed','failed')),
  parse_error text,
  uploaded_by uuid not null references users(id),
  uploaded_at timestamptz not null default now(),
  finalized_at timestamptz
);
create index on payment_notices(organization_id, report_month);
create index on payment_notices(organization_id, parse_status);

create table properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  payment_notice_id uuid not null references payment_notices(id) on delete cascade,
  property_name text not null,
  contract_no text,
  work_summary text,
  amount_sales numeric not null default 0,
  amount_shaho numeric not null default 0,
  amount_seisanka numeric not null default 0,
  amount_material numeric not null default 0,
  amount_gross_profit numeric generated always as
    (amount_sales - amount_shaho - amount_seisanka - amount_material) stored,
  gross_profit_rate numeric generated always as
    (case when amount_sales = 0 then 0
          else (amount_sales - amount_shaho - amount_seisanka - amount_material) / amount_sales
     end) stored,
  staff_member_id uuid references staff_members(id),
  pdf_page_number integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on properties(organization_id, payment_notice_id);
create index on properties(organization_id, staff_member_id);
create index on properties(organization_id, property_name);

create table property_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  work_type text not null,
  amount_excl_tax numeric not null,
  consumption_tax numeric not null default 0,
  amount_incl_tax numeric not null default 0,
  note text,
  category text not null check (category in ('sales','shaho','seisanka','material')),
  is_manually_overridden boolean not null default false,
  sort_order integer not null,
  created_at timestamptz not null default now()
);
create index on property_lines(organization_id, property_id, sort_order);

create table monthly_memos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  report_month date not null,
  content text not null default '',
  updated_by uuid references users(id),
  updated_at timestamptz not null default now(),
  unique(organization_id, report_month)
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid references users(id),
  action text not null,
  resource_type text,
  resource_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index on audit_logs(organization_id, created_at desc);
