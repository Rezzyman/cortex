/**
 * Benchmark Scoring Utilities
 *
 * Implements standard metrics for memory retrieval benchmarks:
 * - Recall@K: Is the correct answer in the top K results?
 * - MRR (Mean Reciprocal Rank): Average of 1/rank for correct answers
 * - Precision@K: Fraction of top K results that are correct
 * - Hit Rate: Binary — did we find at least one correct result?
 */

export interface QuestionResult {
  questionId: string;
  question: string;
  expectedSessionIds: string[];
  retrievedSessionIds: string[];
  rank: number | null; // rank of first correct result (null = not found)
  hit: boolean;
}

export interface BenchmarkScores {
  totalQuestions: number;
  recallAt1: number;
  recallAt3: number;
  recallAt5: number;
  recallAt10: number;
  mrr: number;
  hitRate: number;
  avgRank: number;
  misses: QuestionResult[];
}

/**
 * Compute Recall@K: Is at least one correct session in the top K retrieved?
 */
export function recallAtK(
  expected: string[],
  retrieved: string[],
  k: number
): boolean {
  const topK = retrieved.slice(0, k);
  return expected.some((e) => topK.includes(e));
}

/**
 * Find the rank of the first correct result.
 */
export function findRank(
  expected: string[],
  retrieved: string[]
): number | null {
  for (let i = 0; i < retrieved.length; i++) {
    if (expected.includes(retrieved[i])) {
      return i + 1;
    }
  }
  return null;
}

/**
 * Score a full benchmark run.
 */
export function scoreBenchmark(results: QuestionResult[]): BenchmarkScores {
  const total = results.length;
  if (total === 0) {
    return {
      totalQuestions: 0,
      recallAt1: 0,
      recallAt3: 0,
      recallAt5: 0,
      recallAt10: 0,
      mrr: 0,
      hitRate: 0,
      avgRank: 0,
      misses: [],
    };
  }

  let r1 = 0, r3 = 0, r5 = 0, r10 = 0;
  let rrSum = 0;
  let hits = 0;
  let rankSum = 0;
  let rankCount = 0;
  const misses: QuestionResult[] = [];

  for (const r of results) {
    if (recallAtK(r.expectedSessionIds, r.retrievedSessionIds, 1)) r1++;
    if (recallAtK(r.expectedSessionIds, r.retrievedSessionIds, 3)) r3++;
    if (recallAtK(r.expectedSessionIds, r.retrievedSessionIds, 5)) r5++;
    if (recallAtK(r.expectedSessionIds, r.retrievedSessionIds, 10)) r10++;

    if (r.rank !== null) {
      rrSum += 1 / r.rank;
      hits++;
      rankSum += r.rank;
      rankCount++;
    } else {
      misses.push(r);
    }
  }

  return {
    totalQuestions: total,
    recallAt1: r1 / total,
    recallAt3: r3 / total,
    recallAt5: r5 / total,
    recallAt10: r10 / total,
    mrr: rrSum / total,
    hitRate: hits / total,
    avgRank: rankCount > 0 ? rankSum / rankCount : 0,
    misses,
  };
}

/**
 * Format scores as a readable report.
 */
export function formatScores(name: string, scores: BenchmarkScores): string {
  let report = `# ${name} Benchmark Results\n\n`;
  report += `Total Questions: ${scores.totalQuestions}\n\n`;
  report += `| Metric | Score |\n`;
  report += `|--------|-------|\n`;
  report += `| Recall@1 | ${(scores.recallAt1 * 100).toFixed(1)}% |\n`;
  report += `| Recall@3 | ${(scores.recallAt3 * 100).toFixed(1)}% |\n`;
  report += `| Recall@5 | ${(scores.recallAt5 * 100).toFixed(1)}% |\n`;
  report += `| Recall@10 | ${(scores.recallAt10 * 100).toFixed(1)}% |\n`;
  report += `| MRR | ${(scores.mrr * 100).toFixed(1)}% |\n`;
  report += `| Hit Rate | ${(scores.hitRate * 100).toFixed(1)}% |\n`;
  report += `| Avg Rank (when found) | ${scores.avgRank.toFixed(2)} |\n`;
  report += `| Misses | ${scores.misses.length} |\n`;

  if (scores.misses.length > 0 && scores.misses.length <= 20) {
    report += `\n## Missed Questions\n\n`;
    for (const m of scores.misses) {
      report += `- **${m.questionId}**: "${m.question.slice(0, 100)}..."\n`;
      report += `  Expected: ${m.expectedSessionIds.join(", ")}\n`;
      report += `  Retrieved: ${m.retrievedSessionIds.slice(0, 5).join(", ")}\n\n`;
    }
  }

  return report;
}
