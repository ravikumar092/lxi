import fetch from 'node-fetch';

async function testRender() {
  const renderUrl = 'https://mvp-0em4.onrender.com/ecourts-api/api/partner/search?advocates=Mukesh+Kumar&state=SC';
  console.log('Testing Render URL:', renderUrl);
  
  try {
    const res = await fetch(renderUrl);
    console.log('Status:', res.status);
    const data = await res.json();
    console.log('Response:', JSON.stringify(data).substring(0, 500));
  } catch (err) {
    console.error('Render test failed:', err.message);
  }
}

testRender();
