import type { StudyQuizQuestion } from '../types'

// Minimum share of correct answers for a quiz to count as passed — the bar a
// card's quiz must clear before the roadmap step can complete (studyProgress).
export const QUIZ_PASS_PCT = 0.7

export function isQuizAnswered(question: StudyQuizQuestion): boolean {
  return question.userAnswer !== null
}

export function isQuizCorrect(question: StudyQuizQuestion): boolean {
  return question.userAnswer !== null && question.userAnswer === question.answer
}

export interface QuizScore {
  answered: number
  right: number
  total: number
}

export function quizScore(quiz: StudyQuizQuestion[]): QuizScore {
  let answered = 0
  let right = 0
  for (const question of quiz) {
    if (!isQuizAnswered(question)) continue
    answered++
    if (isQuizCorrect(question)) right++
  }
  return { answered, right, total: quiz.length }
}

// A card without a quiz stays completable through checkpoints alone, so an
// empty quiz counts as passed.
export function isQuizPassed(quiz: StudyQuizQuestion[]): boolean {
  const { answered, right, total } = quizScore(quiz)
  if (total === 0) return true
  return answered === total && right / total >= QUIZ_PASS_PCT
}
