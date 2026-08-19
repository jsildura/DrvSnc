import { validateRemoteUrl } from '../../worker/services/remoteUrlPolicy';
import { MAX_BATCH_URLS } from '../../shared/contracts';

export interface ParsedBatchItem {
  url: string;
  filename?: string;
  originalLine: number;
}

export interface DuplicateLineRef {
  line: number;
  duplicateOf: number;
  url: string;
}

export interface InvalidLineRef {
  line: number;
  raw: string;
  reason: string;
}

export interface ParsedBatchResult {
  items: ParsedBatchItem[];
  duplicateLines: DuplicateLineRef[];
  invalidLines: InvalidLineRef[];
  totalLines: number;
  error?: string;
}

/**
 * Parses raw batch text (lines of URLs) into validated, de-duplicated items.
 * Enforces 1-50 URL limit, trims lines, ignores blank lines, handles LF & CRLF.
 */
export function parseBatchText(text: string): ParsedBatchResult {
  if (!text || !text.trim()) {
    return {
      items: [],
      duplicateLines: [],
      invalidLines: [],
      totalLines: 0,
      error: 'Input text is empty',
    };
  }

  const rawLines = text.split(/\r?\n/);
  const items: ParsedBatchItem[] = [];
  const duplicateLines: DuplicateLineRef[] = [];
  const invalidLines: InvalidLineRef[] = [];

  const seenUrls = new Map<string, number>(); // normalizedUrl -> originalLine
  let nonEmptyLineCount = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const originalLineNumber = i + 1;
    const trimmed = rawLines[i].trim();

    if (!trimmed) {
      continue;
    }

    nonEmptyLineCount++;

    const validation = validateRemoteUrl(trimmed);
    if (!validation.valid || !validation.normalizedUrl) {
      invalidLines.push({
        line: originalLineNumber,
        raw: trimmed,
        reason: validation.error || 'Invalid remote URL',
      });
      continue;
    }

    const normalizedUrl = validation.normalizedUrl;

    if (seenUrls.has(normalizedUrl)) {
      duplicateLines.push({
        line: originalLineNumber,
        duplicateOf: seenUrls.get(normalizedUrl)!,
        url: normalizedUrl,
      });
      continue;
    }

    seenUrls.set(normalizedUrl, originalLineNumber);

    // Extract filename from URL path if clean
    let defaultFilename: string | undefined;
    try {
      const u = new URL(normalizedUrl);
      const pathname = u.pathname;
      const lastSegment = pathname.split('/').filter(Boolean).pop();
      if (lastSegment && lastSegment.includes('.')) {
        defaultFilename = decodeURIComponent(lastSegment);
      }
    } catch {
      // ignore
    }

    items.push({
      url: normalizedUrl,
      filename: defaultFilename,
      originalLine: originalLineNumber,
    });
  }

  let error: string | undefined;
  if (items.length === 0 && invalidLines.length === 0) {
    error = 'No valid URL lines found in input';
  } else if (items.length > MAX_BATCH_URLS) {
    error = `Exceeded maximum of ${MAX_BATCH_URLS} URLs per batch (found ${items.length} valid URLs)`;
  }

  return {
    items,
    duplicateLines,
    invalidLines,
    totalLines: nonEmptyLineCount,
    error,
  };
}

/**
 * Parses a UTF-8 .txt File into batch items.
 */
export async function parseBatchFile(file: File): Promise<ParsedBatchResult & { rawText?: string }> {
  if (!file) {
    return {
      items: [],
      duplicateLines: [],
      invalidLines: [],
      totalLines: 0,
      error: 'No file provided',
    };
  }

  const isTxtExtension = file.name.toLowerCase().endsWith('.txt');
  if (!isTxtExtension) {
    return {
      items: [],
      duplicateLines: [],
      invalidLines: [],
      totalLines: 0,
      error: 'Only .txt plain text files are supported',
    };
  }

  if (file.size === 0) {
    return {
      items: [],
      duplicateLines: [],
      invalidLines: [],
      totalLines: 0,
      error: 'Uploaded file is empty',
    };
  }

  let text = '';
  try {
    const arrayBuffer = await file.arrayBuffer();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    text = decoder.decode(arrayBuffer);
  } catch {
    return {
      items: [],
      duplicateLines: [],
      invalidLines: [],
      totalLines: 0,
      error: 'File is not valid UTF-8 text',
    };
  }

  const result = parseBatchText(text);
  return {
    ...result,
    rawText: text,
  };
}
