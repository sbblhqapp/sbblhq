/**
 * Canonical-font drift guard.
 *
 * The SBBL brand system uses ONE typeface: Space Grotesk. This test fails if
 * any reference to 'Bebas Neue' (or any other display font previously used)
 * is reintroduced to the repo. It is the proactive complement to the visual
 * brand spec — even if a PR description claims brand compliance, this test
 * blocks the merge when drift appears.
 *
 * HOW TO FIX A FAILURE
 *   Replace the forbidden font reference with 'Space Grotesk'. For numeric /
 *   monospace display, use: "'Space Grotesk', ui-monospace, monospace".
 *   For headings, the body default cascade is sufficient.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..');

const SCAN_DIRS = ['src', 'docs', 'ops', 'public', 'scripts', 'supabase'];
const SCAN_FILES = ['index.html', 'tailwind.config.ts', 'README.md', 'CLAUDE.md'];
const IGNORE_DIRS = new Set(['node_modules', 'dist', '.git', 'build', 'coverage', '.next']);
const IGNORE_FILES = new Set(['canonical-font-guard.test.ts']);

const FORBIDDEN = [
  /bebas\s*neue/i,
  /family=Bebas\+Neue/i,
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry) || IGNORE_FILES.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
    } else if (st.isFile()) {
      out.push(full);
    }
  }
  return out;
}

describe('canonical font guard', () => {
  it('does not contain any reference to Bebas Neue', () => {
    const files: string[] = [];
    for (const d of SCAN_DIRS) {
      files.push(...walk(join(REPO_ROOT, d)));
    }
    for (const f of SCAN_FILES) {
      try {
        if (statSync(join(REPO_ROOT, f)).isFile()) files.push(join(REPO_ROOT, f));
      } catch {
        /* file absent — skip */
      }
    }

    const violations: string[] = [];
    for (const path of files) {
      if (!/\.(tsx?|jsx?|mjs|cjs|css|scss|html|md|json|yml|yaml|sql|svg|sh)$/i.test(path)) {
        continue;
      }
      let text: string;
      try {
        text = readFileSync(path, 'utf8');
      } catch {
        continue;
      }
      for (const pattern of FORBIDDEN) {
        if (pattern.test(text)) {
          violations.push(`${relative(REPO_ROOT, path)} — matches ${pattern}`);
          break;
        }
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  }, 30000);
});
