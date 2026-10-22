// Fake generic-node test: runs assertions and writes its own JUnit report.
const { mkdirSync, writeFileSync } = require('node:fs');

const cases = [
  { name: 'adds numbers', fn: () => { if (1 + 1 !== 2) throw new Error('math is broken'); } },
  { name: 'multiplies numbers', fn: () => { if (6 * 7 !== 42) throw new Error('math is broken'); } },
];

let failures = 0;
const results = cases.map((testCase) => {
  const start = Date.now();
  try {
    testCase.fn();
    return `<testcase name="${testCase.name}" classname="math" time="${(Date.now() - start) / 1000}"/>`;
  } catch (err) {
    failures += 1;
    return `<testcase name="${testCase.name}" classname="math" time="${(Date.now() - start) / 1000}"><failure message="${err.message}"/></testcase>`;
  }
});

mkdirSync('results', { recursive: true });
writeFileSync(
  'results/junit.xml',
  `<?xml version="1.0"?><testsuite name="math" tests="${cases.length}" failures="${failures}">${results.join('')}</testsuite>`,
);
console.log(`math: ${cases.length - failures}/${cases.length} passed`);
process.exit(failures > 0 ? 1 : 0);
