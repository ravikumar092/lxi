import fetch from 'node-fetch';

// Test configuration
let TEST_CONFIG = {
  teamId: null,
  clientId: null,
  caseId: null,
};

function log(message, color = 'reset') {
  console.log(`[Test] ${message}`);
}

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function setupTestData() {
  log('Setting up Test Data...');
  // 1. Create a dummy team
  const { data: user } = await supabase.auth.admin?.createUser({ email: 'test_admin@test.com', password: 'password', email_confirm: true }) || { data: { user: { id: 'acb423ca-dbcf-4ab2-9f22-d04b6b15ef27' } } };
  const adminId = user?.user?.id || 'acb423ca-dbcf-4ab2-9f22-d04b6b15ef27';

  const { data: team, error: teamErr } = await supabase.from('teams').insert({ name: 'Test Team', admin_user_id: adminId }).select('id').single();
  if (teamErr) log(`Team Insert Error: ${teamErr.message}`);
  TEST_CONFIG.teamId = team?.id;

  // 2. Create a dummy client
  const { data: client, error: clientErr } = await supabase.from('clients').insert({ team_id: TEST_CONFIG.teamId, name: 'Test Client', whatsapp_number: '+919566652806' }).select('id').single();
  if (clientErr) log(`Client Insert Error: ${clientErr.message}`);
  TEST_CONFIG.clientId = client?.id;

  // 3. Create a dummy case
  const { data: caseObj, error: caseErr } = await supabase.from('cases').insert({ team_id: TEST_CONFIG.teamId, client_id: TEST_CONFIG.clientId, diary_no: '1234', diary_year: '2026', case_number: 'TEST/CASE' }).select('id').single();
  if (caseErr) log(`Case Insert Error: ${caseErr.message}`);
  TEST_CONFIG.caseId = caseObj?.id;

  log(`Test data setup complete. Client ID: ${TEST_CONFIG.clientId}`);
}

async function testMissingDocNotification() {
  log('Starting Missing Document Notification Test without explicit phone number');
  
  try {
    const payload = {
      caseId: TEST_CONFIG.caseId,
      clientId: TEST_CONFIG.clientId,
      teamId: TEST_CONFIG.teamId,
      channel: 'whatsapp',
      content: 'Dear Client, this is a test notification for a missing document. Please ignore.',
      eventType: 'missing_doc',
      // Notice: whatsappTo is INTENTIONALLY left out here to test the lookup logic
    };
    
    log('Request Payload:');
    console.log(JSON.stringify(payload, null, 2));
    
    const res = await fetch(`${BASE_URL}/api/communication/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    const data = await res.json();
    
    log('Response:');
    console.log(JSON.stringify(data, null, 2));
    
    const success = data.success && data.twilio_sid;
    if (success) {
        log(`✓ SUCCESS: Message sent. Message SID: ${data.twilio_sid}`);
    } else {
        log(`✗ FAILED: Message not sent.`);
    }
  } catch (err) {
    log(`✗ FAILED with error: ${err.message}`);
  }
}

async function run() {
  await setupTestData();
  if (!TEST_CONFIG.clientId) {
    log('Failed to create test data, aborting.');
    return;
  }
  await testMissingDocNotification();
}

run();
