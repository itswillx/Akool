// API-027: o parser dos backlogs mora em supabase/functions/_domain (a API lê o
// mesmo formato). A CLI (scripts/import-backlog-cards.ts) e a tela importam daqui.
export {
  parseBacklogMarkdown,
  type BacklogIssue,
  type BacklogIssueCode,
  type ParsedBacklogCard,
  type ParseOptions,
  type ParseResult,
} from '../../supabase/functions/_domain/backlogMarkdownParser'
