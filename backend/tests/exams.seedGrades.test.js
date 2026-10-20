import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gradeForPercentage, percentage } from '../src/utils/grading.js';

/**
 * Audit (student/parent #2): dashboards showed the seed's own "A"/"B"/"C"
 * labels (91 -> A, 71 -> C) while the report card used the CBSE A1..E scale for
 * the same marks. The seed now labels marks through utils/grading.js.
 */
const seed = readFileSync(fileURLToPath(new URL('../src/seed/seed_school_data.js', import.meta.url)), 'utf8');

it('the seed labels marks with gradeForPercentage, not its own letters', () => {
  expect(seed).toMatch(/import \{ gradeForPercentage, percentage \} from '\.\.\/utils\/grading\.js'/);
  expect(seed).not.toMatch(/gradeLabel\s*=\s*'[ABC]'/);
  expect(seed).not.toMatch(/gradeLabel:\s*marks\s*>=/);
  expect(seed.match(/gradeForPercentage\(percentage\(marks, (100|50)\)\)/g)).toHaveLength(2);
});

it('the labels it produces are the report card scale', () => {
  expect(gradeForPercentage(percentage(91, 100)).label).toBe('A1');
  expect(gradeForPercentage(percentage(71, 100)).label).toBe('B1');
  expect(gradeForPercentage(percentage(38, 50)).label).toBe('B1');
});
