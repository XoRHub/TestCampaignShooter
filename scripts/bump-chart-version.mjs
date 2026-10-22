#!/usr/bin/env node
// Bumps deploy/helm/testcampaignshooter/Chart.yaml's version + appVersion
// together with the unified semver semantic-release computes for the
// GitLab pipeline (see .releaserc.json — the "prepare" step, via
// @semantic-release/exec). Preserves the `# x-release-please-version`
// marker comment on the appVersion line: it's read by the (dormant, since
// this repo's remote is GitLab, not GitHub) release-please-based GitHub
// workflow, kept in sync in case this repo is ever mirrored there too.
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!version) {
  console.error('Usage: bump-chart-version.mjs <version>');
  process.exit(1);
}

const path = 'deploy/helm/testcampaignshooter/Chart.yaml';
let content = readFileSync(path, 'utf8');
content = content.replace(/^(version:\s*).*$/m, `$1${version}`);
content = content.replace(/^(appVersion:\s*)'[^']*'(.*)$/m, `$1'${version}'$2`);
writeFileSync(path, content);
console.log(`Bumped ${path} to ${version}`);
