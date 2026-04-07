import { chunkText, countTokens } from "../ingestion/chunker.js";

describe("Text Chunking", () => {
  describe("countTokens", () => {
    it("should return positive count for non-empty text", () => {
      expect(countTokens("hello world")).toBeGreaterThan(0);
    });

    it("should return 0 for empty text", () => {
      expect(countTokens("")).toBe(0);
    });

    it("should count longer texts as more tokens", () => {
      const short = countTokens("hello");
      const long = countTokens("hello world, this is a much longer sentence with many words");
      expect(long).toBeGreaterThan(short);
    });
  });

  describe("chunkText", () => {
    it("should return at least one chunk for non-empty text", () => {
      const chunks = chunkText("Hello world.");
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it("should preserve text content across chunks", () => {
      const text = "First sentence. Second sentence. Third sentence.";
      const chunks = chunkText(text);
      const reconstructed = chunks.map(c => c.text).join(" ");
      // All original words should appear in reconstructed text
      for (const word of ["First", "Second", "Third"]) {
        expect(reconstructed).toContain(word);
      }
    });

    it("should split long text into multiple chunks", () => {
      // Generate text longer than chunk size
      const longText = Array(200).fill("This is a test sentence with several words.").join(" ");
      const chunks = chunkText(longText);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it("should include chunk index in each chunk", () => {
      const longText = Array(200).fill("Testing chunk indexing works correctly.").join(" ");
      const chunks = chunkText(longText);
      chunks.forEach((chunk, i) => {
        expect(chunk.index).toBe(i);
      });
    });

    it("should handle empty text gracefully", () => {
      const chunks = chunkText("");
      // Chunker may return 1 empty chunk or 0 — either is acceptable
      expect(chunks.length).toBeLessThanOrEqual(1);
    });
  });
});
