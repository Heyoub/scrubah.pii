# Contributing to Scrubah.PII

Thank you for your interest in contributing to Scrubah.PII! We welcome contributions from the community.

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## How to Contribute

### Reporting Bugs

If you find a bug, please open an issue with:

- **Clear title** describing the problem
- **Steps to reproduce** the issue
- **Expected behavior** vs **actual behavior**
- **Environment details** (browser, OS, Node.js version)
- **Screenshots** if applicable

### Suggesting Features

We welcome feature suggestions! Please open an issue with:

- **Clear description** of the feature
- **Use case** - why would this be valuable?
- **Proposed implementation** (if you have ideas)

### Submitting Code

1. **Fork the repository**

   ```bash
   git clone https://github.com/YOUR_USERNAME/scrubah-pii.git
   cd scrubah-pii
   ```

2. **Create a feature branch**

   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Install dependencies**

   ```bash
   pnpm install
   ```

4. **Make your changes**
   - Follow existing code style
   - Add tests for new features
   - Update documentation as needed

5. **Run tests and linting**

   ```bash
   pnpm test
   pnpm run build  # Ensures TypeScript compiles
   pnpm run lint
   ```

6. **Commit your changes**

   ```bash
   git add .
   git commit -m "Add: Brief description of your changes"
   ```

   Use conventional commit messages:
   - `Add:` for new features
   - `Fix:` for bug fixes
   - `Update:` for improvements to existing features
   - `Chore:` for maintenance tasks
   - `Docs:` for documentation changes

7. **Push to your fork**

   ```bash
   git push origin feature/your-feature-name
   ```

8. **Open a Pull Request**
   - Provide a clear description of your changes
   - Reference any related issues
   - Ensure all CI checks pass

## Development Guidelines

### Code Style

- **TypeScript Strict Mode**: All code must pass strict type checking
- **Effect-TS Patterns**: New services should follow Effect-TS architecture (see [ARCHITECTURE.md](ARCHITECTURE.md))
- **Schemas**: All types should be defined in `schemas.ts` with runtime validation
- **Error Handling**: Use Effect-TS error handling patterns (no thrown exceptions)
- **Immutability**: Prefer `readonly` types and immutable data structures

### Testing

- **Write tests** for all new features
- **Maintain coverage** - aim for 80%+ coverage on new code
- **Test edge cases** - especially for PII detection and medical data handling
- **Integration tests** - test full pipelines, not just units

### Documentation

- **Code comments** - Explain *why*, not *what*
- **JSDoc** - Document public APIs
- **README updates** - Update docs for new features
- **Architecture docs** - Update ARCHITECTURE.md for significant changes

### Security & Privacy

This project handles sensitive medical data. When contributing:

- **No external API calls** - All processing must remain local
- **No telemetry** - Don't add tracking or analytics
- **No logging PHI** - Never log actual PII/PHI data
- **Test thoroughly** - Especially PII scrubbing features

### File Organization

```shell
scrubah.pii/
├── schemas.ts              # All type definitions with runtime validation
├── schemas/
│   ├── phi.ts             # PHI branded types
│   │   ┌───────────────────────────────────────────┐
│   │   │ PIPELINE 3: Compression Schemas           │
│   │   └───────────────────────────────────────────┘
│   ├── ocrQuality.ts             # OCR quality gate schemas
│   ├── templateDetection.ts      # Template fingerprinting
│   ├── semanticDedup.ts          # Semantic deduplication
│   ├── structuredExtraction.ts   # Clinical data extraction
│   ├── narrativeGeneration.ts    # Narrative output schemas
│   └── compressionPipeline.ts    # Unified pipeline schemas
│
├── services/
│   ├── *.effect.ts        # Effect-TS services (preferred)
│   ├── *.ts              # Legacy services
│   │   ┌───────────────────────────────────────────┐
│   │   │ PIPELINE 3: Compression Services          │
│   │   └───────────────────────────────────────────┘
│   ├── ocrQualityGate.effect.ts        # Filter low-quality scans
│   ├── templateDetection.effect.ts     # Strip boilerplate
│   ├── semanticDedup.effect.ts         # Remove similar docs
│   ├── structuredExtraction.effect.ts  # Extract clinical data
│   ├── narrativeGeneration.effect.ts   # Generate summaries
│   └── compressionPipeline.effect.ts   # Unified orchestration
│
└── tests/
    └── *.test.ts         # Test files (229 compression tests)
```

**Important**:

- New types go in `schemas.ts` or dedicated schema files (not inline in services)
- New services should use Effect-TS patterns
- Follow existing file structure
- Compression pipeline has 229 comprehensive tests across 6 test files

## Project-Specific Notes

### Adding Lab Test Patterns

To add support for new lab tests:

1. Edit `services/labExtractor.ts`
2. Add pattern to `LAB_TEST_PATTERNS`
3. Add test cases in `labExtractor.test.ts`
4. Document in README if significant

### Modifying PII Detection

PII detection is critical. If modifying:

1. Update patterns in `services/piiScrubber.ts` or `piiScrubber.effect.ts`
2. Add comprehensive test cases in `tests/pii-leak.test.ts`
3. Test against real-world medical documents (scrubbed for contribution)
4. Document confidence threshold changes

### Performance Considerations

- **WASM models** are large - avoid loading multiple models
- **Chunked processing** - handle large documents in chunks
- **IndexedDB** - be mindful of storage limits
- **Memory usage** - test with 100+ documents

## Getting Help

- **Issues**: [GitHub Issues](https://github.com/Heyoub/scrubah-pii/issues)
- **Email**: <hello@forgestack.app>
- **Discussions**: Use GitHub Discussions for questions

## License

By contributing to Scrubah.PII, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Scrubah.PII! 🎉
