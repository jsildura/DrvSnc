// CORS detection and error handling utilities

export function isCorsError(error: any): boolean {
  return (
    error instanceof TypeError &&
    (error.message.includes('Failed to fetch') ||
      error.message.includes('NetworkError') ||
      error.message.includes('CORS'))
  );
}

export function getCorsErrorMessage(url: string): string {
  return `CORS Blocked: The source "${new URL(url).hostname}" does not permit cross-origin reads. The extension can't fetch this file without server help. Try a different link or download the file locally and use the file upload feature.`;
}

export async function checkUrlAccessibility(url: string): Promise<{ accessible: boolean; error?: string }> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    if (!response.ok) {
      return {
        accessible: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }
    return { accessible: true };
  } catch (error: any) {
    if (isCorsError(error)) {
      return {
        accessible: false,
        error: 'CORS_BLOCKED',
      };
    }
    return {
      accessible: false,
      error: error.message || 'Unknown error',
    };
  }
}
