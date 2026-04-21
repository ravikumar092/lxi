/**
 * Lex Tigress — One-Time User Seed Script
 *
 * Run ONCE after creating the Supabase project to create all existing users
 * with their current passwords. Uses the service_role key (admin).
 *
 * Usage:
 *   npx tsx scripts/seedUsers.ts
 *
 * Required env vars in .env (add temporarily, remove after use):
 *   SUPABASE_URL=https://xxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ...   <-- from Supabase dashboard > Settings > API
 *
 * WARNING: Never commit the service_role key. Delete it from .env after use.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL           = process.env.SUPABASE_URL           || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE  = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env before running this script.');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const USERS = [
  { email: 'admin@lextgress.com',   password: 'LexTgress@2026', name: 'Admin',         role: 'Advocate', searchLimit: null },
  { email: 'paari@lextgress.com',   password: 'Paari@2026',     name: 'Paari Vendhan', role: 'Advocate', searchLimit: null },
  { email: 'demo@lextgress.com',    password: 'Demo@2026',       name: 'Demo User',     role: 'Advocate', searchLimit: null },
  { email: 'demo1@lextgress.com',   password: 'Demo@123', name: 'Demo User 1',  role: 'Advocate', searchLimit: 50 },
  { email: 'demo2@lextgress.com',   password: 'Demo@123', name: 'Demo User 2',  role: 'Advocate', searchLimit: 50 },
  { email: 'demo3@lextgress.com',   password: 'Demo@123', name: 'Demo User 3',  role: 'Advocate', searchLimit: 50 },
  { email: 'demo4@lextgress.com',   password: 'Demo@123', name: 'Demo User 4',  role: 'Advocate', searchLimit: 50 },
  { email: 'demo5@lextgress.com',   password: 'Demo@123', name: 'Demo User 5',  role: 'Advocate', searchLimit: 50 },
  { email: 'demo6@lextgress.com',   password: 'Demo@123', name: 'Demo User 6',  role: 'Advocate', searchLimit: 50 },
  { email: 'demo7@lextgress.com',   password: 'Demo@123', name: 'Demo User 7',  role: 'Advocate', searchLimit: 50 },
  { email: 'demo8@lextgress.com',   password: 'Demo@123', name: 'Demo User 8',  role: 'Advocate', searchLimit: 50 },
  { email: 'demo9@lextgress.com',   password: 'Demo@123', name: 'Demo User 9',  role: 'Advocate', searchLimit: 50 },
  { email: 'demo10@lextgress.com',  password: 'Demo@123', name: 'Demo User 10', role: 'Advocate', searchLimit: 50 },
];

async function main() {
  console.log(`Creating ${USERS.length} users in Supabase Auth…\n`);

  for (const u of USERS) {
    let userId: string | undefined;

    const { data, error } = await admin.auth.admin.createUser({
      email:         u.email,
      password:      u.password,
      email_confirm: true,  // skip email verification
      user_metadata: { display_name: u.name, role: u.role },
    });

    if (error) {
      if (error.message?.includes('already')) {
        // User exists — look up their ID so we can still upsert the profile
        const { data: existing } = await admin.auth.admin.listUsers();
        userId = existing?.users?.find(x => x.email === u.email)?.id;
        console.log(`  ⚠️  ${u.email} — already exists, updating profile`);
      } else {
        console.error(`  ❌  ${u.email} — ${error.message}`);
        continue;
      }
    } else {
      userId = data.user?.id;
      console.log(`  ✅  ${u.email} created (id: ${userId})`);
    }

    if (!userId) continue;

    // Upsert user_profiles with display_name, role, and search_limit
    const { error: profileError } = await admin
      .from('user_profiles')
      .upsert({
        id:           userId,
        email:        u.email,
        display_name: u.name,
        role:         u.role,
        search_limit: u.searchLimit,
      }, { onConflict: 'id' });

    if (profileError) {
      console.error(`  ❌  ${u.email} profile upsert failed — ${profileError.message}`);
    } else {
      console.log(`     profile set: search_limit=${u.searchLimit ?? 'unlimited'}`);
    }
  }

  console.log('\nDone. Remove SUPABASE_SERVICE_ROLE_KEY from .env now.');
}

main().catch(console.error);
