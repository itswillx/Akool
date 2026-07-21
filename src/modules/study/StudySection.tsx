import { useMemo, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../i18n/LanguageContext'
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal'
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
  onConfirm: () => void
}

export default function StudySection({ isMobile = false }: StudySectionProps) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const store = useStudyTopics(user?.id)
  const [view, setView] = useState<StudyViewName>('overview')
  const [openTopicId, setOpenTopicId] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteRequest | null>(null)

  // Derived: if the open topic disappears (deleted), openTopic is null and
  // the views render again — no cleanup effect needed.
  const openTopic = openTopicId ? store.topics.find(topic => topic.id === openTopicId) ?? null : null
  const overdueCount = useMemo(() => store.topics.filter(topic => isTopicOverdue(topic)).length, [store.topics])

  const requestDelete = (title: string, message: string, onConfirm: () => void) => {
    setDeleteConfirm({ title, message, onConfirm })
  }

  const content = openTopic ? (
    <StudyTopicDetail
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
          const topic = await store.createTopicFromImport(parsed, form)
          if (topic) {
            setNewOpen(false)
            setOpenTopicId(topic.id)
          }
          return !!topic
        }}
      />

      <ConfirmDeleteModal
        open={!!deleteConfirm}
        title={deleteConfirm?.title ?? t('study_delete_topic_title')}
        message={deleteConfirm?.message ?? ''}
        onConfirm={() => {
          deleteConfirm?.onConfirm()
          setDeleteConfirm(null)
        }}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  )
}
