import { describe, expect, it } from 'vitest'
import { isQuizAnswered, isQuizCorrect, isQuizPassed, quizScore } from './studyQuiz'
import type { StudyQuizBooleanQuestion, StudyQuizChoiceQuestion } from '../types'

function boolQ(answer: 'certo' | 'errado', userAnswer: 'certo' | 'errado' | null): StudyQuizBooleanQuestion {
  return { id: crypto.randomUUID(), statement: 'x', answer, userAnswer }
}

function choiceQ(answer: number, userAnswer: number | null): StudyQuizChoiceQuestion {
  return { kind: 'choice', id: crypto.randomUUID(), statement: 'x', options: ['a', 'b', 'c', 'd'], answer, userAnswer }
}

describe('isQuizAnswered / isQuizCorrect', () => {
  it('handles boolean questions (including legacy ones without kind)', () => {
    expect(isQuizAnswered(boolQ('certo', null))).toBe(false)
    expect(isQuizAnswered(boolQ('certo', 'errado'))).toBe(true)
    expect(isQuizCorrect(boolQ('certo', 'certo'))).toBe(true)
    expect(isQuizCorrect(boolQ('certo', 'errado'))).toBe(false)
    expect(isQuizCorrect(boolQ('certo', null))).toBe(false)
  })

  it('handles choice questions by index', () => {
    expect(isQuizAnswered(choiceQ(1, null))).toBe(false)
    expect(isQuizCorrect(choiceQ(1, 1))).toBe(true)
    expect(isQuizCorrect(choiceQ(1, 3))).toBe(false)
    // Index 0 as the user answer must count as answered (falsy-value trap).
    expect(isQuizAnswered(choiceQ(1, 0))).toBe(true)
    expect(isQuizCorrect(choiceQ(0, 0))).toBe(true)
  })
})

describe('quizScore', () => {
  it('aggregates mixed boolean and choice questions', () => {
    const quiz = [
      boolQ('certo', 'certo'),
      boolQ('errado', 'certo'),
      choiceQ(2, 2),
      choiceQ(1, null),
    ]
    expect(quizScore(quiz)).toEqual({ answered: 3, right: 2, total: 4 })
  })

  it('is all zeroes for an empty quiz', () => {
    expect(quizScore([])).toEqual({ answered: 0, right: 0, total: 0 })
  })
})

describe('isQuizPassed', () => {
  it('passes an empty quiz (card completable by checkpoints alone)', () => {
    expect(isQuizPassed([])).toBe(true)
  })

  it('requires every question answered', () => {
    expect(isQuizPassed([boolQ('certo', 'certo'), boolQ('certo', null)])).toBe(false)
  })

  it('applies the 70% bar', () => {
    // 2/3 = 66% → fail; 3/3 → pass.
    expect(isQuizPassed([boolQ('certo', 'certo'), choiceQ(0, 0), boolQ('certo', 'errado')])).toBe(false)
    expect(isQuizPassed([boolQ('certo', 'certo'), choiceQ(0, 0), boolQ('errado', 'errado')])).toBe(true)
    // 7/10 = exactly 70% → pass.
    const seven = Array.from({ length: 7 }, () => boolQ('certo', 'certo'))
    const three = Array.from({ length: 3 }, () => boolQ('certo', 'errado'))
    expect(isQuizPassed([...seven, ...three])).toBe(true)
  })
})
