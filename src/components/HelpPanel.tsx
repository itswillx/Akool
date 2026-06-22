import {
  FileText, Pencil, Layers, CheckSquare, Share2, FileDown, Wallet, HelpCircle,
} from 'lucide-react'

interface HelpCardProps {
  icon: React.ReactNode
  title: string
  description: string
  color: string
}

function HelpCard({ icon, title, description, color }: HelpCardProps) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', padding: '24px', borderRadius: 16,
      border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)',
      transition: 'transform 0.2s, box-shadow 0.2s', cursor: 'default'
    }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = '0 12px 24px -10px rgba(0,0,0,0.1)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <div style={{
        width: 48, height: 48, borderRadius: 12, backgroundColor: `${color}15`,
        color: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 16
      }}>
        {icon}
      </div>
      <h3 style={{ margin: '0 0 8px 0', fontSize: 16, fontWeight: 600, color: 'var(--color-text)' }}>
        {title}
      </h3>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
        {description}
      </p>
    </div>
  )
}

export default function HelpPanel() {

  const features = [
    {
      icon: <FileText size={24} />,
      title: 'Notas e Documentos',
      description: 'Crie documentos ricos utilizando blocos de texto, imagens, formatações variadas e atalhos rápidos de Markdown.',
      color: '#3b82f6'
    },
    {
      icon: <Pencil size={24} />,
      title: 'Desenhos e Diagramas',
      description: 'Construa fluxogramas, wireframes e ilustrações usando um quadro interativo com suporte completo ao Excalidraw.',
      color: '#8b5cf6'
    },
    {
      icon: <Layers size={24} />,
      title: 'Nota e Desenho (Split View)',
      description: 'Trabalhe lado a lado com suas anotações e desenhos em uma tela dividida sincronizada.',
      color: '#ec4899'
    },
    {
      icon: <CheckSquare size={24} />,
      title: 'Listas de Tarefas (To-Do)',
      description: 'Organize o que precisa ser feito com status de conclusão, prazos de entrega e indicadores visuais de atraso.',
      color: '#f59e0b'
    },
    {
      icon: <Wallet size={24} />,
      title: 'Controle Financeiro',
      description: 'Gerencie contas, acompanhe despesas e receitas, crie metas e orçamentos num painel financeiro completo.',
      color: '#10b981'
    },
    {
      icon: <Share2 size={24} />,
      title: 'Compartilhamento',
      description: 'Convide outras pessoas para trabalharem junto com você, definindo papéis como visualizador, editor ou co-proprietário.',
      color: '#14b8a6'
    },
    {
      icon: <FileDown size={24} />,
      title: 'Exportação para PDF',
      description: 'Exporte de maneira prática todos os seus projetos e informações para formato PDF e acesse offline.',
      color: '#ef4444'
    }
  ]

  return (
    <div style={{ flex: 1, overflow: 'auto', backgroundColor: 'var(--color-bg-tertiary)' }}>
      <div style={{ maxWidth: 1160, margin: '0 auto', padding: '32px 32px 80px' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, backgroundColor: 'var(--color-primary)',
            color: 'var(--color-btn-primary-text)', display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <HelpCircle size={22} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: 'var(--color-text)' }}>
              Ajuda e Funcionalidades
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>
              Conheça tudo o que você pode fazer com o Akool.
            </p>
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 20
        }}>
          {features.map((feature, i) => (
            <HelpCard
              key={i}
              icon={feature.icon}
              title={feature.title}
              description={feature.description}
              color={feature.color}
            />
          ))}
        </div>

      </div>
    </div>
  )
}
