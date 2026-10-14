import { useMemo, useState } from 'react'
import { useModuleTour } from '../../hooks/useModuleTour'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../i18n/LanguageContext'
import ConfirmDeleteModal from '@/shared/ui/ConfirmDeleteModal'
import { isTopicOverdue } from '../../lib/studyProgress'
import { useStudyTopics } from './useStudyTopics'
import StudyNav, { type StudyViewName } from './StudyNav'
import StudyOverview from './StudyOverview'
import StudyTopicList from './StudyTopicList'
import StudyHistory from './StudyHistory'
import StudyStats from './StudyStats'
import StudyPlanning from './StudyPlanning'
import StudyTopicDetail from './StudyTopicDetail'
import NewStudyTopicModal from './NewStudyTopicModal'

// "Estudos" mini-app, mounted inside the Documents workspace. Internal nav
// (grouped rail on desktop, chips on mobile) switches between the tracking
// views; opening a topic swaps the content area for the focus detail view.
// One ConfirmDeleteModal at the root serves every destructive action.

interface StudySectionProps {
  isMobile?: boolean
}

interface DeleteRequest {
  title: string
  message: string
  // As ações do store tratam o próprio erro (toast); aqui é só disparar.
  onConfirm: () => void | Promise<void>
}

export default function StudySection({ isMobile = false }: StudySectionProps) {
  const { user } = useAuth()
  const { t } = useLanguage()
  useModuleTour('study')
  const store = useStudyTopics(user?.id)
  const [view, setView] = useState<StudyViewName>('overview')
  const [openTopicId, setOpenTopicId] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteRequest | null>(null)

  // Derived: if the open topic disappears (deleted), openTopic is null and
  // the views render again — no cleanup effect needed. API-029: deleted in
  // another tab (a refetch no longer brings it), a notice says so instead.
  const openTopic = openTopicId ? store.topics.find(topic => topic.id === openTopicId) ?? null : null
  const openTopicGone = openTopicId !== null && !openTopic && store.goneTopicIds.has(openTopicId)
  const overdueCount = useMemo(() => store.topics.filter(topic => isTopicOverdue(topic)).length, [store.topics])

  const requestDelete = (title: string, message: string, onConfirm: DeleteRequest['onConfirm']) => {
    setDeleteConfirm({ title, message, onConfirm })
  }

  const content = openTopicGone ? (
    <div role="status" style={{ padding: isMobile ? 16 : 24, maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
      <p style={{ margin: 0, fontSize: 13.5, color: 'var(--color-text)' }}>{t('study_topic_deleted_elsewhere')}</p>
      <button
        type="button"
        onClick={() => setOpenTopicId(null)}
        style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
      >
        {t('study_back')}
      </button>
    </div>
  ) : openTopic ? (
    <StudyTopicDetail
      key={openTopic.id}
      topic={openTopic}
      cards={store.cardsByTopic[openTopic.id] ?? []}
      logs={store.logsByTopic[openTopic.id] ?? []}
      store={store}
      requestDelete={requestDelete}
      onBack={() => setOpenTopicId(null)}
      isMobile={isMobile}
    />
  ) : view === 'overview' ? (
    <StudyOverview
      topics={store.topics}
      cardsByTopic={store.cardsByTopic}
      logsByTopic={store.logsByTopic}
      loading={store.loading}
      onOpenTopic={setOpenTopicId}
      onGoTopics={() => setView('topics')}
      isMobile={isMobile}
    />
  ) : view === 'topics' ? (
    <StudyTopicList
      topics={store.topics}
      cardsByTopic={store.cardsByTopic}
      loading={store.loading}
      onOpen={setOpenTopicId}
      onNew={() => setNewOpen(true)}
      isMobile={isMobile}
    />
  ) : view === 'history' ? (
    <StudyHistory
      topics={store.topics}
      logsByTopic={store.logsByTopic}
      onOpenTopic={setOpenTopicId}
      requestDelete={requestDelete}
      deleteLog={store.deleteLog}
      isMobile={isMobile}
    />
  ) : view === 'stats' ? (
    <StudyStats
      topics={store.topics}
      cardsByTopic={store.cardsByTopic}
      logsByTopic={store.logsByTopic}
      isMobile={isMobile}
    />
  ) : (
    <StudyPlanning
      topics={store.topics}
      cardsByTopic={store.cardsByTopic}
      onOpen={setOpenTopicId}
      onStart={topicId => store.updateTopic(topicId, { status: 'studying' })}
      isMobile={isMobile}
    />
  )

  return (
    <div style={{
      flex: 1, minWidth: 0, minHeight: 0, height: '100%', display: 'flex',
      flexDirection: isMobile ? 'column' : 'row', backgroundColor: 'var(--color-bg)',
    }}>
      <StudyNav
        active={openTopic ? null : view}
        overdueCount={overdueCount}
        onSelect={next => { setOpenTopicId(null); setView(next) }}
        onNew={() => setNewOpen(true)}
        isMobile={isMobile}
      />
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto' }}>
        {/* API-029: o servidor ainda sem as RPCs do API-024 (PGRST202). */}
        {store.serverOutdated && (
          <div role="alert" style={{ margin: isMobile ? '12px 16px 0' : '16px 24px 0', padding: '10px 12px', borderRadius: 8, border: '1px solid color-mix(in srgb, var(--color-error) 33%, transparent)', backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)', color: 'var(--color-text)', fontSize: 12.5 }}>
            {t('study_error_server_outdated')}
          </div>
        )}
        {content}
      </div>

      <NewStudyTopicModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        isMobile={isMobile}
        onCreateManual={async form => {
          const topic = await store.createTopicManual(form)
          if (topic) {
            setNewOpen(false)
            setOpenTopicId(topic.id)
          }
          return !!topic
        }}
        onImport={async (parsed, form) => {
          const result = await store.createTopicFromImport(parsed, form)
          if (result.ok) {
            setNewOpen(false)
            setOpenTopicId(result.topic.id)
          }
          return result
        }}
      />

      <ConfirmDeleteModal
        open={!!deleteConfirm}
        title={deleteConfirm?.title ?? t('study_delete_topic_title')}
        message={deleteConfirm?.message ?? ''}
        onConfirm={() => {
          void deleteConfirm?.onConfirm()
          setDeleteConfirm(null)
        }}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  )
}
