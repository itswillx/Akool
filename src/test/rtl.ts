import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// QA-003: Testing Library para os testes de componente novos. O vitest roda sem
// globals, então a limpeza entre testes (que a biblioteca só registra sozinha
// com `afterEach` global) fica aqui. Use com `// @vitest-environment happy-dom`.
afterEach(() => { cleanup() })

export * from '@testing-library/react'
export { default as userEvent } from '@testing-library/user-event'
