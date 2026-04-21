const http = require('http');

const ports = [5000, 3000, 3001, 8080, 5001];

const payload = JSON.stringify({
  bundleId: "testing123",
  bundleType: "court",
  documentList: [
    { position: 0, documentName: "Index of documents with page numbers for MA filing", isPlaceholder: true },
    { position: 1, documentName: "Vakalatnama signed by Rajasthan State Road Transport Corporation in favour of\rAOR", isPlaceholder: true },
    { position: 2, documentName: "MA Petition (typed and printed) for Diary No. 12304/2025", isPlaceholder: true },
    { position: 3, documentName: "Affidavit in support of MA petition", isPlaceholder: true },
    { position: 4, documentName: "All annexures referred to in the MA petition (supporting documents, lower court\r\norders, etc.)", isPlaceholder: true },
    { position: 5, documentName: "Certified copy of impugned order passed against Rajasthan State Road Transport\rCorporation", isPlaceholder: true },
    { position: 6, documentName: "Court fees (requisite stamp/fee for MA filing)", isPlaceholder: true },
    { position: 7, documentName: "Memo of parties with complete addresses of Rajasthan State Road Transport\r\nCorporation and Norati Devi", isPlaceholder: true },
    { position: 8, documentName: "SLP- Chandrashekhar Filed", isPlaceholder: true }
  ]
});

async function tryPort(port) {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://localhost:${port}/api/generate-bundle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ port, status: res.statusCode, data }));
    });
    
    req.on('error', (e) => reject(e));
    req.write(payload);
    req.end();
  });
}

async function run() {
  for (const port of ports) {
    try {
      console.log(`Trying port ${port}...`);
      const res = await tryPort(port);
      if (res.status === 200) {
        console.log(`Success on port ${port}!`);
        const parsed = JSON.parse(res.data);
        if (parsed.downloadUrl) {
          const fs = require('fs');
          const base64Data = parsed.downloadUrl.split(',')[1];
          fs.writeFileSync('test_output.pdf', Buffer.from(base64Data, 'base64'));
          console.log('Saved test_output.pdf');
        } else {
          console.log('No downloadUrl found:', res.data);
        }
        return;
      }
    } catch (e) {
      // ignore connection refused
    }
  }
  console.log('Could not connect on any standard port.');
}

run();
