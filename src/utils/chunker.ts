/**
 * Detects if text is likely tabular data (CSV, table-like format)
 */
function isTabularContent(text: string): boolean {
  const lines = text.split('\n').slice(0, 10); // Check first 10 lines
  let commaCount = 0;
  let lineCount = 0;

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    lineCount++;
    // Count lines that have consistent comma or pipe separators
    const commas = (line.match(/,/g) || []).length;
    if (commas > 2) commaCount++;
  }

  // If more than 50% of lines have multiple commas, likely tabular
  return lineCount > 0 && commaCount / lineCount > 0.5;
}

/**
 * Splits tabular data (CSV-like) by rows, keeping complete rows together.
 */
function chunkTabularData(text: string, maxChunkRows: number = 10): string[] {
  const lines = text.split('\n');
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentSize = 0;

  for (const line of lines) {
    const lineLength = line.length;
    const lineWithNewline = lineLength + 1; // Account for newline

    // If adding this line would exceed chunk size or we've hit row limit, create new chunk
    if (currentChunk.length > 0 && (currentSize + lineWithNewline > 1500 || currentChunk.length >= maxChunkRows)) {
      chunks.push(currentChunk.join('\n'));
      currentChunk = [];
      currentSize = 0;
    }

    if (line.trim().length > 0) {
      currentChunk.push(line);
      currentSize += lineWithNewline;
    }
  }

  // Push remaining chunk
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n'));
  }

  return chunks.filter(chunk => chunk.trim().length > 0);
}

/**
 * Splits text into chunks of specified size and overlap.
 * For tabular data, chunks by rows instead of characters.
 * 
 * @param text The input text to chunk.
 * @param chunkSize Maximum characters per chunk (default 1000).
 * @param chunkOverlap Characters overlap between consecutive chunks (default 200).
 * @returns Array of text chunks.
 */
export function chunkText(
  text: string,
  chunkSize: number = 1000,
  chunkOverlap: number = 200
): string[] {
  if (!text || text.trim() === '') {
    return [];
  }

  // Detect and use special handling for tabular data
  if (isTabularContent(text)) {
    return chunkTabularData(text);
  }

  // Standard character-based chunking for prose documents
  const chunks: string[] = [];
  const textLength = text.length;

  let start = 0;
  while (start < textLength) {
    let end = start + chunkSize;
    
    // If we are not at the end of the text and we want to avoid cutting a word in half,
    // we can optionally adjust the chunk boundary. Let's do a simple character-level split
    // but try to find a space if it's within 15 characters of the target end.
    if (end < textLength) {
      const lastSpace = text.lastIndexOf(' ', end);
      if (lastSpace > start && end - lastSpace < 15) {
        end = lastSpace;
      }
    }

    const chunk = text.substring(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    // Next start is current end minus overlap
    start = end - chunkOverlap;
    
    // Safety check: ensure we always advance to avoid infinite loops
    if (start >= end || start < 0) {
      start = end;
    }
  }

  return chunks;
}
