-- Lets YOUR admin login see every shipment (including your brother's book).
-- Today each shipment is visible only to the login that created it.
-- Your brother still sees only his own book. Nothing is deleted. Safe to re-run.
-- Run on your MAIN project only.
CREATE OR REPLACE FUNCTION public.is_app_admin() RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_users WHERE user_id = auth.uid() AND role = 'admin' AND is_active);
$$;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated;

DROP POLICY IF EXISTS "admin sees all shipments" ON public.shipments;
CREATE POLICY "admin sees all shipments" ON public.shipments
  FOR ALL TO authenticated USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());

SELECT 'shipments visible to admin' AS status;
