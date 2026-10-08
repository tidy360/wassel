CREATE TABLE IF NOT EXISTS "pricing_settings" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "default_pricing_mode" TEXT NOT NULL DEFAULT 'MANUAL',
  "default_profit_margin" DECIMAL(6,2) NOT NULL DEFAULT 0,
  "minimum_profit_margin" DECIMAL(6,2) NOT NULL DEFAULT 0,
  "default_cost_method" TEXT NOT NULL DEFAULT 'LAST_PURCHASE_COST',
  "default_currency" TEXT NOT NULL DEFAULT 'SDG',
  "rounding_unit" DECIMAL(14,2) NOT NULL DEFAULT 1,
  "maximum_suggested_increase" DECIMAL(6,2) NOT NULL DEFAULT 30,
  "minimum_price_change_threshold" DECIMAL(6,2) NOT NULL DEFAULT 1,
  "allow_selling_below_cost" BOOLEAN NOT NULL DEFAULT false,
  "require_approval" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pricing_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "pricing_settings_store_id_key" ON "pricing_settings"("store_id");
CREATE INDEX IF NOT EXISTS "pricing_settings_tenant_id_idx" ON "pricing_settings"("tenant_id");
ALTER TABLE "pricing_settings" ADD CONSTRAINT "pricing_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pricing_settings" ADD CONSTRAINT "pricing_settings_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "product_pricing" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "pricing_mode" TEXT NOT NULL DEFAULT 'MANUAL',
  "cost_method" TEXT NOT NULL DEFAULT 'LAST_PURCHASE_COST',
  "profit_margin" DECIMAL(6,2) NOT NULL DEFAULT 0,
  "minimum_profit_margin" DECIMAL(6,2) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'SDG',
  "suggested_price" DECIMAL(14,2),
  "current_cost" DECIMAL(14,2),
  "last_cost" DECIMAL(14,2),
  "suggestion_reason" TEXT,
  "last_price_update" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_pricing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "product_pricing_product_id_key" ON "product_pricing"("product_id");
CREATE INDEX IF NOT EXISTS "product_pricing_tenant_store_mode_idx" ON "product_pricing"("tenant_id", "store_id", "pricing_mode");
ALTER TABLE "product_pricing" ADD CONSTRAINT "product_pricing_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "exchange_rates" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "rate" DECIMAL(14,4) NOT NULL,
  "effective_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "exchange_rates_scope_idx" ON "exchange_rates"("tenant_id", "store_id", "currency", "effective_at");
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "price_change_proposals" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "old_price" DECIMAL(14,2) NOT NULL,
  "suggested_price" DECIMAL(14,2) NOT NULL,
  "current_cost" DECIMAL(14,2) NOT NULL,
  "profit_margin" DECIMAL(6,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "note" TEXT,
  "created_by" TEXT,
  "reviewed_by" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "price_change_proposals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "price_change_proposals_scope_status_idx" ON "price_change_proposals"("tenant_id", "store_id", "status");
CREATE INDEX IF NOT EXISTS "price_change_proposals_product_status_idx" ON "price_change_proposals"("product_id", "status");
ALTER TABLE "price_change_proposals" ADD CONSTRAINT "price_change_proposals_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_change_proposals" ADD CONSTRAINT "price_change_proposals_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "price_history" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "old_price" DECIMAL(14,2),
  "new_price" DECIMAL(14,2) NOT NULL,
  "cost" DECIMAL(14,2),
  "profit_margin" DECIMAL(6,2),
  "exchange_rate" DECIMAL(14,4),
  "change_type" TEXT NOT NULL,
  "reason" TEXT,
  "note" TEXT,
  "user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "price_history_scope_created_idx" ON "price_history"("tenant_id", "store_id", "created_at");
CREATE INDEX IF NOT EXISTS "price_history_product_created_idx" ON "price_history"("product_id", "created_at");
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
