-- Run this in Supabase Dashboard → SQL Editor
-- Sets search_limit = 50 for demo1@lextgress.com through demo10@lextgress.com
-- Adds the column if it doesn't exist yet.

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS search_limit INTEGER DEFAULT NULL;

UPDATE user_profiles
SET search_limit = 50
WHERE id IN (
  SELECT id FROM auth.users
  WHERE email IN (
    'demo1@lextgress.com',
    'demo2@lextgress.com',
    'demo3@lextgress.com',
    'demo4@lextgress.com',
    'demo5@lextgress.com',
    'demo6@lextgress.com',
    'demo7@lextgress.com',
    'demo8@lextgress.com',
    'demo9@lextgress.com',
    'demo10@lextgress.com'
  )
);

-- Verify
SELECT u.email, p.search_limit
FROM user_profiles p
JOIN auth.users u ON u.id = p.id
WHERE u.email LIKE 'demo%@lextgress.com'
ORDER BY u.email;
