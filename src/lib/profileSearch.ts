// Strip characters that are significant to PostgREST's OR-filter / ilike syntax
// so a user-typed term can be safely interpolated into a filter such as
// `.or('email.ilike.%<term>%,display_name.ilike.%<term>%')` without letting the
// input alter the filter structure (e.g. inject extra OR conditions via `,`/`()`
// or wildcard-match everything via `%`/`_`/`*`). Pure and framework-agnostic.
// This is defense in depth only — the actual boundary is server-side escaping
// in the search_users_for_share RPC, since this sanitizer is bypassable via a
// direct REST call.
//
// Removed: % _ , ( ) * \ : "  — ilike's two wildcards (% matches any run of
// characters, _ matches any single character), the OR separator, grouping,
// the escape char, the field.op.value separator helper, and the quote.
// Letters, digits, spaces, `@`, `.`, `-` etc. are kept so normal name/email
// search still works.
export function sanitizeIlikeTerm(term: string): string {
  return (term ?? '').replace(/[%_,()*\\:"]/g, '').trim()
}
