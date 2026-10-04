import { MIN_PASSWORD_LENGTH } from '../lib/passwordPolicy'
import type { Lang } from './translations'

// Texto do painel ao lado do cartão nas telas de entrada (AuthContextPanel):
// muda com a tela (entrar, criar conta, recuperar, código do MFA, senha nova).
// Fora do dicionário, que vai no boot: só o chunk das telas de entrada carrega
// isto. Tudo aqui descreve o app como ele é (levantamento de 2026-10-03):
// convite de 8 caracteres, válido por 7 dias e de uso único, 2 por conta nova;
// verificação em duas etapas opcional (Configurações → Segurança) e pedida a
// cada novo login; login de novo ao abrir o app num novo dia. A validade do
// link de recuperação é configuração do projeto: não citar.

export type AuthPanelContext = 'signin' | 'signup' | 'forgot' | 'mfa' | 'reset'

export interface AuthPanelItem {
  title: string
  text: string
}

export interface AuthPanel {
  title: string
  lead: string
  /** points: lista com ícones; steps: passos numerados. */
  kind: 'points' | 'steps'
  items: [AuthPanelItem, AuthPanelItem, AuthPanelItem]
  note: string
}

export const authContent: Record<Lang, Record<AuthPanelContext, AuthPanel>> = {
  'pt-BR': {
    signin: {
      title: 'Seu workspace continua de onde você parou',
      lead: 'O que você cria fica salvo na sua conta e abre no celular ou no computador.',
      kind: 'points',
      items: [
        { title: 'Páginas e desenhos', text: 'Notas em blocos e desenhos no Excalidraw, com salvamento automático.' },
        { title: 'Projetos', text: 'Quadros em kanban, lista, visão geral e cronograma.' },
        { title: 'Finanças e estudos', text: 'Contas, orçamentos e metas ao lado dos seus roteiros de estudo.' },
      ],
      note: 'Por segurança, o login é pedido de novo ao abrir o app num novo dia; com a verificação em duas etapas ligada, o código também.',
    },
    signup: {
      title: 'Crie sua conta em 3 passos',
      lead: 'O cadastro é só com convite: você precisa de um código de quem já usa o Akool.',
      kind: 'steps',
      items: [
        { title: 'Consiga um código de convite', text: 'Quem já usa o Akool gera o código em Configurações → Convites. Ele tem 8 caracteres, vale por 7 dias e serve para um cadastro.' },
        { title: 'Cadastre e-mail e senha', text: `A senha precisa de pelo menos ${MIN_PASSWORD_LENGTH} caracteres, com letra maiúscula, minúscula e número.` },
        { title: 'Confirme o e-mail e entre', text: 'Abra o link de confirmação que chega por e-mail. Depois, se quiser, ligue a verificação em duas etapas em Configurações → Segurança.' },
      ],
      note: 'Cada conta nova também ganha 2 convites para chamar outras pessoas.',
    },
    forgot: {
      title: 'Recuperar o acesso',
      lead: 'Em três passos você volta para a sua conta.',
      kind: 'steps',
      items: [
        { title: 'Informe o e-mail da conta', text: 'Use o mesmo e-mail do cadastro.' },
        { title: 'Abra o link do e-mail', text: 'Se não chegar em alguns minutos, olhe a caixa de spam ou peça outro envio.' },
        { title: 'Defina uma senha nova', text: 'Com a verificação em duas etapas ligada, o código é pedido antes. Ao salvar, você já entra no app.' },
      ],
      note: 'Por privacidade, a resposta é a mesma exista ou não uma conta com esse e-mail.',
    },
    mfa: {
      title: 'Verificação em duas etapas',
      lead: 'Além da senha, sua conta pede um código do app autenticador.',
      kind: 'steps',
      items: [
        { title: 'Abra o app autenticador', text: 'O mesmo em que você leu o QR code ao ligar a verificação.' },
        { title: 'Procure a entrada com o seu e-mail', text: 'Digite o código de 6 dígitos que aparece nela.' },
        { title: 'Use o código mais recente', text: 'Ele muda a cada 30 segundos.' },
      ],
      note: 'O código é pedido a cada novo login e antes de trocar a senha pelo link de recuperação.',
    },
    reset: {
      title: 'Escolha uma senha forte',
      lead: 'Algumas dicas para uma senha que só você sabe.',
      kind: 'points',
      items: [
        { title: `Pelo menos ${MIN_PASSWORD_LENGTH} caracteres`, text: 'Com letra maiúscula, minúscula e número.' },
        { title: 'Uma senha só para o Akool', text: 'Não repita a senha que você usa em outros sites.' },
        { title: 'Um gerenciador de senhas ajuda', text: 'Ele cria uma senha forte e lembra dela por você.' },
      ],
      note: 'Ao salvar, você já entra no app.',
    },
  },
  en: {
    signin: {
      title: 'Your workspace picks up where you left off',
      lead: 'What you create is saved to your account and opens on your phone or your computer.',
      kind: 'points',
      items: [
        { title: 'Pages and drawings', text: 'Block notes and Excalidraw drawings, saved automatically.' },
        { title: 'Projects', text: 'Boards as kanban, list, overview and timeline.' },
        { title: 'Finance and studies', text: 'Accounts, budgets and goals next to your study roadmaps.' },
      ],
      note: 'For security, you sign in again when you open the app on a new day; with two-step verification on, the code is asked too.',
    },
    signup: {
      title: 'Create your account in 3 steps',
      lead: 'Sign-up is invite-only: you need a code from someone who already uses Akool.',
      kind: 'steps',
      items: [
        { title: 'Get an invite code', text: 'Someone who already uses Akool generates it in Settings → Invites. It has 8 characters, lasts 7 days and works for one sign-up.' },
        { title: 'Choose an email and a password', text: `The password needs at least ${MIN_PASSWORD_LENGTH} characters, with an uppercase letter, a lowercase letter and a number.` },
        { title: 'Confirm your email and sign in', text: 'Open the confirmation link we email you. Then, if you want, turn on two-step verification in Settings → Security.' },
      ],
      note: 'Every new account also gets 2 invites to bring other people in.',
    },
    forgot: {
      title: 'Get back into your account',
      lead: 'Three steps and you are back in.',
      kind: 'steps',
      items: [
        { title: 'Enter your account email', text: 'Use the same email you signed up with.' },
        { title: 'Open the link in the email', text: 'If it does not arrive in a few minutes, check your spam folder or ask for another one.' },
        { title: 'Set a new password', text: 'With two-step verification on, the code is asked first. When you save it, you go straight into the app.' },
      ],
      note: 'For privacy, the answer is the same whether or not there is an account with that email.',
    },
    mfa: {
      title: 'Two-step verification',
      lead: 'Besides your password, your account asks for a code from your authenticator app.',
      kind: 'steps',
      items: [
        { title: 'Open your authenticator app', text: 'The one you scanned the QR code with when you turned verification on.' },
        { title: 'Find the entry with your email', text: 'Type the 6-digit code shown in it.' },
        { title: 'Use the latest code', text: 'It changes every 30 seconds.' },
      ],
      note: 'The code is asked at every new sign-in and before you change the password from the recovery link.',
    },
    reset: {
      title: 'Pick a strong password',
      lead: 'A few tips for a password only you know.',
      kind: 'points',
      items: [
        { title: `At least ${MIN_PASSWORD_LENGTH} characters`, text: 'With an uppercase letter, a lowercase letter and a number.' },
        { title: 'A password just for Akool', text: 'Do not reuse the password you use on other sites.' },
        { title: 'A password manager helps', text: 'It creates a strong password and remembers it for you.' },
      ],
      note: 'When you save it, you go straight into the app.',
    },
  },
}
