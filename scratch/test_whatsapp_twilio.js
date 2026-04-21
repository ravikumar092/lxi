import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3001';

// Test configuration - Update these values for your testing
const TEST_CONFIG = {
  // Use a test WhatsApp number (Twilio sandbox or your verified number)
  whatsappTo: 'whatsapp:+919566652806', // Replace with your test number
  teamId: 'test-team-id', // Replace with a valid team ID from your database
  clientId: 'test-client-id', // Replace with a valid client ID from your database
  caseId: 'test-case-id', // Replace with a valid case ID from your database
};

// ANSI color codes for better output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'cyan');
  console.log('='.repeat(60));
}

function logTest(name, passed, details = '') {
  const status = passed ? '✓ PASS' : '✗ FAIL';
  const color = passed ? 'green' : 'red';
  log(`${status}: ${name}`, color);
  if (details) {
    console.log(`  ${details}`);
  }
}

// Test 1: Health Check
async function testHealthCheck() {
  logSection('Test 1: Health Check');
  
  try {
    const res = await fetch(`${BASE_URL}/health`);
    const data = await res.json();
    
    log('Health Check Response:', 'blue');
    console.log(JSON.stringify(data, null, 2));
    
    const hasTwilio = data.twilio && data.twilio.includes('configured');
    logTest('Twilio client is configured', hasTwilio, data.twilio);
    
    return hasTwilio;
  } catch (err) {
    logTest('Health Check', false, err.message);
    return false;
  }
}

// Test 2: Send WhatsApp Message (Free Text)
async function testSendWhatsAppFreeText() {
  logSection('Test 2: Send WhatsApp Message (Free Text)');
  
  try {
    const payload = {
      caseId: TEST_CONFIG.caseId,
      clientId: TEST_CONFIG.clientId,
      teamId: TEST_CONFIG.teamId,
      channel: 'whatsapp',
      content: 'Test message from WhatsApp Twilio integration test',
      eventType: 'test_message',
      whatsappTo: TEST_CONFIG.whatsappTo,
    };
    
    log('Request Payload:', 'blue');
    console.log(JSON.stringify(payload, null, 2));
    
    const res = await fetch(`${BASE_URL}/api/communication/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    const data = await res.json();
    
    log('Response:', 'blue');
    console.log(JSON.stringify(data, null, 2));
    
    const success = data.success && data.twilio_sid;
    logTest('WhatsApp message sent successfully', success, 
      success ? `Message SID: ${data.twilio_sid}` : 'No message SID returned');
    
    return success;
  } catch (err) {
    logTest('Send WhatsApp Message', false, err.message);
    return false;
  }
}

// Test 3: Send WhatsApp Message with Content Template
async function testSendWhatsAppTemplate() {
  logSection('Test 3: Send WhatsApp Message (Content Template)');
  
  try {
    const payload = {
      caseId: TEST_CONFIG.caseId,
      clientId: TEST_CONFIG.clientId,
      teamId: TEST_CONFIG.teamId,
      channel: 'whatsapp',
      content: 'Test template message',
      eventType: 'hearing_update',
      whatsappTo: TEST_CONFIG.whatsappTo,
      contentVariables: {
        '1': '12/1/2026',
        '2': '3:00 PM',
        '3': 'Court Room 5',
      },
    };
    
    log('Request Payload:', 'blue');
    console.log(JSON.stringify(payload, null, 2));
    
    const res = await fetch(`${BASE_URL}/api/communication/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    const data = await res.json();
    
    log('Response:', 'blue');
    console.log(JSON.stringify(data, null, 2));
    
    const success = data.success && data.twilio_sid;
    logTest('WhatsApp template message sent successfully', success,
      success ? `Message SID: ${data.twilio_sid}` : 'No message SID returned');
    
    return success;
  } catch (err) {
    logTest('Send WhatsApp Template Message', false, err.message);
    return false;
  }
}

// Test 4: Send WhatsApp Message without Twilio Client (Fallback)
async function testSendWhatsAppFallback() {
  logSection('Test 4: Send WhatsApp Message (Fallback - No Twilio Client)');
  
  try {
    const payload = {
      caseId: TEST_CONFIG.caseId,
      clientId: TEST_CONFIG.clientId,
      teamId: TEST_CONFIG.teamId,
      channel: 'whatsapp',
      content: 'Test fallback message',
      eventType: 'test_fallback',
      whatsappTo: TEST_CONFIG.whatsappTo,
    };
    
    log('Request Payload:', 'blue');
    console.log(JSON.stringify(payload, null, 2));
    
    const res = await fetch(`${BASE_URL}/api/communication/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    const data = await res.json();
    
    log('Response:', 'blue');
    console.log(JSON.stringify(data, null, 2));
    
    // Even without Twilio, it should log to DB
    const success = data.message && data.message.id;
    logTest('Message logged to database (fallback)', success,
      success ? `DB Record ID: ${data.message.id}` : 'No DB record created');
    
    return success;
  } catch (err) {
    logTest('Send WhatsApp Fallback', false, err.message);
    return false;
  }
}

// Test 5: WhatsApp Webhook (Incoming Message)
async function testWhatsAppWebhook() {
  logSection('Test 5: WhatsApp Webhook (Incoming Message)');
  
  try {
    const payload = {
      From: 'whatsapp:+919566652806', // Test phone number
      Body: 'Test incoming message from webhook',
      MessageSid: 'SMtest123456789',
    };
    
    log('Webhook Payload:', 'blue');
    console.log(JSON.stringify(payload, null, 2));
    
    const res = await fetch(`${BASE_URL}/api/communication/webhook/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    // Webhook should return 200 even for unidentified senders
    const success = res.status === 200;
    logTest('Webhook endpoint responds correctly', success,
      `Status: ${res.status}`);
    
    return success;
  } catch (err) {
    logTest('WhatsApp Webhook', false, err.message);
    return false;
  }
}

// Test 6: Send Email (Alternative Channel)
async function testSendEmail() {
  logSection('Test 6: Send Email (Alternative Channel)');
  
  try {
    const payload = {
      caseId: TEST_CONFIG.caseId,
      clientId: TEST_CONFIG.clientId,
      teamId: TEST_CONFIG.teamId,
      channel: 'email',
      content: 'Test email message',
      eventType: 'test_email',
    };
    
    log('Request Payload:', 'blue');
    console.log(JSON.stringify(payload, null, 2));
    
    const res = await fetch(`${BASE_URL}/api/communication/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    const data = await res.json();
    
    log('Response:', 'blue');
    console.log(JSON.stringify(data, null, 2));
    
    // Email should be logged to DB even if not sent
    const success = data.message && data.message.id;
    logTest('Email logged to database', success,
      success ? `DB Record ID: ${data.message.id}` : 'No DB record created');
    
    return success;
  } catch (err) {
    logTest('Send Email', false, err.message);
    return false;
  }
}

// Test 7: Error Handling - Missing Required Fields
async function testErrorHandling() {
  logSection('Test 7: Error Handling - Missing Required Fields');
  
  try {
    const payload = {
      // Missing teamId
      channel: 'whatsapp',
      content: 'Test message',
    };
    
    log('Request Payload (missing teamId):', 'blue');
    console.log(JSON.stringify(payload, null, 2));
    
    const res = await fetch(`${BASE_URL}/api/communication/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    const data = await res.json();
    
    log('Response:', 'blue');
    console.log(JSON.stringify(data, null, 2));
    
    // Should handle gracefully (no teamId = no DB log, but no crash)
    const success = res.status < 500; // Should not be a server error
    logTest('Handles missing fields gracefully', success,
      `Status: ${res.status}`);
    
    return success;
  } catch (err) {
    logTest('Error Handling', false, err.message);
    return false;
  }
}

// Main test runner
async function runAllTests() {
  log('\n' + '█'.repeat(60));
  log('  WhatsApp Twilio Integration Test Suite', 'cyan');
  log('█'.repeat(60));
  
  const results = {
    healthCheck: await testHealthCheck(),
    sendFreeText: await testSendWhatsAppFreeText(),
    sendTemplate: await testSendWhatsAppTemplate(),
    sendFallback: await testSendWhatsAppFallback(),
    webhook: await testWhatsAppWebhook(),
    sendEmail: await testSendEmail(),
    errorHandling: await testErrorHandling(),
  };
  
  // Summary
  logSection('Test Summary');
  
  const totalTests = Object.keys(results).length;
  const passedTests = Object.values(results).filter(r => r).length;
  const failedTests = totalTests - passedTests;
  
  log(`Total Tests: ${totalTests}`, 'blue');
  log(`Passed: ${passedTests}`, 'green');
  log(`Failed: ${failedTests}`, failedTests > 0 ? 'red' : 'green');
  
  console.log('\n' + '='.repeat(60));
  
  if (failedTests === 0) {
    log('✓ All tests passed!', 'green');
  } else {
    log('✗ Some tests failed. Please review the output above.', 'yellow');
  }
  
  console.log('='.repeat(60) + '\n');
  
  process.exit(failedTests > 0 ? 1 : 0);
}

// Run tests
runAllTests().catch(err => {
  log(`Fatal error: ${err.message}`, 'red');
  console.error(err);
  process.exit(1);
});
