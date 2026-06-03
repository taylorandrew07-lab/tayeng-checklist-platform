import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'

const eslintConfig = [
  {
    ignores: ['.next/**', 'node_modules/**', 'out/**', 'build/**'],
  },
  ...nextCoreWebVitals,
  {
    rules: {
      'react-hooks/exhaustive-deps': 'warn',
      '@next/next/no-img-element': 'off',
      '@next/next/no-page-custom-font': 'off',
      // New React-Compiler advisory rules introduced by eslint-config-next 16.
      // They flag legal, working patterns (sub-components in render, setState in
      // effects); downgraded to warnings so they don't block, kept visible for
      // future cleanup rather than refactored as part of the framework upgrade.
      'react-hooks/static-components': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
]

export default eslintConfig
