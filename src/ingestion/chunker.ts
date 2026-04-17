import { encode, decode } from "gpt-tokenizer";

export interface Chunk {
  text: string;
  index: number;
  tokenCount: number;
  startOffset: number; // character offset in source
}

const CHUNK_SIZE = 256; // tokens — reduced from 512 to stay within mxbai-embed-large context limit
const OVERLAP = 25; // tokens

/**
 * Split text into overlapping chunks of ~512 tokens.
 * Uses GPT tokenizer (cl100k_base) for accurate token counting.
 */
export function chunkText(
  text: string,
  chunkSize = CHUNK_SIZE,
  overlap = OVERLAP
): Chunk[] {
  const tokens = encode(text, { allowedSpecial: "all" });
  if (tokens.length <= chunkSize) {
    return [
      {
        text: text.trim(),
        index: 0,
        tokenCount: tokens.length,
        startOffset: 0,
      },
    ];
  }

  const chunks: Chunk[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < tokens.length) {
    const end = Math.min(start + chunkSize, tokens.length);
    const chunkTokens = tokens.slice(start, end);
    const chunkText = decode(chunkTokens).trim();

    if (chunkText.length > 0) {
      chunks.push({
        text: chunkText,
        index: chunkIndex,
        tokenCount: chunkTokens.length,
        startOffset: start,
      });
      chunkIndex++;
    }

    if (end >= tokens.length) break;
    start = end - overlap;
  }

  return chunks;
}

/**
 * Count tokens in a string using GPT tokenizer.
 */
export function countTokens(text: string): number {
  return encode(text, { allowedSpecial: "all" }).length;
}
