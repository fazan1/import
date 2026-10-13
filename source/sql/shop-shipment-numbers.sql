-- Shop shipments get their own prefix: SHOP-LCL-2610-01, so they never look like yours.
-- Your numbering (LCL-2610-01) is unchanged. Nothing deleted. Safe to re-run. MAIN project only.
CREATE OR REPLACE FUNCTION public.next_shipment_no(p_mode text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ym text := to_char(now(), 'YYMM');
  v_pre text := CASE WHEN public.my_locked_book() IS NOT NULL THEN 'SHOP-' ELSE '' END;
  v_n integer;
  v_no text;
BEGIN
  SELECT COALESCE(MAX(substring(shipment_no FROM '-(\d+)$')::integer), 0) + 1 INTO v_n
    FROM shipments WHERE shipment_no LIKE v_pre || upper(p_mode) || '-' || v_ym || '-%'
      AND (v_pre <> '' OR shipment_no NOT LIKE 'SHOP-%');
  LOOP
    v_no := v_pre || upper(p_mode) || '-' || v_ym || '-' || lpad(v_n::text, 2, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM shipments WHERE shipment_no = v_no);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_no;
END $$;
GRANT EXECUTE ON FUNCTION public.next_shipment_no(text) TO authenticated;
SELECT 'shop shipment numbers ready' AS status;
