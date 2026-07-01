// Strip characters that are significant to PostgREST's OR-filter / ilike syntax
// so a user-typed term can be safely interpolated into a filter such as
// `.or('email.ilike.%<term>%,display_name.ilike.%<term>%')` without letting the
// input alter the filter structure (e.g. inject extra OR conditions via `,`/`()`
// or wildcard-match everything via `%`/`*`). Pure and framework-agnostic.
//
// Removed: % , ( ) * \ : "  — the OR separator, grouping, ilike wildcards, the
// escape char, the field.op.value separator helper, and the quote. Letters,
// digits, spaces, `@`, `.`, `-`, `_` etc. are kept so normal name/email search
// still works.
export function sanitizeIlikeTerm(term: string): string {
  return (term ?? '').replace(/[%,()*\\:"]/g, '').trim()
}
