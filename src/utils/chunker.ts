/**
 * Splits text into chunks of specified size and overlap.
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
