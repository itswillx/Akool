import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { formatCardMarkdown, formatQueueLines, type ApiCard, type CardQueueItem } from '../src/lib/cardQueue.ts'

// Cliente da edge function cards-api (fila de desenvolvimento). Usado pelo
// Claude Code no ciclo /fila; também serve para montar a fila à mão.

function loadEnvFile(path: string) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
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

const USAGE = `Uso: npm run cards -- <comando> [opções]

Comandos:
  boards                                   quadros acessíveis, colunas e tamanho da fila
  cards [--column=] [--priority=] [--label=] [--all]
                                           cards abertos (ou todos com --all)
  card <ID>                                card completo em Markdown (ID do backlog ou uuid)
  enqueue [--card=SEC-001,SEC-002] [--column=Segurança] [--priority=P0,P1] [--label=rls]
                                           põe cards na fila (explícitos OU filtros combinados).
                                           A fila é priorizada: cada card entra depois dos de
                                           prioridade igual ou maior; no empate, esforço S → M → L.
                                           Bloqueados só voltam por --card.
  reprioritize                             reordena a fila por prioridade e esforço (desfaz ajustes)
  queue [--status=queued,in_progress]      fila do quadro
  next [--count=3]                         sem --count: retoma o card em andamento ou inicia o próximo;
                                           com --count: lote, completa até N cards em andamento
                                           (fase: avaliação) e mostra todos
  note <ID> --phase=avaliacao|plano|aprovado|desenvolvimento [--note="..." | --note-file=arquivo.md]
                                           registra a fase do fluxo e anexa o texto ao card
                                           (aprovado = plano aprovado, esperando a vez no lote)
  move <ID> <posição>                      reordena um card que está na fila (1 = próximo)
  check <ID> <item...> [--undo]            marca subtarefas (id ou posição 1, 2, 3…)
  complete <ID> [--note="..." | --note-file=nota.md]
                                           parte da IA feita: com o fluxo, vai para Validação
                                           (o usuário aprova); sem o fluxo, conclui direto
  validate <ID> [--reject --note="motivo"] aprova (conclui) ou reprova (volta ao topo da fila)
  block <ID> (--note="..." | --note-file=nota.md) [--user-items=1,2] [--user-item="texto"]...
                                           aguardando você: marca itens do usuário (existentes por
                                           posição/id ou novos); quando ele marcar todos, o card
                                           volta sozinho para a fila. Em card já bloqueado,
                                           atualiza as pendências
  release <ID> [--note="..."]              devolve um card em andamento à fila (plano não aprovado)
  setup-flow                               converte o quadro para o fluxo por fases (só o dono):
                                           A fazer → Avaliação → Plano → Desenvolvimento →
                                           Validação → Concluído, mais "Aguardando você"
  remove <queueId>                         cancela um item da fila

Opções gerais:
  --board=<uuid>   quadro (padrão: AKOOL_BOARD_ID)
  --json           imprime a resposta crua

Ambiente (.env.local):
  VITE_SUPABASE_URL, AKOOL_API_TOKEN (Configurações → API), AKOOL_BOARD_ID (opcional)
`

interface Parsed {
  command: string | null
  positional: string[]
  flags: Record<string, string | true>
  /** Todos os valores de cada flag, na ordem (flags repetíveis como --user-item). */
  repeated: Record<string, string[]>
}

function parseArgs(argv: string[]): Parsed {
  const positional: string[] = []
  const flags: Record<string, string | true> = {}
  const repeated: Record<string, string[]> = {}
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      if (eq === -1) flags[arg.slice(2)] = true
      else {
        const key = arg.slice(2, eq)
        flags[key] = arg.slice(eq + 1)
        ;(repeated[key] ??= []).push(arg.slice(eq + 1))
      }
    } else {
      positional.push(arg)
    }
  }
  return { command: positional.shift() ?? null, positional, flags, repeated }
}

function list(value: string | true | undefined): string[] | undefined {
  if (typeof value !== 'string') return undefined
  const items = value.split(',').map(s => s.trim()).filter(Boolean)
  return items.length ? items : undefined
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const url = process.env.VITE_SUPABASE_URL
  const token = process.env.AKOOL_API_TOKEN
  if (!url) fail('VITE_SUPABASE_URL ausente no .env.local')
  if (!token) fail('AKOOL_API_TOKEN ausente. Gere um token em Configurações → API e cole no .env.local.')

  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  if (process.env.VITE_SUPABASE_ANON_KEY) headers.apikey = process.env.VITE_SUPABASE_ANON_KEY

  const res = await fetch(`${url.replace(/\/$/, '')}/functions/v1/cards-api`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...payload }),
  })
  const body = (await res.json().catch(() => null)) as { data?: T; error?: string } | null
  if (!res.ok || !body) fail(`Erro ${res.status}: ${body?.error ?? res.statusText}`)
  return body.data as T
}

function readNote(flags: Parsed['flags']): string | undefined {
  if (typeof flags['note-file'] === 'string') return readFileSync(resolve(process.cwd(), flags['note-file']), 'utf8')
  if (typeof flags.note === 'string') return flags.note
  return undefined
}

interface BoardSummary {
  id: string
  name: string
  role: string
  flow?: boolean
  columns: { id: string; name: string; open_cards: number }[]
  queue: { queued: number; in_progress: number; review?: number; blocked: number }
}

interface SetupFlowReport {
  created: string[]
  moved: Record<string, number>
  labels_added: number
  deleted: string[]
  columns: { name: string; open: number; done: number }[]
}

async function main() {
  const { command, positional, flags, repeated } = parseArgs(process.argv.slice(2))
  if (!command || command === 'help' || flags.help) {
    console.log(USAGE)
    return
  }

  const asJson = flags.json === true
  const print = (data: unknown, pretty: () => string) => console.log(asJson ? JSON.stringify(data, null, 2) : pretty())

  if (command === 'boards') {
    const boards = await call<BoardSummary[]>('boards')
    print(boards, () => boards.map(b => [
      `${b.name}  (${b.role})  ${b.id}${b.flow ? '  · fluxo por fases' : ''}`,
      `  fila: ${b.queue.in_progress} em andamento, ${b.queue.queued} na fila, ${b.queue.review ?? 0} em validação, ${b.queue.blocked} aguardando você`,
      ...b.columns.map(c => `  - ${c.name}: ${c.open_cards} abertos`),
    ].join('\n')).join('\n\n') || 'Nenhum quadro.')
    return
  }

  const board = typeof flags.board === 'string' ? flags.board : process.env.AKOOL_BOARD_ID
  if (!board) fail('Informe --board=<uuid> ou AKOOL_BOARD_ID no .env.local (veja `npm run cards -- boards`).')

  const cardRef = () => positional[0] ?? fail(`Uso: npm run cards -- ${command} <ID>`)

  switch (command) {
    case 'cards': {
      const cards = await call<{ external_id: string | null; title: string; column: string; priority: string; checklist_done: number; checklist_total: number }[]>('cards.list', {
        board,
        columns: list(flags.column),
        priorities: list(flags.priority),
        labels: list(flags.label),
        completed: flags.all ? 'all' : false,
      })
      print(cards, () => cards.map(c => `${c.priority.padEnd(7)} ${c.title}  [${c.column}] ${c.checklist_done}/${c.checklist_total}`).join('\n') || 'Nenhum card.')
      return
    }
    case 'card': {
      const card = await call<ApiCard>('card.get', { board, card: cardRef() })
      print(card, () => formatCardMarkdown(card))
      return
    }
    case 'enqueue': {
      const rows = await call<unknown[]>('queue.enqueue', {
        board,
        cards: list(flags.card),
        columns: list(flags.column),
        priorities: list(flags.priority),
        labels: list(flags.label),
      })
      const queue = await call<CardQueueItem[]>('queue.list', { board, status: ['in_progress', 'queued'] })
      print({ added: rows, queue }, () => [`${rows.length} card(s) adicionados à fila.`, '', ...formatQueueLines(queue)].join('\n'))
      return
    }
    case 'reprioritize': {
      const items = await call<CardQueueItem[]>('queue.reprioritize', { board })
      print(items, () => ['Fila reordenada por prioridade e esforço.', '', ...formatQueueLines(items)].join('\n'))
      return
    }
    case 'queue': {
      const items = await call<CardQueueItem[]>('queue.list', { board, status: list(flags.status) })
      print(items, () => formatQueueLines(items).join('\n'))
      return
    }
    case 'next': {
      if (flags.count !== undefined) {
        const count = Number(flags.count)
        if (!Number.isInteger(count) || count < 1 || count > 10) fail('Use --count=N com N de 1 a 10.')
        const cards = await call<ApiCard[]>('queue.start', { board, count })
        print(cards, () => cards.length === 0
          ? 'Fila vazia: nada para iniciar.'
          : [`Lote: ${cards.length} card(s) em andamento.`, ...cards.map(formatCardMarkdown)].join('\n\n---\n\n'))
        return
      }
      const card = await call<ApiCard | null>('queue.next', { board })
      print(card, () => (card ? formatCardMarkdown(card) : 'Fila vazia: nada para iniciar.'))
      return
    }
    case 'note': {
      const phase = typeof flags.phase === 'string' ? flags.phase : fail('Informe --phase=avaliacao|plano|aprovado|desenvolvimento')
      const card = await call<ApiCard>('card.note', { board, card: cardRef(), phase, text: readNote(flags) })
      print(card, () => `Fase registrada: ${phase} · ${card.title}`)
      return
    }
    case 'move': {
      const position = Number(positional[1])
      if (!Number.isInteger(position) || position < 1) fail('Uso: npm run cards -- move <ID> <posição>')
      const card = await call<ApiCard>('card.get', { board, card: cardRef() })
      if (card.queue?.status !== 'queued') fail(`${card.title} não está aguardando na fila.`)
      await call('queue.move', { queue_id: card.queue.id, position })
      const items = await call<CardQueueItem[]>('queue.list', { board, status: ['in_progress', 'queued'] })
      print(items, () => formatQueueLines(items).join('\n'))
      return
    }
    case 'check': {
      const ref = cardRef()
      const items = positional.slice(1)
      if (items.length === 0) fail('Uso: npm run cards -- check <ID> <item...> [--undo]')
      const card = await call<ApiCard>('card.check', { board, card: ref, items, done: !flags.undo })
      print(card, () => formatCardMarkdown(card))
      return
    }
    case 'complete': {
      const card = await call<ApiCard>('card.complete', { board, card: cardRef(), note: readNote(flags) })
      print(card, () => card.queue?.status === 'review'
        ? `Enviado para validação: ${card.title} → ${card.column}`
        : `Concluído: ${card.title} → ${card.column}`)
      return
    }
    case 'validate': {
      const approve = !flags.reject
      const note = readNote(flags)
      if (!approve && !note) fail('Para reprovar, informe o motivo com --note ou --note-file.')
      const card = await call<ApiCard>('card.validate', { board, card: cardRef(), approve, note })
      print(card, () => approve
        ? `Aprovado e concluído: ${card.title} → ${card.column}`
        : `Reprovado: ${card.title} voltou ao topo da fila.`)
      return
    }
    case 'block': {
      const note = readNote(flags) ?? fail('Informe o motivo com --note ou --note-file.')
      const card = await call<ApiCard>('card.block', {
        board,
        card: cardRef(),
        note,
        user_items: repeated['user-item'],
        user_refs: list(flags['user-items']),
      })
      const mine = card.checklist.filter(i => i.owner === 'user' && !i.completed)
      print(card, () => [
        `Aguardando você: ${card.title} → ${card.column}`,
        ...mine.map(i => `  - [ ] ${i.text}`),
      ].join('\n'))
      return
    }
    case 'release': {
      const card = await call<ApiCard>('card.release', { board, card: cardRef(), note: readNote(flags) })
      print(card, () => `Devolvido à fila: ${card.title} → ${card.column}`)
      return
    }
    case 'setup-flow': {
      const report = await call<SetupFlowReport>('board.setup_flow', { board })
      print(report, () => [
        `Colunas criadas: ${report.created.join(', ') || 'nenhuma'}`,
        `Cards movidos: ${Object.entries(report.moved).map(([col, n]) => `${col} ${n}`).join(', ') || 'nenhum'}`,
        `Labels de tema acrescentadas: ${report.labels_added}`,
        `Colunas apagadas (vazias): ${report.deleted.join(', ') || 'nenhuma'}`,
        '',
        ...report.columns.map(c => `  - ${c.name}: ${c.open} abertos${c.done ? `, ${c.done} concluídos` : ''}`),
      ].join('\n'))
      return
    }
    case 'remove': {
      await call('queue.remove', { queue_id: cardRef() })
      console.log('Item removido da fila.')
      return
    }
    default:
      fail(`Comando desconhecido: ${command}\n\n${USAGE}`)
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
