import test from 'node:test'
import assert from 'node:assert/strict'
import { currentYearDays } from '../../src/utils/githubCalendar.js'

test('calendar uses one year, excludes previous-year counts, and marks future dates', () => {
  const days = currentYearDays([{ date: '2025-10-19', count: 100, level: 4 }, { date: '2026-10-19', count: 7, level: 2 }, { date: '2026-12-01', count: 100, level: 4 }], new Date('2026-10-20T00:00:00Z'))
  assert.equal(days.length, 365)
  assert.equal(days[0].date, '2026-01-01')
  assert.equal(days.at(-1).date, '2026-12-31')
  assert.equal(days.reduce((sum, day) => sum + day.count, 0), 7)
  assert.equal(days.find(day => day.date === '2026-12-01').future, true)
  assert.equal(new Set(days.map(day => day.date.slice(0, 7))).size, 12)
})

test('January and leap years retain a full, stable calendar', () => {
  const days = currentYearDays([], new Date('2024-01-01T00:00:00Z'))
  assert.equal(days.length, 366)
  assert.ok(days.some(day => day.date === '2024-02-29'))
  assert.equal(days.filter(day => !day.future).length, 1)
})
