-- Orders: add the `metadata` column the worker has always written.
--
-- Root cause (2026-08-18 production audit): four worker handlers referenced
-- `orders.total_amount` and `orders.metadata`. The real money column is
-- `orders.total` (numeric NOT NULL) and `metadata` never existed at all, so:
--
--   * handleCreateOrderFromCart  — INSERT failed, no order row was ever created
--   * handlePayOrder             — SELECT 42703, every pay attempt 404'd
--   * handleBillingHistory       — SELECT 42703
--   * handleOpsRevenue           — SELECT 42703 -> throw "ops_revenue_failed"
--
-- Corroborated by the data: public.orders held 0 rows.
--
-- `total_amount` is fixed in code by using the real `total` column. `metadata`
-- is genuinely required by the product logic it carries and has no existing
-- home, so it is added here:
--   * { cart_id, item_count }  — links a paid order back to its cart
--   * { purchase_type: 'ppv' } — the discriminator handleOpsRevenue filters on
--
-- Additive and backward compatible: NOT NULL with a '{}' default, so existing
-- rows and any writer that omits the column keep working.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- handleOpsRevenue filters paid orders by metadata->>'purchase_type'.
CREATE INDEX IF NOT EXISTS idx_orders_metadata_purchase_type
  ON public.orders ((metadata ->> 'purchase_type'))
  WHERE status = 'paid';
