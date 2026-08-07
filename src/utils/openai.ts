import { OpenAI } from 'openai';

const apiKey = process.env.OPENAI_API_KEY;
const isPlaceholder = !apiKey || apiKey.startsWith('your_') || apiKey === '';

export const openai = !isPlaceholder
  ? new OpenAI({ apiKey })
  : null;

/**
 * Generates an embedding for a given text.
 * Falls back to mock values if OpenAI API Key is not configured.
 */
export async function getEmbedding(text: string): Promise<number[]> {
  if (isPlaceholder || !openai) {
    // Generate a pseudo-random mock embedding for simulation
    const mockVector = Array.from({ length: 1536 }, (_, i) => {
      // Create some variance based on the string chars
      const charCode = text.charCodeAt(i % text.length) || 0;
      return Math.sin(i + charCode) * 0.05;
    });
    // Normalize mock vector
    const magnitude = Math.sqrt(mockVector.reduce((sum, val) => sum + val * val, 0));
    return mockVector.map(val => val / magnitude);
  }

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.replace(/\n/g, ' '),
  });

  return response.data[0].embedding;
}

/**
 * Checks if OpenAI is fully configured and active.
 */
export function isOpenAIConfigured(): boolean {
  return !isPlaceholder && !!openai;
}
