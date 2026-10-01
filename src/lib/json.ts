import type { Json } from '../types/database'

// ARCH-004: RPCs que devolvem jsonb chegam tipadas como `Json`. Antes de ler
// um campo, confira que é mesmo um objeto (e não lista, texto ou null).

export type JsonObject = { [key: string]: Json | undefined }

export function isJsonObject(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
