const fs = require('fs');
const src = fs.readFileSync('src/__tests__/stage5.6.unit.test.ts', 'utf8');
const lines = src.split('\n');

const itCalls = [];
lines.forEach((l, i) => {
  if (l.trim().startsWith('it(')) {
    const m = l.match(/it\("([^"]+)"/);
    if (m) itCalls.push({ line: i + 1, name: m[1] });
  }
});

console.log('Total it() calls:', itCalls.length);

const counts = {};
itCalls.forEach(x => { counts[x.name] = (counts[x.name] || 0) + 1; });
const dupes = Object.entries(counts).filter(([k, v]) => v > 1);
console.log('Duplicate it() names:', dupes.length);
dupes.forEach(([k, v]) => console.log('  x' + v + ':', k));

// Count unique test names
const unique = Object.keys(counts).length;
console.log('Unique test names:', unique);
console.log('Total (with dupes):', itCalls.length);
console.log('Duplicated tests contribute extra:', itCalls.length - unique);
