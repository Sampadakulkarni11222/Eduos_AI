import { describe, it, expect } from 'vitest';
import { fileHref } from '@/lib/api';

/**
 * fileHref() is the one place every attachment, submission and course-material
 * link in the portal passes through before it becomes an `<a href>`. Those
 * values are typed by other users, and React 18 renders a `javascript:` href
 * as-is, so this is where a scripted link has to stop.
 */
describe('fileHref', () => {
  it('serves our own upload paths from the API origin', () => {
    expect(fileHref('/uploads/abc-notes.pdf')).toMatch(/^https?:\/\/[^/]+\/uploads\/abc-notes\.pdf$/);
  });

  it('passes http(s) links through unchanged', () => {
    expect(fileHref('https://example.com/lesson')).toBe('https://example.com/lesson');
    expect(fileHref('http://example.com/a')).toBe('http://example.com/a');
  });

  it.each([
    'javascript:alert(document.cookie)',
    ' JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '//evil.example.com/x',
  ])('neutralises %s', (value) => {
    expect(fileHref(value)).toBe('#');
  });

  it('returns # for an empty value', () => {
    expect(fileHref('')).toBe('#');
  });
});
