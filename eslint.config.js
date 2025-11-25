import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

/**
 * ESLint Configuration - Layered Strictness for Effect-TS + HIPAA
 *
 * Strategy:
 * - STRICT: Domain modules (schemas, types, PHI handling) - full no-any enforcement
 * - RELAXED: Effect-TS integration layer - allows any due to TS inference limits
 *
 * This layered approach provides HIPAA-grade type safety where it matters most
 * while avoiding TypeScript compiler stack overflow with Effect's complex generics.
 */
export default [
  // Base config for all TypeScript files
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['node_modules/**', 'dist/**'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      // Base rules - moderate strictness
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
    },
  },

  // STRICT: Domain modules - HIPAA-critical code paths
  // These modules handle PHI and must have zero `any` leakage
  {
    files: [
      'schemas/**/*.ts',
      'schemas.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
    },
  },

  // STRICT: Error handling - all errors must be typed
  {
    files: [
      'services/errors.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
    },
  },

  // STRICT: PHI boundary enforcement
  // Services that directly handle patient data
  {
    files: [
      'services/markdownFormatter.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
    },
  },

  // RELAXED: Effect-TS integration layer
  // These files use complex Effect generics that cause TS inference issues
  // Safety is enforced via branded types and runtime validation instead
  {
    files: [
      'services/*.effect.ts',
      'services/compression/**/*.ts',
    ],
    rules: {
      // Allow any in Effect layer - TS can't infer these properly
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  // Test files - relaxed for mocking
  {
    files: ['**/*.test.ts', '**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
];
