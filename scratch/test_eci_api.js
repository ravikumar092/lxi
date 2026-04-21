import fetch from 'node-fetch';
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const TOKEN = process.env.ECOURTS_MCP_TOKEN;

async function testSearchVariant(path) {
  const url = `https://webapi.ecourtsindia.com${path}?advocates=Mukesh+Kumar&state=SC`;
  console.log('Testing Path:', url);
  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(`Path ${path} Status:`, res.status);
    const data = await res.json();
    console.log(`Path ${path} Response:`, JSON.stringify(data).substring(0, 200));
  } catch (err) {
    console.log(`Path ${path} Failed`);
  }
}

async function testCNR() {
  const cnr = 'SCIN010299832023';
  const url = `https://webapi.ecourtsindia.com/api/partner/case/${cnr}`;
  console.log('Testing CNR URL:', url);
  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('CNR Status:', res.status);
    const data = await res.json();
    console.log('CNR Response:', JSON.stringify(data, null, 2).substring(0, 500) + '...');
  } catch (err) {
    console.error('CNR Test failed:', err.message);
  }
}

async function run() {
  console.log('Token starts with:', TOKEN ? TOKEN.substring(0, 5) : 'MISSING');
  await testSearch();
  await testCNR();
}

run();
