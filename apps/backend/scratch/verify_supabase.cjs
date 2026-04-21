const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verify() {
  console.log('🔍 Starting Supabase verification...');

  // 1. Verify 'notes' table schema by attempting a dry-run insert
  console.log('\n--- Checking "notes" table columns ---');
  const testId = '00000000-0000-0000-0000-000000000000';
  const { error: insertError } = await supabase
    .from('notes')
    .insert({
      id: testId,
      title: 'Schema Test',
      content: 'Testing columns',
      category: 'Strategy',
      audio_url: 'http://test.com',
      duration: 10,
      is_ai_processed: true,
      extracted_tasks: [],
      linked_case_ids: [],
      source: 'app',
      team_id: testId, // Using dummy UUID
      created_by: testId
    });

  if (insertError) {
    if (insertError.message.includes('column')) {
      console.log('❌ Column missing:', insertError.message);
    } else {
      // It might fail due to FK constraints or other things, but if it doesn't complain about COLUMNS, then they exist.
      console.log('ℹ️ Insert attempt result (ignoring non-schema errors):', insertError.message);
      if (!insertError.message.includes('column')) {
        console.log('✅ Required columns appear to exist (did not throw "column not found").');
      }
    }
  } else {
    console.log('✅ All columns verified through successful (test) insertion!');
    // Clean up
    await supabase.from('notes').delete().eq('id', testId);
  }

  // 2. Verify 'voice-notes' bucket
  console.log('\n--- Checking "voice-notes" bucket ---');
  const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();

  if (bucketError) {
    console.error('❌ Error listing buckets:', bucketError.message);
  } else {
    console.log('   Available buckets:', buckets.map(b => b.name).join(', ') || 'None');
    const bucket = buckets.find(b => b.name === 'voice-notes');
    if (bucket) {
      console.log('✅ Bucket "voice-notes" found!');
      console.log('   Public:', bucket.public ? 'YES' : '❌ NO (Must be public)');
    } else {
      console.log('❌ Bucket "voice-notes" NOT found.');
    }
  }

  console.log('\n🏁 Verification finished.');
}

verify();
