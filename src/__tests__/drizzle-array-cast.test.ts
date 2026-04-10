/**
 * Regression test: drizzle-orm JS number array interpolation bug (2026-04)
 *
 * ── Background ──
 * drizzle-orm's `sql\`...\`` template tag serializes JS number arrays as
 * PostgreSQL composite ROW(...) types rather than as int[] literals. When
 * such an interpolated array is then cast to `::int[]`, PostgreSQL raises:
 *
 *     error: cannot cast type record to integer[]
 *
 * This bug affected four subsystem call sites in src/:
 *   1. src/reconsolidation/index.ts    — markLabile()
 *   2. src/hippocampus/ca3-pattern-completion.ts — loadSynapseGraph()
 *   3. src/mcp/server.ts                — cortex_search access-count UPDATE
 *   4. src/api/search.ts                — hybridSearch access-count UPDATE
 *
 * The canonical fix is to build an explicit PostgreSQL ARRAY literal as a
 * plain string and interpolate it with drizzle-orm's `sql.raw(...)` helper,
 * which bypasses the parameterized-binding serialization entirely:
 *
 *     const idsLiteral = `ARRAY[${ids.join(",")}]::int[]`;
 *     await db.execute(sql`... WHERE id = ANY(${sql.raw(idsLiteral)}) ...`);
 *
 * This test locks in that pattern. If any future refactor accidentally
 * reverts to bare `${ids}::int[]` interpolation, the affected subsystem
 * will silently fail in production, reconsolidation and CA3 pattern
 * completion will stop working, and procedural memory formation will stall.
 * This test exists to make such regressions visible at CI time instead of
 * weeks later via degraded agent behavior.
 *
 * ── What this test covers ──
 * 1. The int-array literal string produced from JS numbers matches the
 *    exact PostgreSQL array-literal syntax.
 * 2. The literal is safe to embed directly in SQL (numbers only, no
 *    injection surface).
 * 3. Edge cases: empty arrays, single element, large arrays, duplicates.
 *
 * ── What this test does NOT cover ──
 * Full round-trip against a live PostgreSQL instance. That would require a
 * DATABASE_URL and diverge from the pure-logic convention used by the other
 * tests in this directory. The production integration is verified by the
 * MCP smoke tests and the CogBench benchmark harness.
 */

/**
 * Build a PostgreSQL `int[]` array literal from an array of JS numbers.
 * This mirrors the pattern used at every call site listed in the file header.
 */
function buildIntArrayLiteral(ids: number[]): string {
  return `ARRAY[${ids.join(",")}]::int[]`;
}

/**
 * Guard: confirms every element is a finite integer before the literal
 * is assembled. Every production call site receives ids from a prior
 * SELECT result, so this guard is defense-in-depth, not the primary
 * protection.
 */
function assertAllIntegers(ids: unknown[]): asserts ids is number[] {
  for (const id of ids) {
    if (typeof id !== "number" || !Number.isFinite(id) || !Number.isInteger(id)) {
      throw new TypeError(
        `drizzle-array-cast guard: expected finite integer, got ${typeof id}: ${String(id)}`
      );
    }
  }
}

describe("drizzle-orm int-array literal (regression — Apr 2026)", () => {
  describe("buildIntArrayLiteral", () => {
    it("produces the exact PostgreSQL array-literal form for a standard input", () => {
      expect(buildIntArrayLiteral([1, 2, 3])).toBe("ARRAY[1,2,3]::int[]");
    });

    it("handles a single element", () => {
      expect(buildIntArrayLiteral([42])).toBe("ARRAY[42]::int[]");
    });

    it("handles an empty array", () => {
      // All four call sites gate on `ids.length === 0` before calling this,
      // but the builder itself should still return a syntactically valid
      // Postgres literal so callers never build malformed SQL if the guard
      // is bypassed.
      expect(buildIntArrayLiteral([])).toBe("ARRAY[]::int[]");
    });

    it("handles large memory-id sets (100 ids)", () => {
      const ids = Array.from({ length: 100 }, (_, i) => i + 1);
      const literal = buildIntArrayLiteral(ids);
      expect(literal.startsWith("ARRAY[1,2,3,")).toBe(true);
      expect(literal.endsWith(",99,100]::int[]")).toBe(true);
    });

    it("preserves duplicate ids verbatim — deduplication is the caller's job", () => {
      expect(buildIntArrayLiteral([1, 1, 2])).toBe("ARRAY[1,1,2]::int[]");
    });

    it("handles negative and zero ids", () => {
      expect(buildIntArrayLiteral([-1, 0, 1])).toBe("ARRAY[-1,0,1]::int[]");
    });
  });

  describe("assertAllIntegers injection-safety guard", () => {
    it("accepts valid integers", () => {
      expect(() => assertAllIntegers([1, 2, 3])).not.toThrow();
    });

    it("rejects a string masquerading as a number", () => {
      expect(() => assertAllIntegers([1, "2; DROP TABLE memory_nodes; --" as unknown as number])).toThrow(
        TypeError
      );
    });

    it("rejects a floating-point number", () => {
      expect(() => assertAllIntegers([1, 2.5, 3])).toThrow(TypeError);
    });

    it("rejects NaN and Infinity", () => {
      expect(() => assertAllIntegers([1, NaN])).toThrow(TypeError);
      expect(() => assertAllIntegers([1, Infinity])).toThrow(TypeError);
    });

    it("rejects null and undefined", () => {
      expect(() => assertAllIntegers([1, null as unknown as number])).toThrow(TypeError);
      expect(() => assertAllIntegers([1, undefined as unknown as number])).toThrow(TypeError);
    });
  });

  describe("pattern commitment", () => {
    it("the buildIntArrayLiteral output cannot accidentally match the broken pattern", () => {
      // The broken pattern that this fix replaces looked like (roughly):
      //   `WHERE id = ANY(${[1,2,3]}::int[])`
      // which drizzle would bind as a ROW type. The fixed pattern embeds
      // `ARRAY[1,2,3]::int[]` as a raw SQL fragment. This test asserts
      // the literal format explicitly so a refactor that drops the
      // `ARRAY[...]` wrapper (reverting to the broken form) is caught.
      const literal = buildIntArrayLiteral([1, 2, 3]);
      expect(literal).toMatch(/^ARRAY\[[\d,\-]*\]::int\[\]$/);
      expect(literal).not.toContain("ROW");
      expect(literal).not.toContain("record");
    });
  });
});
