import { describe, it, expect } from 'vitest';
import { detectLanguage } from '@/lib/speech';

describe('detectLanguage', () => {
  it('detects English speech inputs correctly', () => {
    const res = detectLanguage('What is my attendance?');
    expect(res.lang).toBe('en');
    expect(res.confident).toBe(false);
  });

  it('detects Devanagari Hindi speech inputs correctly', () => {
    const res = detectLanguage('मेरी उपस्थिति कितनी है?');
    expect(res.lang).toBe('hi');
    expect(res.confident).toBe(true);
  });

  it('detects Hinglish (Romanised Hindi) speech inputs correctly', () => {
    const res1 = detectLanguage('Meri attendance kitni hai?');
    expect(res1.lang).toBe('hi');
    expect(res1.confident).toBe(true);
    expect(res1.romanised).toBe(true);

    const res2 = detectLanguage('Mera result batao');
    expect(res2.lang).toBe('hi');
    expect(res2.confident).toBe(true);
  });

  it('detects Bengali speech inputs correctly', () => {
    const res = detectLanguage('আমার উপস্থিতি কত?');
    expect(res.lang).toBe('bn');
    expect(res.confident).toBe(true);
  });

  it('detects Tamil speech inputs correctly', () => {
    const res = detectLanguage('என் வருகை என்ன?');
    expect(res.lang).toBe('ta');
    expect(res.confident).toBe(true);
  });

  it('detects Telugu speech inputs correctly', () => {
    const res = detectLanguage('నా హాజరు ఎంత?');
    expect(res.lang).toBe('te');
    expect(res.confident).toBe(true);
  });

  it('handles empty and whitespace input gracefully', () => {
    expect(detectLanguage('').lang).toBe('en');
    expect(detectLanguage('   ').lang).toBe('en');
    expect(detectLanguage(null as unknown as string).lang).toBe('en');
  });
});
