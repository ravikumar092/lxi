import fetch from 'node-fetch';
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const TOKEN = process.env.ECOURTS_MCP_TOKEN;

async function testApiDomain() {
  const url = 'https://api.ecourtsindia.com/api/partner/search?advocates=Mukesh+Kumar&state=SC';
  console.log('Testing Domain API:', url);
  
  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('Status:', res.status);
    const text = await res.text();
    console.log('Response Snippet:', text.substring(0, 500));
  } catch (err) {
    console.error('API Domain Test failed:', err.message);
  }
}

testApiDomain();
