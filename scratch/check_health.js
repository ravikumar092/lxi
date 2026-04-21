import fetch from 'node-fetch';

async function check() {
  try {
    const res = await fetch('http://localhost:3001/health');
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Fetch failed:', err.message);
  }
}

check();
