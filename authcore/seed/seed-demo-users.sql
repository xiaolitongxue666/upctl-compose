-- Seed demo users for development mode (idempotent — safe to run on every startup)

-- 1. Create the demo app for localhost
INSERT INTO hty_apps (app_id, domain, app_status, app_desc)
SELECT 'demo-app', 'localhost', 'ACTIVE', 'Demo app for compose dev mode'
WHERE NOT EXISTS (SELECT 1 FROM hty_apps WHERE app_id = 'demo-app');

-- 2. Create an ADMIN role
INSERT INTO hty_roles (hty_role_id, role_key, role_desc, role_status, is_system)
SELECT 'demo-admin-role', 'ADMIN', 'Demo admin role', 'ACTIVE', true
WHERE NOT EXISTS (SELECT 1 FROM hty_roles WHERE hty_role_id = 'demo-admin-role');

-- 3. Link the role to the app
INSERT INTO apps_roles (the_id, app_id, role_id)
SELECT gen_random_uuid()::text, 'demo-app', 'demo-admin-role'
WHERE NOT EXISTS (
  SELECT 1 FROM apps_roles WHERE app_id = 'demo-app' AND role_id = 'demo-admin-role'
);

-- 4. Create demo user in hty_users
INSERT INTO hty_users (hty_id, union_id, enabled, created_at, real_name)
SELECT 'demo-user', 'demo', true, now(), 'Demo User'
WHERE NOT EXISTS (SELECT 1 FROM hty_users WHERE hty_id = 'demo-user');

-- 5. Create user_app_info with username and password
INSERT INTO user_app_info (id, hty_id, app_id, username, password, is_registered, created_at)
SELECT gen_random_uuid()::text, 'demo-user', 'demo-app', 'demo', 'demo123', true, now()
WHERE NOT EXISTS (
  SELECT 1 FROM user_app_info WHERE username = 'demo' AND app_id = 'demo-app'
);

-- 6. Assign ADMIN role to user
INSERT INTO user_info_roles (the_id, user_info_id, role_id)
SELECT gen_random_uuid()::text,
  (SELECT id FROM user_app_info WHERE username = 'demo' AND app_id = 'demo-app' LIMIT 1),
  'demo-admin-role'
WHERE NOT EXISTS (
  SELECT 1 FROM user_info_roles
  WHERE user_info_id = (SELECT id FROM user_app_info WHERE username = 'demo' AND app_id = 'demo-app' LIMIT 1)
  AND role_id = 'demo-admin-role'
);

-- 7. Also create a second admin user (管理员)
INSERT INTO hty_users (hty_id, union_id, enabled, created_at, real_name)
SELECT 'admin-user', 'admin', true, now(), '管理员'
WHERE NOT EXISTS (SELECT 1 FROM hty_users WHERE hty_id = 'admin-user');

INSERT INTO user_app_info (id, hty_id, app_id, username, password, is_registered, created_at)
SELECT gen_random_uuid()::text, 'admin-user', 'demo-app', 'admin', 'admin123', true, now()
WHERE NOT EXISTS (
  SELECT 1 FROM user_app_info WHERE username = 'admin' AND app_id = 'demo-app'
);

INSERT INTO user_info_roles (the_id, user_info_id, role_id)
SELECT gen_random_uuid()::text,
  (SELECT id FROM user_app_info WHERE username = 'admin' AND app_id = 'demo-app' LIMIT 1),
  'demo-admin-role'
WHERE NOT EXISTS (
  SELECT 1 FROM user_info_roles
  WHERE user_info_id = (SELECT id FROM user_app_info WHERE username = 'admin' AND app_id = 'demo-app' LIMIT 1)
  AND role_id = 'demo-admin-role'
);

-- 8. Create root app (required by /api/v1/uc/sudo endpoint)
INSERT INTO hty_apps (app_id, domain, app_status, app_desc)
SELECT 'root-app', 'root', 'ACTIVE', 'Root app for sudo operations'
WHERE NOT EXISTS (SELECT 1 FROM hty_apps WHERE domain = 'root');

-- 9. Create root user (required by /api/v1/uc/sudo endpoint)
INSERT INTO hty_users (hty_id, union_id, enabled, created_at, real_name)
SELECT 'root-user', 'root', true, now(), 'Root User'
WHERE NOT EXISTS (SELECT 1 FROM hty_users WHERE hty_id = 'root-user');

-- 10. Link root user to root app with username 'root'
INSERT INTO user_app_info (id, hty_id, app_id, username, password, is_registered, created_at)
SELECT gen_random_uuid()::text, 'root-user', 'root-app', 'root', null, true, now()
WHERE NOT EXISTS (
  SELECT 1 FROM user_app_info WHERE username = 'root' AND app_id = 'root-app'
);

-- 11. Second app for per-app verify UI tests
INSERT INTO hty_apps (app_id, domain, app_status, app_desc)
SELECT 'pending-app', 'pending.localhost', 'ACTIVE', 'Pending verify demo app'
WHERE NOT EXISTS (SELECT 1 FROM hty_apps WHERE app_id = 'pending-app');

INSERT INTO apps_roles (the_id, app_id, role_id)
SELECT gen_random_uuid()::text, 'pending-app', 'demo-admin-role'
WHERE NOT EXISTS (
  SELECT 1 FROM apps_roles WHERE app_id = 'pending-app' AND role_id = 'demo-admin-role'
);

-- 12. User registered on demo-app but pending on pending-app (partial verify scenario)
INSERT INTO hty_users (hty_id, union_id, enabled, created_at, real_name)
SELECT 'pending-user', 'pending-demo', true, now(), '待审演示'
WHERE NOT EXISTS (SELECT 1 FROM hty_users WHERE hty_id = 'pending-user');

INSERT INTO user_app_info (id, hty_id, app_id, username, password, is_registered, created_at)
SELECT gen_random_uuid()::text, 'pending-user', 'demo-app', 'pending-demo', 'demo123', true, now()
WHERE NOT EXISTS (
  SELECT 1 FROM user_app_info WHERE hty_id = 'pending-user' AND app_id = 'demo-app'
);

INSERT INTO user_app_info (id, hty_id, app_id, username, password, is_registered, created_at)
SELECT gen_random_uuid()::text, 'pending-user', 'pending-app', 'pending-demo2', 'demo123', false, now()
WHERE NOT EXISTS (
  SELECT 1 FROM user_app_info WHERE hty_id = 'pending-user' AND app_id = 'pending-app'
);
