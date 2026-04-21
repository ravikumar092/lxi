import fs from 'fs';

const content = fs.readFileSync('d:\\Projects\\MVP\\apps\\web\\src\\CourtSync.tsx', 'utf8');

const tags = [];
const lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Simplistic tag extractor
    const res = line.matchAll(/<(div|AppContext\.Provider)|<\/ (div|AppContext\.Provider)>/g);
    // Wait, better regex
    const matches = line.matchAll(/<(div|AppContext\.Provider)(?:\s|>)|<\/ (div|AppContext\.Provider)>/g);
    
    // Oh wait, just use a proper stack
    const tagMatches = line.matchAll(/<(div|AppContext\.Provider)|<\/(div|AppContext\.Provider)/g);
    for (const match of tagMatches) {
        const tagName = match[1] || match[2];
        const isClose = match[0].startsWith('</');
        
        if (isClose) {
            if (tags.length === 0) {
                console.log(`EXTRA CLOSE TAG: ${tagName} at line ${i + 1}`);
            } else {
                const last = tags.pop();
                if (last.name !== tagName) {
                    console.log(`MISMATCH: Open ${last.name} (line ${last.line}) closed by ${tagName} (line ${i + 1})`);
                }
            }
        } else {
            // Check if it's self-closing (simplistic)
            if (!match[0].includes('/>') && !line.includes('/>', match.index)) {
                 tags.push({ name: tagName, line: i + 1 });
            }
        }
    }
}

console.log(`Remaining open tags:`, tags.length);
tags.forEach(t => console.log(`- ${t.name} (line ${t.line})`));
