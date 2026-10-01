import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { parseBacklogMarkdown } from '../src/lib/backlogMarkdownParser.ts'
import { ensureTopicColumns, importParsedCards, planTopicColumns } from '../src/lib/importProjectCards.ts'

function loadEnvFile(path: string) {
  if (!existsSync(path)) return
  const content = readFileSync(path, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnvFile(resolve(process.cwd(), '.env.local'))
loadEnvFile(resolve(process.cwd(), '.env'))

function usage() {
  console.log(`Usage: npm run import:cards -- <file.md> [--board-id=<uuid>] [--by-topic] [--dry-run] [--no-skip-duplicates]

  --by-topic  cria uma coluna por "## Tópico:" (reaproveita colunas de mesmo nome)

Environment (.env.local):
  VITE_SUPABASE_URL
  VITE_SUPABASE_ANON_KEY
  IMPORT_USER_EMAIL
  IMPORT_USER_PASSWORD

Optional admin:
  SUPABASE_SERVICE_ROLE_KEY + --user-id=<uuid>
`)
}

function parseArgs(argv: string[]) {
  let filePath: string | null = null
  let boardId: string | null = null
  let dryRun = false
  let skipDuplicates = true
  let byTopic = false
  let userId: string | null = null

  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true
    else if (arg === '--no-skip-duplicates') skipDuplicates = false
    else if (arg === '--by-topic') byTopic = true
    else if (arg.startsWith('--board-id=')) boardId = arg.slice('--board-id='.length)
    else if (arg.startsWith('--user-id=')) userId = arg.slice('--user-id='.length)
    else if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    } else if (!arg.startsWith('-')) {
      filePath = arg
    }
  }

  return { filePath, boardId, dryRun, skipDuplicates, byTopic, userId }
}

async function main() {
  const { filePath, boardId, dryRun, skipDuplicates, byTopic, userId } = parseArgs(process.argv.slice(2))

  if (!filePath) {
    usage()
    process.exit(1)
  }

  const absPath = resolve(process.cwd(), filePath)
  const markdown = readFileSync(absPath, 'utf8')
  const parsed = parseBacklogMarkdown(markdown)

  console.log(`Parsed ${parsed.cards.length} cards from ${filePath}`)
  if (parsed.warnings.length > 0) {
    console.log('\nWarnings:')
    parsed.warnings.forEach(w => console.log(`  - ${w}`))
  }

  if (dryRun) {
    if (byTopic) {
      console.log('\nColumns by topic (new columns go after the board\'s current ones):')
      for (const topic of parsed.topics) {
        const count = parsed.cards.filter(c => c.topic === topic).length
        console.log(`  ${topic}: ${count} cards`)
      }
      const untopiced = parsed.cards.filter(c => !c.topic).length
      if (untopiced > 0) console.log(`  (no topic → first column): ${untopiced} cards`)
    }
    console.log('\nDry run — preview:')
    console.log(JSON.stringify(parsed.cards.slice(0, 3), null, 2))
    if (parsed.cards.length > 3) console.log(`  ... and ${parsed.cards.length - 3} more`)
    process.exit(0)
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const email = process.env.IMPORT_USER_EMAIL
  const password = process.env.IMPORT_USER_PASSWORD

  if (!supabaseUrl || (!anonKey && !serviceKey)) {
    console.error('Missing VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY)')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, serviceKey ?? anonKey!)

  if (serviceKey && userId) {
    // service role — no login needed
  } else if (email && password && anonKey) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      console.error('Login failed:', error.message)
      process.exit(1)
    }
  } else {
    console.error('Set IMPORT_USER_EMAIL + IMPORT_USER_PASSWORD, or SUPABASE_SERVICE_ROLE_KEY + --user-id=')
    process.exit(1)
  }

  let resolvedBoardId = boardId

  if (!resolvedBoardId) {
    const { data: boards, error } = await supabase
      .from('project_boards')
      .select('id, name')
      .order('sort_order', { ascending: true })

    if (error || !boards?.length) {
      console.error('Could not list boards:', error?.message ?? 'none found')
      process.exit(1)
    }

    console.log('\nAvailable boards:')
    boards.forEach(b => console.log(`  ${b.id}  ${b.name}`))
    console.error('\nPass --board-id=<uuid> to import')
    process.exit(1)
  }

  const { data: columns, error: colError } = await supabase
    .from('project_columns')
    .select('id, name, sort_order')
    .eq('board_id', resolvedBoardId)
    .order('sort_order', { ascending: true })

  if (colError) {
    console.error('Could not list columns:', colError.message)
    process.exit(1)
  }

  const firstColumn = columns?.[0] ?? null
  let columnByTopic: Record<string, string> | undefined

  if (byTopic) {
    const plan = planTopicColumns(parsed.topics, columns ?? [])
    const ensured = await ensureTopicColumns(supabase, resolvedBoardId, plan)
    if (ensured.error) {
      console.error('Could not create topic columns:', ensured.error)
      process.exit(1)
    }
    columnByTopic = ensured.columnByTopic
    console.log(`Importing by topic into ${plan.length} columns (${ensured.created} created)`)
  } else {
    if (!firstColumn) {
      console.error('Could not resolve first column: no columns (use --by-topic to create them)')
      process.exit(1)
    }
    console.log(`Importing into column "${firstColumn.name}" (${firstColumn.id})`)
  }

  const result = await importParsedCards(supabase, resolvedBoardId, firstColumn?.id ?? null, parsed.cards, { skipDuplicates, columnByTopic })

  if (result.errors.length > 0) {
    console.error('Import errors:', result.errors.join('; '))
    process.exit(1)
  }

  console.log(`Done: ${result.created} created, ${result.skipped} skipped`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
