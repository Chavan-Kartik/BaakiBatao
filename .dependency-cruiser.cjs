/**
 * Structural rules for the monorepo.
 *
 * The one that matters is `engine-is-pure`. See the build spec §4.2 — the
 * deterministic core has to stay importable from a browser bundle, which means
 * no AWS SDK and no Node built-ins. `pnpm dep:cruise` is a required CI check.
 */
module.exports = {
  forbidden: [
    {
      name: 'engine-is-pure',
      comment:
        'packages/engine runs in Lambda AND in the browser. No AWS SDK, no Node built-ins, no I/O.',
      severity: 'error',
      from: { path: '^packages/engine' },
      to: {
        path: 'node_modules/(@aws-sdk|aws-sdk)',
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'engine-no-node-builtins',
      comment: 'Same reason: the engine must bundle for the browser.',
      severity: 'error',
      from: { path: '^packages/engine' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'engine-depends-only-on-contracts',
      comment: 'The engine may import @fc/contracts and nothing else from the workspace.',
      severity: 'error',
      from: { path: '^packages/engine' },
      to: {
        path: '^packages/(?!engine|contracts)',
      },
    },
    {
      name: 'contracts-depends-on-nothing',
      comment: 'contracts is the seam between both engineers. It must stay dependency-free.',
      severity: 'error',
      from: { path: '^packages/contracts' },
      to: { path: '^packages/(?!contracts)' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: { orphan: true, pathNot: ['\\.d\\.ts$', '(^|/)tsconfig\\.json$'] },
      to: {},
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(node_modules|cdk\\.out|dist|coverage)' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.ts', '.tsx', '.json'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
