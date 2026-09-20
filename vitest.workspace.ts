import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'engine',
      root: './packages/engine',
      environment: 'node',
      include: ['src/**/*.test.ts', '__tests__/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'rulepack',
      root: './packages/rulepack',
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'normalise',
      root: './packages/normalise',
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'eval',
      root: './packages/eval',
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'api',
      root: './packages/api',
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'functions',
      root: './packages/functions',
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  },
]);
