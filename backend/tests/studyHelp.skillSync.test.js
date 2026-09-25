import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SKILL_PROMPT, SKILL_NAME, SKILL_VERSION, SKILL_PROMPT_SHA256,
} from '../src/modules/ai/studyBuddy/skillPrompt.generated.js';

/**
 * The backend carries a generated copy of the Student Learning Buddy prompt,
 * because the production image cannot see ../ai-skills. This fails the moment
 * the copy and the source package disagree, in either direction — someone
 * edited the copy, or the package was updated and
 * `node scripts/sync-learning-buddy.mjs` was not re-run.
 */

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..', '..', 'ai-skills', 'Student_Learning_Buddy_Universal_Skill_v3');
const manifest = JSON.parse(readFileSync(join(pkg, 'MANIFEST.json'), 'utf8'));
const sourceBytes = readFileSync(join(pkg, 'UNIVERSAL_SYSTEM_PROMPT.txt'));
const sha = (b) => createHash('sha256').update(b).digest('hex');

describe('Student Learning Buddy prompt copy', () => {
  it('is byte-for-byte the package\'s UNIVERSAL_SYSTEM_PROMPT.txt', () => {
    expect(SKILL_PROMPT).toBe(sourceBytes.toString('utf8'));
    expect(sha(Buffer.from(SKILL_PROMPT, 'utf8'))).toBe(sha(sourceBytes));
  });

  it('matches the checksum the package manifest declares', () => {
    expect(SKILL_PROMPT_SHA256).toBe(manifest.files['UNIVERSAL_SYSTEM_PROMPT.txt'].sha256);
    expect(sha(Buffer.from(SKILL_PROMPT, 'utf8'))).toBe(manifest.files['UNIVERSAL_SYSTEM_PROMPT.txt'].sha256);
  });

  it('carries the package name and version', () => {
    expect(SKILL_NAME).toBe(manifest.name);
    expect(SKILL_VERSION).toBe(manifest.version);
  });

  it('preserves non-Latin scripts and typographic punctuation exactly', () => {
    // Characters that a careless copy (editor, heredoc, codepage) would mangle.
    for (const ch of ['“', '”', '—', '’']) expect(SKILL_PROMPT).toContain(ch);
    expect(SKILL_PROMPT).not.toContain('\uFFFD');
    expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(SKILL_PROMPT)).toBe(false);
  });

  it('is the self-contained universal prompt, not SKILL.md with file-navigation lines', () => {
    expect(SKILL_PROMPT).toContain('These instructions are self-contained.');
    expect(SKILL_PROMPT).not.toContain('Read references/answer-contract.md');
  });
});
