import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cdk.out/**',
      '**/coverage/**',
      'fixtures/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // CommonJS tool configs (dependency-cruiser) are not ESM.
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly', __dirname: 'readonly' },
    },
  },

  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // The engine-purity rule. See the build spec §4.2.
  //
  // packages/engine is the deterministic core. It runs in Lambda AND in the
  // browser (the what-if panel imports it directly), and it must stay runnable
  // with zero AWS dependencies so the Build It fallback costs an hour, not a day.
  //
  // This is enforced here, in .dependency-cruiser.cjs, and as a required CI
  // check — three places, so it cannot quietly rot.
  // ───────────────────────────────────────────────────────────────────────────
  {
    files: ['packages/engine/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@aws-sdk/*',
                'aws-sdk',
                'node:*',
                'fs',
                'fs/*',
                'path',
                'crypto',
                'http',
                'https',
                'os',
                'child_process',
              ],
              message:
                'packages/engine is pure. It runs in Lambda AND in the browser, and must have no I/O. Move this into packages/functions.',
            },
          ],
        },
      ],
    },
  },

  // CDK constructs legitimately use classes with no public members and `any`
  // in escape hatches.
  {
    files: ['packages/infra/**/*.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
);
