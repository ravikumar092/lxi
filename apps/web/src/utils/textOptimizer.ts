/**
 * Lex Tigress — Text Optimizer Utility
 * 
 * Cleans and truncates text to minimize AI API token usage.
 */

export function optimizePromptText(text: string, maxLength: number = 20000): string {
  if (!text) return '';

  let cleaned = text
    // Remove non-printable characters often introduced by bad OCR (keeps standard ASCII, newlines, tabs)
    .replace(/[^\x20-\x7E\n\t]/g, ' ')
    // Consolidate multiple spaces and tabs into a single space
    .replace(/[ \t]+/g, ' ')
    // Consolidate multiple newlines (3 or more) to just double newlines
    .replace(/\n{3,}/g, '\n\n')
    // Remove spaces at the beginning and end of lines
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    // Final trim
    .trim();

  // Truncate to maximum length if necessary
  if (cleaned.length > maxLength) {
    // Keep the first chunk and the last chunk, as the beginning (title/summary) 
    // and end (signatures/orders) are typically most important.
    const half = Math.floor(maxLength / 2) - 50; 
    const start = cleaned.slice(0, half);
    const end = cleaned.slice(-half);
    cleaned = start + '\n...[CONTENT TRUNCATED FOR OPTIMIZATION]...\n' + end;
  }

  return cleaned;
}
