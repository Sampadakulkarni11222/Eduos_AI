import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { clickable } from '@/components/ui';

/**
 * The helper behind the ISS-007 accessibility fix. Its whole purpose is that a
 * non-button element becomes operable by keyboard, so that is what is asserted
 * here rather than the fact that it renders.
 */

describe('clickable', () => {
  it('exposes the element as a button to assistive technology', () => {
    render(<div {...clickable(() => {})}>Open</div>);
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
  });

  it('puts the element in the tab order', () => {
    render(<div {...clickable(() => {})}>Open</div>);
    expect(screen.getByRole('button')).toHaveAttribute('tabindex', '0');
  });

  it('still responds to a mouse click', () => {
    const onClick = vi.fn();
    render(<div {...clickable(onClick)}>Open</div>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('activates on Enter', () => {
    const onClick = vi.fn();
    render(<div {...clickable(onClick)}>Open</div>);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('activates on Space, matching native button behaviour', () => {
    const onClick = vi.fn();
    render(<div {...clickable(onClick)}>Open</div>);
    fireEvent.keyDown(screen.getByRole('button'), { key: ' ' });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('ignores other keys', () => {
    const onClick = vi.fn();
    render(<div {...clickable(onClick)}>Open</div>);
    for (const key of ['a', 'Tab', 'Escape', 'ArrowDown']) {
      fireEvent.keyDown(screen.getByRole('button'), { key });
    }
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not fire when the key came from a nested control', () => {
    // A row that is itself clickable often contains its own buttons; pressing
    // Enter on the inner one must not also trigger the row.
    const onRow = vi.fn();
    render(
      <div {...clickable(onRow)} data-testid="row">
        <button type="button">Inner</button>
      </div>
    );
    fireEvent.keyDown(screen.getByText('Inner'), { key: 'Enter' });
    expect(onRow).not.toHaveBeenCalled();
  });

  it('applies an accessible name when one is given', () => {
    render(<div {...clickable(() => {}, { label: 'View fees' })}>₹</div>);
    expect(screen.getByRole('button', { name: 'View fees' })).toBeInTheDocument();
  });

  it('is inert and out of the tab order when disabled', () => {
    const onClick = vi.fn();
    render(<div {...clickable(onClick, { disabled: true })}>Open</div>);
    const el = screen.getByRole('button');

    expect(el).toHaveAttribute('tabindex', '-1');
    expect(el).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(el);
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onClick).not.toHaveBeenCalled();
  });
});
