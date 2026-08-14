import { OpenAI } from 'openai';

const apiKey = process.env.OPENAI_API_KEY;
const isPlaceholder = !apiKey || apiKey.startsWith('your_') || apiKey === '';

export const openai = !isPlaceholder
  ? new OpenAI({ apiKey })
  : null;

/**
 * Generates embeddings in batch for an array of texts in a single API call.
 */
export async function getBatchEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  
  if (isPlaceholder || !openai) {
    return texts.map(text => {
      const mockVector = Array.from({ length: 1536 }, (_, i) => {
        const charCode = text.charCodeAt(i % text.length) || 0;
        return Math.sin(i + charCode) * 0.05;
      });
      const magnitude = Math.sqrt(mockVector.reduce((sum, val) => sum + val * val, 0));
      return mockVector.map(val => val / magnitude);
    });
  }

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts.map(t => t.replace(/\n/g, ' ')),
  });

  return response.data.map(d => d.embedding);
}

/**
  * Generates an embedding for a single string.
  */
export async function getEmbedding(text: string): Promise<number[]> {
  const [embedding] = await getBatchEmbeddings([text]);
  return embedding;
}

/**
 * Checks if OpenAI is fully configured and active.
 */
export function isOpenAIConfigured(): boolean {
  return !isPlaceholder && !!openai;
}
