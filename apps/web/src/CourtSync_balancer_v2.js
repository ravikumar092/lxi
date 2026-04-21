import fs from 'fs';

const content = fs.readFileSync('d:\\Projects\\MVP\\apps\\web\\src\\CourtSync.tsx', 'utf8');

const tags = [];
const lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Tag matches: div, AppContext.Provider, Fragment, and brace-blocks
    const tagMatches = line.matchAll(/<(div|AppContext\.Provider)|<\/(div|AppContext\.Provider)|<>|<\/>|{[^{}]*\(/g);
    
    for (const match of tagMatches) {
        const text = match[0];
        
        if (text === '<div' || text === '<AppContext.Provider' || text === '<>') {
            // Self closing check
            if (!line.includes('/>', match.index)) {
                tags.push({ name: text.replace('<', ''), line: i + 1 });
            }
        } else if (text === '</div' || text === '</AppContext.Provider' || text === '</>') {
            const tagName = text.replace('</', '');
            if (tags.length === 0) {
                console.log(`EXTRA CLOSE TAG: ${tagName} at line ${i + 1}`);
            } else {
                const last = tags.pop();
                if (last.name !== tagName) {
                    console.log(`MISMATCH: Open ${last.name} (line ${last.line}) closed by ${tagName} (line ${i + 1})`);
                }
            }
        } else if (text.startsWith('{')) {
             tags.push({ name: 'BLOCK', line: i + 1 });
        }
        // Very simplistic block handling (can't easily match )} across lines here)
    }
    
    // Check for )} on this line
    if (line.includes(')}')) {
        if (tags.length > 0 && tags[tags.length-1].name === 'BLOCK') {
            tags.pop();
        } else {
            console.log(`EXTRA CLOSE BLOCK: line ${i + 1}`);
        }
    }
}

console.log(`Remaining open tags:`, tags.length);
tags.forEach(t => console.log(`- ${t.name} (line ${t.line})`));
