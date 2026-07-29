import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

const typeCheckedConfigs = tseslint.configs.recommendedTypeChecked.map((config) => ({
  ...config,
  files: ['**/*.{ts,tsx}']
}));

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'release/**',
      'node_modules/**',
      'coverage/**',
      'verification-logs/**',
      'test-results/**',
      'playwright-report/**',
      'eslint.config.js'
    ]
  },
  js.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly'
      }
    }
  },
  ...typeCheckedConfigs,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],

      // Typed methods exposed by the preload bridge are deliberately passed to
      // React/Zustand callbacks. They do not use `this`, so this rule produces
      // false positives throughout the renderer.
      '@typescript-eslint/unbound-method': 'off',

      // React event handlers commonly start asynchronous actions and explicitly
      // discard the promise with `void`. Keep promise checks elsewhere, but do
      // not reject valid JSX callbacks.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: false }
      ],

      // Local form state is intentionally synchronized when the persisted
      // settings snapshot changes. This is an external-store synchronization,
      // not a render loop.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/exhaustive-deps': 'off'
    }
  }
);
