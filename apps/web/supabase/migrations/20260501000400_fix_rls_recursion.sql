-- Fix: infinite recursion in memberships SELECT policy
-- The original policy referenced memberships in its USING clause, causing recursion.
-- Replace with non-recursive version using SECURITY DEFINER helper functions.

DROP POLICY IF EXISTS "members can read own memberships" ON memberships;

CREATE POLICY "members can read memberships in their org"
  ON memberships FOR SELECT
  USING (
    user_id = auth.uid()
    OR is_org_member(organization_id)
  );

-- Users in the same org should be able to see each other (for settings/users page).
DROP POLICY IF EXISTS "users can read own profile" ON users;

CREATE POLICY "users can read profiles in same org"
  ON users FOR SELECT
  USING (
    id = auth.uid()
    OR id IN (
      SELECT m.user_id FROM memberships m
      WHERE is_org_member(m.organization_id)
    )
  );
