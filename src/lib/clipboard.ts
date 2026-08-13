// Cópia para a área de transferência com fallback. A Clipboard API é bloqueada
// em alguns contextos (webviews, iframes sem permissão `clipboard-write`,
// origens não seguras) — nesses casos cai no execCommand, que ainda funciona.
// Retorna false quando as duas rotas falham, para quem chama avisar o usuário.
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // segue para o fallback
  }

  try {
    const area = document.createElement('textarea')
    area.value = text
    // Fora da tela e sem foco visível, mas ainda selecionável.
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
