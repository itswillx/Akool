// Regras de ESLint do próprio projeto (ligadas em eslint.config.js para src/).
import { noDiscardedSupabaseWrite } from './eslint-no-discarded-supabase-write.mjs'
import { buttonHasName } from './eslint-button-has-name.mjs'
import { noLiteralJsxText } from './eslint-no-literal-jsx-text.mjs'
import { noHexColor } from './eslint-no-hex-color.mjs'

export default {
  meta: { name: 'akool' },
  rules: {
    'no-discarded-supabase-write': noDiscardedSupabaseWrite,
    'button-has-name': buttonHasName,
    'no-literal-jsx-text': noLiteralJsxText,
    'no-hex-color': noHexColor,
  },
}
