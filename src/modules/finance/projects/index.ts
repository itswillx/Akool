// Public entry point of the works ("Obras") submodule. Import via
// '../modules/finance/projects' — never reach into the files directly.
export { default } from './FinanceProjectsTab'
export { useFinanceProjects, type FinanceProjectsStore } from './useFinanceProjects'
export { useProjectsSummary } from './useProjectsSummary'
