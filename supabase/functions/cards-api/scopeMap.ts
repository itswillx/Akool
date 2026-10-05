import type { ScopeLevel } from "../_api/catalog.ts";
import { describeScope } from "../_api/catalog.ts";

/**
 * API-001: permissão que cada ação da cards-api exige do token
 * (docs/api-arquitetura.md §6). O token migrado (Quadros e Cards: Ler, Fila:
 * Escrever) roda o /fila inteiro; validar exige Validação e converter o quadro
 * exige Quadros: Excluir. Nada de Deno aqui: o Vitest testa este arquivo.
 */
export interface ScopeRequirement {
  sub: string;
  level: ScopeLevel;
}

const FILA_WRITE: ScopeRequirement = { sub: "projetos.fila", level: "write" };

export const ACTION_SCOPES: Readonly<Record<string, ScopeRequirement>> = {
  "boards": { sub: "projetos.quadros", level: "read" },
  "cards.list": { sub: "projetos.cards", level: "read" },
  "card.get": { sub: "projetos.cards", level: "read" },
  "queue.list": { sub: "projetos.fila", level: "read" },
  "queue.enqueue": FILA_WRITE,
  "queue.next": FILA_WRITE,
  "queue.remove": FILA_WRITE,
  "queue.reprioritize": FILA_WRITE,
  "queue.start": FILA_WRITE,
  "queue.move": FILA_WRITE,
  "card.note": FILA_WRITE,
  "card.check": FILA_WRITE,
  "card.complete": FILA_WRITE,
  "card.block": FILA_WRITE,
  "card.release": FILA_WRITE,
  "card.validate": { sub: "projetos.validacao", level: "write" },
  "board.setup_flow": { sub: "projetos.quadros", level: "delete" },
};

/** Corpo do 403. A CLI mostra só `error`, então a mensagem diz o que falta e onde liberar. */
export function insufficientScope(req: ScopeRequirement): { error: string; code: string; required: string } {
  return {
    error: `Este token não tem a permissão ${describeScope(req.sub, req.level)}. ` +
      "Libere editando o token ou gerando outro em Configurações → API.",
    code: "insufficient_scope",
    required: `${req.sub}:${req.level}`,
  };
}
