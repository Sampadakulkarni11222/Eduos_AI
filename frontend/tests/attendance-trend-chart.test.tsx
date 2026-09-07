import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttendanceTrendChart } from '@/components/attendance/attendance-trend-chart';
import type { AttendanceTrendPointDto } from '@/lib/types';

/**
 * The bug this chart had: bars were drawn in a viewBox exactly as tall as the
 * plot, with the value label placed above the bar. At 100% that label sits at a
 * negative y, outside the viewBox, and only `overflow: visible` kept it on
 * screen — spilling over the card and across the 75% reference line. The line
 * was also painted before the bars, so every month above the threshold covered
 * the one mark the chart exists to show.
 *
 * These assertions are about geometry, because that is what was wrong. They
 * check the SVG's own numbers rather than a screenshot, so they keep holding
 * whatever the chart is styled to look like.
 */

const point = (month: string, pct: number, workingDays = 20): AttendanceTrendPointDto => ({
  month, pctPresent: pct, presentDays: Math.round((pct / 100) * workingDays), workingDays,
});

function renderChart(points: AttendanceTrendPointDto[]) {
  const { container } = render(<AttendanceTrendChart points={points} />);
  const svg = container.querySelector('svg')!;
  const [, , viewW, viewH] = svg.getAttribute('viewBox')!.split(' ').map(Number);
  return { container, svg, viewW, viewH };
}

/** Bars only — the transparent full-column hit areas are excluded. */
function bars(container: HTMLElement) {
  return Array.from(container.querySelectorAll('rect')).filter((r) => r.getAttribute('fill') !== 'transparent');
}

describe('AttendanceTrendChart', () => {
  it('says so plainly when there is no history rather than drawing an empty axis', () => {
    render(<AttendanceTrendChart points={[point('2026-04', 0, 0)]} />);
    expect(screen.getByText(/No attendance history yet/i)).toBeInTheDocument();
  });

  it('keeps a full-height bar inside the plot area', () => {
    const { container, viewH } = renderChart([point('2026-09', 100)]);
    const bar = bars(container)[0];
    const y = Number(bar.getAttribute('y'));
    const height = Number(bar.getAttribute('height'));
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y + height).toBeLessThanOrEqual(viewH);
  });

  it('keeps every value label inside the viewBox, including at 100%', () => {
    const { container, viewH } = renderChart([point('2026-07', 100), point('2026-08', 98), point('2026-09', 42)]);
    const labels = Array.from(container.querySelectorAll('text')).map((t) => Number(t.getAttribute('y')));
    for (const y of labels) {
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThanOrEqual(viewH);
    }
  });

  it('does not rely on overflow to keep its content on screen', () => {
    // `overflow: visible` was what hid the geometry bug; if it comes back, the
    // labels are escaping the box again.
    const { svg } = renderChart([point('2026-09', 100)]);
    expect(svg.style.overflow).not.toBe('visible');
  });

  it('draws the threshold line after the bars so it reads over them', () => {
    const { container } = renderChart([point('2026-09', 96)]);
    const dashed = container.querySelector('line[stroke-dasharray]')!;
    const lastBar = bars(container).at(-1)!;
    expect(dashed.compareDocumentPosition(lastBar) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('places the threshold line at 75% of the plot height', () => {
    const { container, viewH } = renderChart([point('2026-09', 50)]);
    const dashed = container.querySelector('line[stroke-dasharray]')!;
    const thresholdY = Number(dashed.getAttribute('y1'));
    const bar = bars(container)[0];
    // A 50% bar's top must sit *below* the 75% line — the whole point of a
    // reference line is that position against it means something.
    expect(Number(bar.getAttribute('y'))).toBeGreaterThan(thresholdY);
    expect(thresholdY).toBeGreaterThan(0);
    expect(thresholdY).toBeLessThan(viewH);
  });

  it('scales to its container instead of a fixed pixel width', () => {
    const { svg } = renderChart([point('2026-08', 80), point('2026-09', 90)]);
    expect(svg.style.width).toBe('100%');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
  });

  it('draws nothing for a month with no records, while still labelling it', () => {
    const { container } = renderChart([point('2026-09', 0, 0), point('2026-10', 80)]);
    const heights = bars(container).map((b) => Number(b.getAttribute('height')));
    expect(heights).toContain(0);
    // The month keeps its place on the axis even with nothing to draw, so a
    // gap in the record reads as a gap rather than as a missing month.
    // Matched loosely: the abbreviation the runtime's locale data produces for
    // September is "Sep" on some ICU builds and "Sept" on others, and which one
    // it is has nothing to do with what this test is checking.
    const axisLabels = Array.from(container.querySelectorAll('text')).map((t) => t.textContent ?? '');
    expect(axisLabels.some((l) => l.startsWith('Sep'))).toBe(true);
    expect(axisLabels).toContain('Oct');
  });
});
