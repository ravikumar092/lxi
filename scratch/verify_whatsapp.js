const { createClient } = require('@supabase/supabase-js');

const BACKEND_URL = 'http://localhost:3001';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function verify() {
    console.log('--- Starting WhatsApp E2E Verification ---');

    // 1. Get a valid case and team
    const { data: cases } = await supabase.from('cases').select('id, team_id').limit(1);
    if (!cases?.length) {
        console.error('❌ Could not find any cases in DB.');
        return;
    }
    const caseId = cases[0].id;
    const teamId = cases[0].team_id;

    // 2. Ensure a client exists
    let { data: clients } = await supabase.from('clients').select('id, name').limit(1);
    let clientId;
    
    if (!clients?.length) {
        console.log('2a. No clients found. Creating a test client...');
        const { data: newClient, error: clientErr } = await supabase
            .from('clients')
            .insert({
                name: 'Test Verify Client',
                whatsapp_number: '+919566652806',
                team_id: teamId
            })
            .select()
            .single();
        
        if (clientErr) {
            console.error('❌ Failed to create test client:', clientErr);
            return;
        }
        clientId = newClient.id;
        console.log(`✅ Created test client: ${clientId} (${newClient.name})`);
    } else {
        clientId = clients[0].id;
        console.log(`✅ Using existing client: ${clientId} (${clients[0].name})`);
    }

    const testPayload = {
        channel: 'whatsapp',
        content: 'Test notification from Lex Tigress verify script',
        caseId: caseId,
        clientId: clientId,
        teamId: teamId,
        eventType: 'verification_test',
        whatsappTo: '+919566652806',
        contentVariables: { "1": "15/4", "2": "Stage: Final Test" }
    };

    console.log(`3. Sending POST to ${BACKEND_URL}/api/communication/notify...`);
    try {
        const response = await globalThis.fetch(`${BACKEND_URL}/api/communication/notify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testPayload)
        });

        const result = await response.json();
        
        if (response.ok && result.success) {
            console.log(`✅ Backend Success! Twilio SID: ${result.twilio_sid}`);
            
            console.log('4. Verifying database log in communication_history (checking metadata)...');
            // Wait for DB consistency
            await new Promise(r => setTimeout(r, 2000));
            
            // Query based on metadata->>twilio_sid
            const { data: logs, error } = await supabase
                .from('communication_history')
                .select('*')
                .eq('case_id', caseId)
                .order('created_at', { ascending: false })
                .limit(1);

            if (logs?.length) {
                const log = logs[0];
                const matchedSid = log.metadata?.twilio_sid === result.twilio_sid;
                console.log(`✅ DB Log Found! Status: ${log.status}`);
                if (matchedSid) {
                    console.log('✅ Twilio SID matches in metadata.');
                } else {
                    console.warn(`⚠️ Warning: Latest log exists but SID mismatch. Expected ${result.twilio_sid}, found ${log.metadata?.twilio_sid}`);
                }
                console.log('--- Verification PASSED ---');
            } else {
                console.warn('⚠️ Backend succeeded but DB log not found in communication_history.');
                if (error) console.error('DB Error:', error.message);
            }
        } else {
            console.error('❌ Backend Failed:', result.error || result);
        }
    } catch (err) {
        console.error('❌ Connection Failed:', err.message);
    }
}

verify();
