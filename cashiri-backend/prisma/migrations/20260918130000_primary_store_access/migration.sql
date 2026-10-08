ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "is_main" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "all_stores_access" BOOLEAN NOT NULL DEFAULT false;

WITH first_stores AS (
  SELECT DISTINCT ON (tenant_id) id, tenant_id
  FROM "stores"
  ORDER BY tenant_id, created_at ASC
)
UPDATE "stores" s
SET "is_main" = true
FROM first_stores f
WHERE s.id = f.id;

WITH first_admins AS (
  SELECT DISTINCT ON (u.tenant_id) u.id
  FROM "users" u
  JOIN "user_roles" ur ON ur.user_id = u.id
  JOIN "roles" r ON r.id = ur.role_id
  JOIN "stores" s ON s.id = u.store_id AND s.is_main = true
  WHERE u.tenant_id IS NOT NULL AND r.name = 'ADMIN'
  ORDER BY u.tenant_id, u.created_at ASC
)
UPDATE "users" u
SET "all_stores_access" = true
FROM first_admins a
WHERE u.id = a.id;

CREATE INDEX IF NOT EXISTS "stores_tenant_is_main_idx" ON "stores"("tenant_id", "is_main");
CREATE INDEX IF NOT EXISTS "users_tenant_all_stores_idx" ON "users"("tenant_id", "all_stores_access");
