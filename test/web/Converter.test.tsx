import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ConverterPage } from '../../src/web/routes/ConverterPage';

describe('ConverterPage & ConverterPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Step 1 and Step 2 with default Video/MP4 options and disabled Convert button', () => {
    render(<ConverterPage />);

    expect(screen.getByText('Video Converter')).toBeDefined();
    expect(screen.getByText('1')).toBeDefined();
    expect(screen.getByText('Google Drive')).toBeDefined();
    expect(screen.getByText('2')).toBeDefined();

    // Tabs
    expect(screen.getByRole('button', { name: 'Video' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Audio' })).toBeDefined();

    // Video Formats
    expect(screen.getByRole('button', { name: 'mp4' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'avi' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'mov' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'mkv' })).toBeDefined();

    // Resolution & Settings
    expect(screen.getByText('Resolution:')).toBeDefined();
    expect(screen.getByText('Same as source')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeDefined();

    // Convert button is disabled when no file is chosen
    const convertBtn = screen.getByRole('button', { name: 'Convert' }) as HTMLButtonElement;
    expect(convertBtn.disabled).toBe(true);
  });

  it('switches to Audio mode and displays audio formats and quality presets', () => {
    render(<ConverterPage />);

    const audioTab = screen.getByRole('button', { name: 'Audio' });
    fireEvent.click(audioTab);

    // Audio Formats
    expect(screen.getByRole('button', { name: 'mp3' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'wav' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'm4a' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'flac' })).toBeDefined();

    // Audio Quality dropdown
    expect(screen.getByText('Quality:')).toBeDefined();
    expect(screen.getByText(/Standard/)).toBeDefined();

    // Switch back to Video mode
    const videoTab = screen.getByRole('button', { name: 'Video' });
    fireEvent.click(videoTab);

    expect(screen.getByRole('button', { name: 'mp4' })).toBeDefined();
    expect(screen.getByText('Resolution:')).toBeDefined();
  });

  it('opens the Resolution dropdown and allows selecting a custom resolution preset', async () => {
    render(<ConverterPage />);

    // Click the resolution dropdown trigger
    const resolutionBtn = screen.getByText('Same as source');
    fireEvent.click(resolutionBtn);

    // All presets from Image 2 should appear in dropdown
    expect(screen.getByText('HD 1080p')).toBeDefined();
    expect(screen.getByText('1920x1080')).toBeDefined();
    expect(screen.getByText('HD 720p')).toBeDefined();
    expect(screen.getByText('1280x720')).toBeDefined();
    expect(screen.getByText('480p')).toBeDefined();
    expect(screen.getByText('360p')).toBeDefined();
    expect(screen.getByText('240p')).toBeDefined();
    expect(screen.getByText('DVD')).toBeDefined();
    expect(screen.getByText('TV')).toBeDefined();
    expect(screen.getByText('Mobile')).toBeDefined();

    // Select HD 1080p
    fireEvent.click(screen.getByText('HD 1080p'));

    // Trigger button now displays HD 1080p
    expect(screen.getByText('HD 1080p')).toBeDefined();
  });

  it('toggles the Advanced Settings drawer', () => {
    render(<ConverterPage />);

    const settingsBtn = screen.getByRole('button', { name: 'Settings' });
    fireEvent.click(settingsBtn);

    expect(screen.getByText('Advanced Conversion Settings')).toBeDefined();
    expect(screen.getByText('Video Codec:')).toBeDefined();
    expect(screen.getByText('Audio Codec:')).toBeDefined();
    expect(screen.getByLabelText('No audio (remove audio track)')).toBeDefined();

    // Toggle off
    fireEvent.click(settingsBtn);
    expect(screen.queryByText('Advanced Conversion Settings')).toBeNull();
  });

  it('opens Google Drive video picker when Google Drive button is clicked', () => {
    render(<ConverterPage />);

    const driveBtn = screen.getByText('Google Drive');
    fireEvent.click(driveBtn);

    expect(screen.getByText('Select Video from Google Drive')).toBeDefined();
    expect(screen.getByPlaceholderText(/Search all videos in Google Drive/i)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Choose Video' })).toBeDefined();
  });
});
