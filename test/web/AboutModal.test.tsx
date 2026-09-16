import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AboutModal } from '../../src/web/components/AboutModal';

describe('AboutModal component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<AboutModal isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders modal with title, subtitle, and description when isOpen is true', () => {
    render(
      <AboutModal
        isOpen={true}
        onClose={vi.fn()}
        title="Custom App Title"
        subtitle="Custom Subtitle"
        description="Custom Description Paragraph"
      />
    );

    expect(screen.getByText('About')).toBeDefined();
    expect(screen.getByText('Custom App Title')).toBeDefined();
    expect(screen.getByText('Custom Subtitle')).toBeDefined();
    expect(screen.getByText('Custom Description Paragraph')).toBeDefined();
  });

  it('renders default app copy when custom props are omitted', () => {
    render(<AboutModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText('CloudDrive Sync')).toBeDefined();
    expect(screen.getByText('High-Speed Cloud Transfer & Media Suite')).toBeDefined();
    expect(screen.getByText(/convert audio\/video\/document/i)).toBeDefined();
  });

  it('calls onClose when close button is clicked', () => {
    const handleClose = vi.fn();
    render(<AboutModal isOpen={true} onClose={handleClose} />);

    const closeBtn = screen.getByRole('button', { name: /Close/i });
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when clicking outside on the backdrop', () => {
    const handleClose = vi.fn();
    render(<AboutModal isOpen={true} onClose={handleClose} />);

    const backdrop = screen.getByRole('dialog');
    fireEvent.click(backdrop);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape key is pressed', () => {
    const handleClose = vi.fn();
    render(<AboutModal isOpen={true} onClose={handleClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
