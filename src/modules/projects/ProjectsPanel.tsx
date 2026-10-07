import {
    DndContext, DragOverlay
} from '@dnd-kit/core'
import { useModuleTour } from '../../hooks/useModuleTour'
import { horizontalListSortingStrategy, SortableContext } from '@dnd-kit/sortable'
import {
    ChevronDown,
    FolderKanban,
    ListOrdered,
    Pencil,
    Plus,
    Share2,
    Trash2,
    Upload
} from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef } from 'react'
import ConfirmDeleteModal from '@/shared/ui/ConfirmDeleteModal'
import { useLanguage } from '../../i18n/LanguageContext'
import { dndAccessibility } from '../../lib/dndAccessibility'
import type { Page, ProjectCard, ProjectColumn } from '../../types'
import { CardView } from './board/Card'
import { Column, SortableColumn } from './board/Column'
import { CardModal } from './card/CardModal'
import CardFilterBar from './CardFilterBar'
import ImportCardsModal from './ImportCardsModal'
import { BoardModal, ColumnModal, ShareModal } from './modals/BoardModals'
import ProjectsNav from './ProjectsNav'
import { collisionDetection, QueueBadgeContext } from './projectsShared'
import QueueModal from './QueueModal'
import { LoadError, PrimaryBtn } from './ui'
import { useBoardActions } from './useBoardActions'
import { useBoardData } from './useBoardData'
import { useBoardDnd } from './useBoardDnd'
import { CompactKanbanView } from './views/CompactKanbanView'
import { ListView } from './views/ListView'
import { OverviewView } from './views/OverviewView'

// PERF-009: o Gantt só baixa na visão Linha do tempo.
const GanttView = lazy(() => import('./GanttView'))

// PERF-011: referências fixas (a coluna vazia e a do overlay de arrastar).
const NO_CARDS: ProjectCard[] = []
const noop = () => {}

// ─── Main panel ───────────────────────────────────────────────────────────────
// ViewMode/VALID_VIEWS moram no ProjectsNav, como StudyViewName mora no StudyNav.

export default function ProjectsPanel({ isMobile = false, onOpenPage }: {
  isMobile?: boolean
  /** Navegação para a página vinculada a um card. Quando o host fornece
   *  (DocumentsPanel resolve dentro da própria visão), setActivePage não é
   *  chamado — chamar desmontaria a visão Documentos inteira. */
  onOpenPage?: (page: Page) => void
}) {
  const { t } = useLanguage()
  useModuleTour('projects')

  // Estado, carga, realtime e fila do quadro: useBoardData.ts
  const boardData = useBoardData()
  const { boards, activeBoardId, setActiveBoardId, columns, cards, members, view, setView, loading, boardLoading, activeDragId, persistError, cardFilters, setCardFilters, boardError, boardsError, boardModal, setBoardModal, boardSelectorOpen, setBoardSelectorOpen, cardModal, setCardModal, columnModal, setColumnModal, shareOpen, setShareOpen, importOpen, setImportOpen, queueOpen, setQueueOpen, queueRows, queueRefreshKey, deleteConfirm, setDeleteConfirm, activeBoard, canEdit, isOwner, sensors, pLabel, loadBoards, loadBoardData, queueBadgeMap, filteredCards, availableLabels, filtersActive, cardsByColumn } = boardData

  // Gravações (quadros, colunas, cards, fila): useBoardActions.ts
  const boardActions = useBoardActions({ board: boardData, onOpenPage })
  const { createBoard, updateBoard, deleteBoard, enqueueCard, saveColumn, deleteColumn, cardIO, cardColumnId, closeCardModal, finishCardSave, validateCard, deleteCard, openLinkedPage, handleRescheduleCard, handleGenerateSchedule } = boardActions

  // PERF-011: handlers estáveis para o memo das colunas e dos cards segurar.
  const openNewCard = useCallback((columnId: string) => setCardModal({ open: true, card: null, columnId }), [setCardModal])
  const openCard = useCallback((card: ProjectCard) => setCardModal({ open: true, card }), [setCardModal])
  const openRenameColumn = useCallback((column: ProjectColumn) => setColumnModal({ open: true, column }), [setColumnModal])
  const deleteColumnRef = useRef(deleteColumn)
  useEffect(() => { deleteColumnRef.current = deleteColumn })
  const removeColumn = useCallback((column: ProjectColumn) => deleteColumnRef.current(column), [])

  // Arrastar e soltar: useBoardDnd.ts
  const boardDnd = useBoardDnd({ board: boardData })
  const { moveColumnByOffset, handleDragStart, handleDragOver, handleDragEnd, handleDragCancel, handleMoveCardToColumn } = boardDnd

  // ── Render ──
  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-muted)', fontSize: 14 }}>{t('projects_loading')}</div>
  }

  const activeDragCard = activeDragId ? cards.find(c => c.id === activeDragId) : null
  const activeDragColumn = activeDragId ? columns.find(c => c.id === activeDragId) : null
  const dndA11y = dndAccessibility(t, {
    title: id => cards.find(c => c.id === String(id))?.title ?? columns.find(c => c.id === String(id))?.name ?? '',
    target: id => {
      const raw = String(id)
      const colId = raw.startsWith('col:') ? raw.slice(4) : columns.some(c => c.id === raw) ? raw : cards.find(c => c.id === raw)?.column_id
      return columns.find(c => c.id === colId)?.name ?? ''
    },
  })

  return (
    <QueueBadgeContext.Provider value={queueBadgeMap}>
    <div style={{ flex: 1, display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: '100%', minWidth: 0, minHeight: 0, backgroundColor: 'var(--color-bg)', overflow: 'hidden' }}>
      {/* Faixa lateral (desktop) / chips de visualização (mobile) */}
      <ProjectsNav
        boards={boards}
        activeBoardId={activeBoardId}
        view={view}
        isOwner={isOwner}
        isMobile={isMobile}
        onSelectBoard={setActiveBoardId}
        onNewBoard={() => setBoardModal({ open: true, board: null })}
        onSelectView={setView}
        onImport={() => setImportOpen(true)}
        canQueue={canEdit}
        queueCount={queueRows.length}
        onQueue={() => setQueueOpen(true)}
        onShare={() => setShareOpen(true)}
        onEditBoard={() => setBoardModal({ open: true, board: activeBoard })}
        onDeleteBoard={deleteBoard}
      />

      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Cabeçalho slim: só identifica o quadro. Navegação e ações moram na
          faixa lateral; no mobile o seletor de quadros continua dropdown e as
          ações do dono seguem como botões de ícone. */}
      <div style={{ padding: isMobile ? '12px 14px' : '10px 16px', borderBottom: '1px solid var(--color-border)', flexShrink: 0, backgroundColor: 'var(--color-bg-secondary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {isMobile && boards.length > 0 ? (
            <div style={{ position: 'relative' }}>
              <button onClick={() => setBoardSelectorOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', fontSize: 14, fontWeight: 700, color: 'var(--color-text)', maxWidth: 260 }}>
                <span>{activeBoard?.icon}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeBoard?.name ?? t('projects_select_board')}</span>
                {activeBoard?.is_shared && <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-accent)', backgroundColor: 'var(--color-accent-soft)', padding: '1px 5px', borderRadius: 4 }}>{t('projects_shared_badge')}</span>}
                <ChevronDown size={14} style={{ color: 'var(--color-text-muted)' }} />
              </button>
              {boardSelectorOpen && (
                <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 100, minWidth: 240, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', padding: 4, maxHeight: 320, overflowY: 'auto' }}>
                  {boards.map(b => (
                    <button key={b.id} onClick={() => { setActiveBoardId(b.id); setBoardSelectorOpen(false) }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', backgroundColor: b.id === activeBoardId ? 'var(--color-active)' : 'transparent', color: 'var(--color-text)', fontSize: 13, textAlign: 'left' }}>
                      <span>{b.icon}</span><span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                      {b.is_shared && <Share2 size={11} style={{ color: 'var(--color-text-muted)' }} />}
                    </button>
                  ))}
                  <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 4, paddingTop: 4 }}>
                    <button onClick={() => { setBoardModal({ open: true, board: null }); setBoardSelectorOpen(false) }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'transparent', color: 'var(--color-accent)', fontSize: 13, fontWeight: 600, textAlign: 'left' }}>
                      <Plus size={13} />{t('projects_new_board')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : !isMobile && activeBoard ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: 16, lineHeight: 1 }}>{activeBoard.icon}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeBoard.name}</span>
              {activeBoard.is_shared && <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-accent)', backgroundColor: 'var(--color-accent-soft)', padding: '1px 5px', borderRadius: 4, flexShrink: 0 }}>{t('projects_shared_badge')}</span>}
            </div>
          ) : (
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>{t('projects_title')}</h2>
          )}

          {isMobile && activeBoard && canEdit && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => setQueueOpen(true)} title={t('projects_queue')} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: 8, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', color: queueRows.length ? 'var(--color-accent)' : 'var(--color-text-muted)', fontSize: 11, fontWeight: 700 }}>
                <ListOrdered size={13} />{queueRows.length > 0 && queueRows.length}
              </button>
              {isOwner && (<>
              <button onClick={() => setImportOpen(true)} title={t('projects_import')} style={{ display: 'flex', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                <Upload size={13} />
              </button>
              <button onClick={() => setShareOpen(true)} title={t('projects_share')} style={{ display: 'flex', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                <Share2 size={13} />
              </button>
              <button onClick={() => setBoardModal({ open: true, board: activeBoard })} title={t('projects_edit')} style={{ display: 'flex', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                <Pencil size={13} />
              </button>
              <button onClick={deleteBoard} title={t('projects_delete')} style={{ display: 'flex', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', color: '#ef4444' }}>
                <Trash2 size={13} />
              </button>
              </>)}
            </div>
          )}
        </div>
        {!canEdit && activeBoard && (
          <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {t('projects_readonly')}
          </div>
        )}
      </div>

      {activeBoard && boards.length > 0 && !boardLoading && (
        <CardFilterBar
          filters={cardFilters}
          onChange={setCardFilters}
          columns={columns}
          members={members}
          availableLabels={availableLabels}
          isMobile={isMobile}
        />
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {boardsError && boards.length === 0 ? (
          <LoadError message={t('projects_boards_load_error')} retryLabel={t('common_error_retry')} onRetry={() => { void loadBoards() }} />
        ) : boards.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, backgroundColor: 'var(--color-accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FolderKanban size={28} color="var(--color-accent)" /></div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>{t('projects_no_boards_title')}</h3>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--color-text-muted)', maxWidth: 360 }}>{t('projects_no_boards_desc')}</p>
            <PrimaryBtn onClick={() => setBoardModal({ open: true, board: null })}>{t('projects_create_board')}</PrimaryBtn>
          </div>
        ) : boardLoading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>{t('projects_loading')}</div>
        ) : boardError ? (
          <LoadError message={t('projects_board_load_error')} retryLabel={t('common_error_retry')}
            onRetry={() => { if (activeBoardId) void loadBoardData(activeBoardId, { silent: false }) }} />
        ) : filtersActive && filteredCards.length === 0 && cards.length > 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)' }}>{t('projects_empty_filter')}</p>
          </div>
        ) : view === 'kanban' ? (
          <>
            {persistError && (
              <div style={{ margin: '0 16px', padding: '8px 12px', borderRadius: 8, backgroundColor: '#ef44441a', color: '#ef4444', fontSize: 12.5, fontWeight: 600 }}>
                {persistError}
              </div>
            )}
          <DndContext sensors={sensors} collisionDetection={collisionDetection} accessibility={dndA11y} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
            <div style={{ flex: 1, display: 'flex', gap: 12, padding: 16, overflowX: 'auto', overflowY: 'hidden', alignItems: 'stretch' }}>
              <SortableContext items={columns.map(c => c.id)} strategy={horizontalListSortingStrategy}>
                {columns.map(col => (
                  <SortableColumn
                    key={col.id} column={col} cards={cardsByColumn[col.id] ?? NO_CARDS} canEdit={canEdit} priorityLabel={pLabel}
                    onAddCard={openNewCard}
                    onCardClick={openCard}
                    onRename={openRenameColumn}
                    onDelete={removeColumn}
                  />
                ))}
              </SortableContext>
              {canEdit && (
                <button onClick={() => setColumnModal({ open: true, column: null })} style={{ width: 200, minWidth: 200, height: 'fit-content', display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px', borderRadius: 10, border: '1px dashed var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 13, cursor: 'pointer' }}>
                  <Plus size={14} />{t('projects_add_column')}
                </button>
              )}
            </div>
            <DragOverlay>
              {activeDragColumn ? (
                <div style={{ width: 290, opacity: 0.9, cursor: 'grabbing' }}>
                  <Column
                    column={activeDragColumn} cards={cardsByColumn[activeDragColumn.id] ?? NO_CARDS} canEdit={false} priorityLabel={pLabel}
                    onAddCard={noop} onCardClick={noop} onRename={noop} onDelete={noop}
                  />
                </div>
              ) : activeDragCard ? <div style={{ width: 274 }}><CardView card={activeDragCard} priorityLabel={pLabel(activeDragCard.priority)} dragging /></div> : null}
            </DragOverlay>
          </DndContext>
          </>
        ) : view === 'compact' ? (
          <CompactKanbanView
            boardId={activeBoardId!}
            columns={columns}
            cardsByColumn={cardsByColumn}
            canEdit={canEdit}
            priorityLabel={pLabel}
            sensors={sensors}
            accessibility={dndA11y}
            persistError={persistError}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
            activeDragCard={activeDragCard}
            pLabel={pLabel}
            onAddCard={openNewCard}
            onCardClick={openCard}
            onRename={openRenameColumn}
            onDelete={removeColumn}
            onMoveCardToColumn={handleMoveCardToColumn}
            onReorderColumn={canEdit ? moveColumnByOffset : undefined}
          />
        ) : view === 'timeline' ? (
          <Suspense fallback={<div style={{ flex: 1 }} />}>
          <GanttView
            columns={columns}
            cards={filteredCards}
            canEdit={canEdit}
            isMobile={isMobile}
            priorityLabel={pLabel}
            boardId={activeBoardId!}
            onCardClick={(c) => setCardModal({ open: true, card: c })}
            onAddCard={(columnId) => setCardModal({ open: true, card: null, columnId })}
            onCardReschedule={canEdit ? handleRescheduleCard : undefined}
            onGenerateSchedule={canEdit ? handleGenerateSchedule : undefined}
          />
          </Suspense>
        ) : view === 'list' ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            <ListView columns={columns} cards={filteredCards} allCards={cards} totalCount={cards.length} onCardClick={(c) => setCardModal({ open: true, card: c })} />
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            <OverviewView columns={columns} cards={filteredCards} members={members} />
          </div>
        )}
      </div>
      </div>

      {/* Modals — position: fixed, seguros como filhos do root */}
      {boardModal.open && (
        <BoardModal board={boardModal.board ?? null} onClose={() => setBoardModal({ open: false })} onSave={boardModal.board ? updateBoard : createBoard} />
      )}
      {columnModal.open && (
        <ColumnModal column={columnModal.column ?? null} onClose={() => setColumnModal({ open: false })} onSave={saveColumn} />
      )}
      {cardModal.open && activeBoardId && cardIO && (
        <CardModal
          card={cardModal.card ?? null}
          boardId={activeBoardId}
          columnId={cardColumnId}
          columnName={columns.find(c => c.id === (cardModal.card?.column_id ?? cardColumnId))?.name}
          members={members}
          allCards={cards}
          canEdit={canEdit}
          isMobile={isMobile}
          io={cardIO}
          onClose={closeCardModal}
          onSaved={() => { void finishCardSave() }}
          onDelete={cardModal.card ? deleteCard : undefined}
          onOpenPage={openLinkedPage}
          queueBadge={cardModal.card ? queueBadgeMap.get(cardModal.card.id) : undefined}
          onEnqueue={cardModal.card ? () => { void enqueueCard(cardModal.card!.id) } : undefined}
          onValidate={cardModal.card ? (approve, note) => validateCard(cardModal.card!.id, approve, note) : undefined}
        />
      )}
      {shareOpen && activeBoard && <ShareModal board={activeBoard} onClose={() => setShareOpen(false)} />}
      {queueOpen && activeBoardId && (
        <QueueModal
          boardId={activeBoardId}
          columns={columns}
          cards={cards}
          canEdit={canEdit}
          isMobile={isMobile}
          refreshKey={queueRefreshKey}
          onClose={() => setQueueOpen(false)}
          onChanged={() => loadBoardData(activeBoardId, { silent: true })}
        />
      )}
      {importOpen && activeBoardId && (
        <ImportCardsModal
          open={importOpen}
          onClose={() => setImportOpen(false)}
          boardId={activeBoardId}
          columns={columns}
          isMobile={isMobile}
          onImported={() => loadBoardData(activeBoardId, { silent: true })}
        />
      )}
      <ConfirmDeleteModal
        open={!!deleteConfirm}
        title={t('projects_delete')}
        message={deleteConfirm?.message}
        onConfirm={deleteConfirm?.onConfirm ?? (() => {})}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
    </QueueBadgeContext.Provider>
  )
}
