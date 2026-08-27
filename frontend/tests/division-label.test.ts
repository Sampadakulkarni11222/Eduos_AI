import { describe, it, expect } from 'vitest';
import { divisionLabel } from '@/components/ui';

/**
 * Section names are bare letters and every grade has an "A", so a section shown
 * on its own is ambiguous — which is what this exists to prevent.
 */
describe('divisionLabel', () => {
  it('combines grade and section', () => {
    expect(divisionLabel('Class 5', 'A')).toBe('Class 5 A');
    expect(divisionLabel('Class 10', 'B')).toBe('Class 10 B');
  });

  it('falls back to whichever part is present, with no stray separator', () => {
    expect(divisionLabel('Class 5', '')).toBe('Class 5');
    expect(divisionLabel('', 'A')).toBe('A');
    expect(divisionLabel(null, 'A')).toBe('A');
    expect(divisionLabel('Class 5', undefined)).toBe('Class 5');
  });

  it('renders an em dash when nothing is known', () => {
    expect(divisionLabel(null, null)).toBe('—');
    expect(divisionLabel('', '')).toBe('—');
    expect(divisionLabel(undefined, undefined)).toBe('—');
  });

  it('trims stray whitespace', () => {
    expect(divisionLabel('  Class 5  ', ' A ')).toBe('Class 5 A');
    expect(divisionLabel('   ', 'A')).toBe('A');
  });
});
