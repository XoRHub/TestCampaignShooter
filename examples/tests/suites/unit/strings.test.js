// Fake generic-node test with an intentional failure — useful to demo
// failed runs, targeted retry and run diffs.
const { mkdirSync, writeFileSync } = require('node:fs');

const shouldFail = process.env.FORCE_PASS !== 'true';
const body = shouldFail
  ? '<testcase name="uppercases" classname="strings" time="0.01"><failure message="expected HELLO got HeLLo"/></testcase>'
  : '<testcase name="uppercases" classname="strings" time="0.01"/>';

mkdirSync('results', { recursive: true });
writeFileSync(
  'results/junit.xml',
  `<?xml version="1.0"?><testsuite name="strings" tests="1" failures="${shouldFail ? 1 : 0}">${body}</testsuite>`,
);
console.log(shouldFail ? 'strings: intentional failure (set FORCE_PASS=true to fix)' : 'strings: passed');
process.exit(shouldFail ? 1 : 0);
