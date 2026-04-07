# Contributing to CORTEX

Thank you for your interest in contributing to CORTEX.

## Getting Started

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Run type check (`npm run typecheck`)
6. Commit with a clear message
7. Open a pull request

## Development Setup

```bash
git clone https://github.com/YOUR_USERNAME/cortex.git
cd cortex
npm install
cp .env.example .env
# Fill in your DATABASE_URL and at least one embedding API key
npx tsx scripts/run-migrations.ts
npm test
```

## Code Guidelines

- TypeScript strict mode
- No hardcoded API keys, paths, or personal data
- New features should include tests
- Database changes go through `initDatabase()` migrations with `IF NOT EXISTS` guards
- MCP tools should have clear descriptions and typed parameters via Zod

## Areas We Need Help

- **Benchmarks**: LongMemEval, LOCOMO, custom memory retrieval tests
- **Entity Resolution**: Better NER, co-reference resolution, entity deduplication
- **Temporal Reasoning**: Timeline queries, "what changed since?" APIs
- **Graph Visualization**: D3/Three.js memory network explorer
- **Providers**: Additional embedding model support, local LLM integration
- **Tests**: Expand coverage beyond hippocampus/entities/chunker

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.
