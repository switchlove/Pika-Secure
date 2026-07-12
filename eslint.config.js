const js = require('@eslint/js');
const globals = require('globals');
const eslintConfigPrettier = require('eslint-config-prettier');

module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['src/**/*.js', '*.js'],
    languageOptions: {
      sourceType: 'commonjs',
    },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    ignores: ['node_modules/**', 'coverage/**', 'data/**'],
  },
  eslintConfigPrettier,
];
