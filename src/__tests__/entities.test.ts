import { extractEntitiesSync, extractSemanticTags } from "../ingestion/entities.js";

describe("Entity Extraction", () => {
  describe("extractEntitiesSync (fast mode)", () => {
    it("should extract proper nouns via regex", () => {
      const entities = extractEntitiesSync("Met with Sarah Johnson at the conference.");
      expect(entities).toContain("Sarah Johnson");
    });

    it("should not extract single-word proper nouns via regex", () => {
      const entities = extractEntitiesSync("The weather was nice.");
      expect(entities).not.toContain("The");
    });

    it("should extract multi-word proper nouns", () => {
      const entities = extractEntitiesSync("Talked to John Smith about Acme Corp today.");
      expect(entities).toContain("John Smith");
      expect(entities).toContain("Acme Corp");
    });

    it("should return empty array for text with no entities", () => {
      const entities = extractEntitiesSync("the quick brown fox jumps over the lazy dog");
      expect(entities.length).toBe(0);
    });

    it("should deduplicate entities", () => {
      const entities = extractEntitiesSync("Sarah Johnson and Sarah Johnson discussed the project.");
      const count = entities.filter(e => e === "Sarah Johnson").length;
      expect(count).toBe(1);
    });

    it("should cap proper noun length at 3 words", () => {
      const entities = extractEntitiesSync("The Very Long Company Name International should not match.");
      // 4+ word proper nouns should not be extracted
      const longNames = entities.filter(e => e.split(" ").length > 3);
      expect(longNames.length).toBe(0);
    });
  });

  describe("extractSemanticTags", () => {
    it("should tag financial content", () => {
      const tags = extractSemanticTags("Invoice payment of $2,500 due next week.");
      expect(tags).toContain("financial");
    });

    it("should tag technical content", () => {
      const tags = extractSemanticTags("Fixed the API bug in the deployment pipeline.");
      expect(tags).toContain("technical");
      expect(tags).toContain("engineering");
    });

    it("should tag urgent content", () => {
      const tags = extractSemanticTags("ASAP: deadline is tomorrow morning.");
      expect(tags).toContain("urgent");
    });

    it("should tag meeting content", () => {
      const tags = extractSemanticTags("Call with Jeff to sync on the project.");
      expect(tags).toContain("meeting");
    });

    it("should return multiple tags for multi-topic content", () => {
      const tags = extractSemanticTags("Strategy meeting to decide on the budget plan.");
      expect(tags.length).toBeGreaterThanOrEqual(2);
      expect(tags).toContain("meeting");
      expect(tags).toContain("strategy");
    });

    it("should return empty for generic text", () => {
      const tags = extractSemanticTags("the sun is shining today");
      expect(tags.length).toBe(0);
    });
  });
});
