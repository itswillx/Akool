import { useEffect, useRef, useState } from 'react'
import { deviceToday, materializeRecurring } from '../../lib/data/financeRecurring'
import { currentYM } from './financeFormat'
import { autoBudgetSourcesKey, viewedMonthNeedsBudgets } from './financeLoad'
import type { useFinanceData } from './useFinanceData'

// API-016: os orçamentos automáticos do mês visto. O servidor cria os do mês
// atual e do seguinte (cron e carga); o app antigo criava, no navegador, o do
// mês aberto na tela, qualquer que fosse. Ao ver outro mês, a tela pede ao
// servidor os orçamentos dele (a até 12 meses do atual, nunca antes da criação
// do recorrente, nunca lançamento) e mescla o que voltou. Sai pedido de novo
// quando um recorrente que gera orçamento muda; a resposta de um mês que a
// tela já deixou é descartada.
//
// "Fora da janela" é medido contra a janela que está no estado
// (`materializedYM`, a data da última carga ou materialização), não contra o
// relógio: com a tela aberta na virada do mês, o mês seguinte ao novo atual
// ainda não chegou ao estado. A virada (no foco, ao voltar para a aba, ou a
// cada troca de mês na tela) materializa de novo, sem p_month, na data nova:
// chegam os lançamentos e os orçamentos da janela nova.
export function useViewedMonthBudgets({ data, month }: { data: ReturnType<typeof useFinanceData>; month: string }) {
  const { loading, recurring, applyMaterialized, materializedYM } = data
  const sourcesKey = autoBudgetSourcesKey(recurring)
  const focusYM = useMonthOnFocus()

  // O mês da virada já pedido, para não repetir a chamada enquanto ela não
  // volta. Falha libera para tentar de novo no próximo foco ou troca de mês.
  const turnRef = useRef<string | null>(null)
  useEffect(() => {
    if (loading || !sourcesKey || !materializedYM) return
    const today = deviceToday()
    const ym = today.slice(0, 7)
    if (ym === materializedYM) { turnRef.current = null; return }
    if (turnRef.current === ym) return
    turnRef.current = ym
    void materializeRecurring(today).then(({ data: result, error }) => {
      if (error) {
        console.error('[finance] month turn materialize failed', error)
        turnRef.current = null
      } else if (result) applyMaterialized(result, today)
    })
    // `month` e `focusYM` só disparam a conferência do relógio.
  }, [loading, sourcesKey, materializedYM, month, focusYM, applyMaterialized])

  useEffect(() => {
    if (loading || !sourcesKey || !viewedMonthNeedsBudgets(month, materializedYM ?? currentYM())) return
    let cancelled = false
    const today = deviceToday()
    void materializeRecurring(today, month).then(({ data: result, error }) => {
      if (cancelled) return
      if (error) console.error('[finance] viewed month budgets failed', error)
      else if (result) applyMaterialized(result, today)
    })
    return () => { cancelled = true }
  }, [loading, sourcesKey, month, materializedYM, applyMaterialized])
}

/** O mês do aparelho, relido quando a janela ganha o foco ou a aba volta a ficar visível. */
function useMonthOnFocus(): string {
  const [ym, setYm] = useState(currentYM)
  useEffect(() => {
    const sync = () => { if (document.visibilityState !== 'hidden') setYm(currentYM()) }
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])
  return ym
}
