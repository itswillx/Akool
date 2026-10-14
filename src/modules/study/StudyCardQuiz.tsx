import { useState } from 'react'
import { Check, ChevronDown, ChevronUp, RotateCcw, X } from 'lucide-react'
import type { StudyQuizAnswer, StudyQuizQuestion } from '../../types'
import { useLanguage } from '../../i18n/LanguageContext'
import { isQuizAnswered, isQuizCorrect, isQuizPassed, quizScore } from '../../lib/studyQuiz'
import { SectionLabel } from './StudyBits'

// O quiz de um card (Certo/Errado e múltipla escolha), separado do
// StudyCardItem para os dois caberem nas 600 linhas (API-029). Cada resposta
// vai pela RPC study_quiz_answer, que trava a primeira: responder de novo é
// depois de reiniciar. `disabled` desliga os botões quando o servidor não tem
// as RPCs (servidor desatualizado).

interface StudyCardQuizProps {
  quiz: StudyQuizQuestion[]
  disabled?: boolean
  onAnswer: (questionId: string, answer: StudyQuizAnswer | number) => void
  onReset: (onlyWrong: boolean) => void
}

export default function StudyCardQuiz({ quiz, disabled = false, onAnswer, onReset }: StudyCardQuizProps) {
  const { t } = useLanguage()
  // Collapsed by default: 5-15 questions per card would dominate the layout.
  const [quizExpanded, setQuizExpanded] = useState(false)

  // Answers lock after the first pick (retry = clear), so the score can't
  // be gamed by flipping until it turns green.
  const answer = (id: string, value: StudyQuizAnswer | number) => {
    const question = quiz.find(q => q.id === id)
    if (!question || question.userAnswer !== null || disabled) return
    onAnswer(id, value)
  }

  const { answered: quizAnswered, right: quizRight } = quizScore(quiz)

  return (
    <div style={{ marginTop: 12 }}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setQuizExpanded(prev => !prev)}
        onKeyDown={e => { if (e.key === 'Enter') setQuizExpanded(prev => !prev) }}
        style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', cursor: 'pointer' }}
      >
        <SectionLabel>{t('study_quiz')}</SectionLabel>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', marginBottom: 8 }}>
          <span>
            {quizAnswered > 0 && (
              <span style={{ color: quizRight === quizAnswered ? '#22c55e' : 'var(--color-text)' }}>
                {t('study_quiz_score', { right: quizRight, answered: quizAnswered })}
              </span>
            )}
            {quizAnswered > 0 && ' • '}
            {t('study_quiz_answered', { answered: quizAnswered, total: quiz.length })}
          </span>
          {quizExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </span>
      </div>
      {quizExpanded && quizAnswered > 0 && !isQuizPassed(quiz) && (
        <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 6 }}>
          {t('study_quiz_pass_hint')}
        </div>
      )}
      {quizExpanded && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {quiz.map((question, index) => {
          const answered = isQuizAnswered(question)
          const gotIt = isQuizCorrect(question)
          const locked = answered || disabled
          const feedback = (wrongText: string) => (
            <span style={{ fontSize: 11.5, fontWeight: 600, color: gotIt ? '#22c55e' : '#ef4444' }}>
              {gotIt ? t('study_quiz_feedback_right') : wrongText}
            </span>
          )
          const explanation = answered && question.explanation && (
            <div style={{ marginTop: 5, padding: '6px 9px', borderRadius: 8, backgroundColor: 'var(--color-hover)', fontSize: 12, lineHeight: 1.45, color: 'var(--color-text-muted)', overflowWrap: 'anywhere' }}>
              <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{t('study_quiz_explanation')}: </span>
              {question.explanation}
            </div>
          )
          return (
            <div key={question.id} style={{ padding: '5px 2px', opacity: answered ? 0.7 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginTop: 1, flexShrink: 0, minWidth: 18, textAlign: 'right' }}>
                  {index + 1}.
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--color-text)', overflowWrap: 'anywhere' }}>
                    {question.statement}
                  </div>
                  {question.kind === 'choice' ? (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, marginTop: 5 }}>
                        {question.options.map((option, optionIndex) => {
                          const chosen = question.userAnswer === optionIndex
                          const highlightCorrect = answered && !gotIt && question.answer === optionIndex
                          return (
                            <button
                              key={optionIndex}
                              type="button"
                              disabled={locked}
                              onClick={() => answer(question.id, optionIndex)}
                              style={{
                                display: 'inline-flex', alignItems: 'flex-start', gap: 6, padding: '4px 11px', borderRadius: 10,
                                fontSize: 12, fontWeight: 600, textAlign: 'left', cursor: locked ? 'default' : 'pointer',
                                border: chosen
                                  ? `1px solid ${gotIt ? '#22c55e' : '#ef4444'}`
                                  : highlightCorrect ? '1px solid #22c55e' : '1px solid var(--color-border)',
                                backgroundColor: chosen ? (gotIt ? '#22c55e1c' : '#ef44441c') : 'transparent',
                                color: chosen
                                  ? (gotIt ? '#22c55e' : '#ef4444')
                                  : highlightCorrect ? '#22c55e' : answered ? 'var(--color-text-muted)' : 'var(--color-text)',
                                opacity: answered && !chosen && !highlightCorrect ? 0.55 : 1,
                              }}
                            >
                              <span style={{ flexShrink: 0 }}>{String.fromCharCode(65 + optionIndex)})</span>
                              <span style={{ overflowWrap: 'anywhere' }}>{option}</span>
                            </button>
                          )
                        })}
                      </div>
                      {answered && (
                        <div style={{ marginTop: 5 }}>
                          {feedback(t('study_quiz_feedback_wrong_choice', {
                            answer: `${String.fromCharCode(65 + question.answer)}) ${question.options[question.answer]}`,
                          }))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                      {(['certo', 'errado'] as const).map(option => {
                        const chosen = question.userAnswer === option
                        const highlightCorrect = answered && !gotIt && question.answer === option
                        return (
                          <button
                            key={option}
                            type="button"
                            disabled={locked}
                            onClick={() => answer(question.id, option)}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 11px', borderRadius: 999,
                              fontSize: 11.5, fontWeight: 600, cursor: locked ? 'default' : 'pointer',
                              border: chosen
                                ? `1px solid ${gotIt ? '#22c55e' : '#ef4444'}`
                                : highlightCorrect ? '1px solid #22c55e' : '1px solid var(--color-border)',
                              backgroundColor: chosen ? (gotIt ? '#22c55e1c' : '#ef44441c') : 'transparent',
                              color: chosen
                                ? (gotIt ? '#22c55e' : '#ef4444')
                                : highlightCorrect ? '#22c55e' : answered ? 'var(--color-text-muted)' : 'var(--color-text)',
                              opacity: answered && !chosen && !highlightCorrect ? 0.55 : 1,
                            }}
                          >
                            {option === 'certo' ? <Check size={11} /> : <X size={11} />}
                            {option === 'certo' ? t('study_quiz_true') : t('study_quiz_false')}
                          </button>
                        )
                      })}
                      {answered && feedback(t('study_quiz_feedback_wrong', {
                        answer: question.answer === 'certo' ? t('study_quiz_true') : t('study_quiz_false'),
                      }))}
                    </div>
                  )}
                  {explanation}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      )}
      {quizExpanded && quizAnswered > 0 && !disabled && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 6 }}>
          <button
            onClick={() => onReset(false)}
            type="button"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 11.5, fontWeight: 600, padding: 0 }}
          >
            <RotateCcw size={11} />
            {t('study_quiz_retry')}
          </button>
          {quizAnswered === quiz.length && quizRight < quizAnswered && (
            <button
              onClick={() => onReset(true)}
              type="button"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 11.5, fontWeight: 600, padding: 0 }}
            >
              <RotateCcw size={11} />
              {t('study_quiz_retry_wrong')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
