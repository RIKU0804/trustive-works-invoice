-- Storage bucket for payment notice PDFs
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-notices',
  'payment-notices',
  false,
  52428800, -- 50MB
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for storage.objects on payment-notices bucket
-- Path format: {organization_id}/{filename}

CREATE POLICY "members can read own org PDFs"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'payment-notices'
    AND is_org_member((storage.foldername(name))[1]::uuid)
  );

CREATE POLICY "members can upload PDFs to own org"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'payment-notices'
    AND is_org_member((storage.foldername(name))[1]::uuid)
  );

CREATE POLICY "admins can delete PDFs in own org"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'payment-notices'
    AND is_org_admin((storage.foldername(name))[1]::uuid)
  );
