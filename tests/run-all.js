// Runs every engine test suite: node tests/run-all.js
const { execFileSync } = require('child_process');
const path = require('path');
let bad = 0;
for (const s of ['engine', 'hr', 'lease', 'rental', 'attendance']) {
  try { const out = execFileSync(process.execPath, [path.join(__dirname, s + '.test.js')], { encoding: 'utf8' }); console.log(s.padEnd(11) + out.trim().split('\n').pop()); }
  catch (e) { bad++; console.log(s.padEnd(11) + 'FAILED\n' + (e.stdout || e.message)); }
}
process.exitCode = bad ? 1 : 0;
