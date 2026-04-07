import { dgEncode, sparseOverlap, sparseJaccard, DG_CONFIG } from "../hippocampus/dentate-gyrus.js";

describe("Dentate Gyrus — Pattern Separation", () => {
  // Generate a deterministic test embedding
  function makeEmbedding(seed: number): number[] {
    const emb = new Array(DG_CONFIG.INPUT_DIM);
    for (let i = 0; i < DG_CONFIG.INPUT_DIM; i++) {
      emb[i] = Math.sin(seed * (i + 1) * 0.01) * 0.5;
    }
    return emb;
  }

  describe("dgEncode", () => {
    it("should produce a sparse code with correct dimensions", () => {
      const emb = makeEmbedding(42);
      const code = dgEncode(emb);

      expect(code.dim).toBe(DG_CONFIG.EXPANDED_DIM);
      expect(code.indices.length).toBe(DG_CONFIG.K);
      expect(code.values.length).toBe(DG_CONFIG.K);
    });

    it("should produce L2-normalized output", () => {
      const emb = makeEmbedding(42);
      const code = dgEncode(emb);

      const normSq = code.values.reduce((s, v) => s + v * v, 0);
      expect(normSq).toBeCloseTo(1.0, 3);
    });

    it("should be deterministic (same input → same output)", () => {
      const emb = makeEmbedding(42);
      const code1 = dgEncode(emb);
      const code2 = dgEncode(emb);

      expect(code1.indices).toEqual(code2.indices);
      expect(code1.values).toEqual(code2.values);
    });

    it("should reject wrong-dimension input", () => {
      expect(() => dgEncode([1, 2, 3])).toThrow("expected 1024-dim");
    });

    it("should enforce sparsity (5% activation)", () => {
      const emb = makeEmbedding(42);
      const code = dgEncode(emb);
      const activationRatio = code.indices.length / code.dim;

      expect(activationRatio).toBeCloseTo(DG_CONFIG.SPARSITY_RATIO, 2);
    });

    it("should have all non-negative values (ReLU)", () => {
      const emb = makeEmbedding(42);
      const code = dgEncode(emb);

      for (const v of code.values) {
        expect(v).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("sparseOverlap", () => {
    it("should return maximum overlap for identical codes", () => {
      const emb = makeEmbedding(42);
      const code = dgEncode(emb);
      const selfOverlap = sparseOverlap(code, code);

      // Self-overlap is the sum of all values (since min(v,v)=v for each index)
      // This should be the maximum possible overlap for this code
      expect(selfOverlap).toBeGreaterThan(0);

      // Any other code should have strictly less overlap
      const other = dgEncode(makeEmbedding(999));
      expect(sparseOverlap(code, other)).toBeLessThan(selfOverlap);
    });

    it("should return lower overlap for dissimilar inputs than identical", () => {
      const code1 = dgEncode(makeEmbedding(1));
      const code2 = dgEncode(makeEmbedding(999));
      const selfOverlap = sparseOverlap(code1, code1);

      // Cross-overlap should be strictly less than self-overlap
      expect(sparseOverlap(code1, code2)).toBeLessThan(selfOverlap);
    });

    it("should return partial overlap for moderately different inputs", () => {
      const code1 = dgEncode(makeEmbedding(42));
      const code2 = dgEncode(makeEmbedding(43));

      const overlap = sparseOverlap(code1, code2);
      // Different seeds produce different embeddings — overlap should be partial
      expect(overlap).toBeGreaterThanOrEqual(0);
      expect(overlap).toBeLessThan(1.0);
    });

    it("should be symmetric", () => {
      const code1 = dgEncode(makeEmbedding(1));
      const code2 = dgEncode(makeEmbedding(2));

      expect(sparseOverlap(code1, code2)).toBeCloseTo(sparseOverlap(code2, code1), 6);
    });
  });

  describe("sparseJaccard", () => {
    it("should return 1.0 for identical codes", () => {
      const code = dgEncode(makeEmbedding(42));
      expect(sparseJaccard(code, code)).toBe(1.0);
    });

    it("should return value in [0, 1]", () => {
      const code1 = dgEncode(makeEmbedding(1));
      const code2 = dgEncode(makeEmbedding(2));
      const jaccard = sparseJaccard(code1, code2);

      expect(jaccard).toBeGreaterThanOrEqual(0);
      expect(jaccard).toBeLessThanOrEqual(1);
    });
  });

  describe("pattern separation property", () => {
    it("should produce different sparse codes for different dense inputs", () => {
      const code1 = dgEncode(makeEmbedding(1));
      const code2 = dgEncode(makeEmbedding(100));

      // Different inputs should activate different neuron sets
      const jaccard = sparseJaccard(code1, code2);
      // Low Jaccard means low index overlap — pattern separation is working
      expect(jaccard).toBeLessThan(0.5);
    });

    it("should produce identical codes for identical inputs", () => {
      const emb = makeEmbedding(42);
      const code1 = dgEncode(emb);
      const code2 = dgEncode(emb);

      expect(sparseJaccard(code1, code2)).toBe(1.0);
    });
  });
});
