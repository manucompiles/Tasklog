import { groupTasksForBoard } from '@/lib/board'
import { Task, Project } from '@/lib/api'

const projects: Project[] = [
  { id: 1, name: 'Work', color: null, clientId: null, client: null, position: 0, createdAt: '2026-01-01T00:00:00Z', status: 'active', areaId: null, area: null, about: null, nowText: null, nowHistoryJson: '[]' },
  { id: 2, name: 'Home', color: null, clientId: null, client: null, position: 1, createdAt: '2026-01-01T00:00:00Z', status: 'active', areaId: null, area: null, about: null, nowText: null, nowHistoryJson: '[]' },
]

let nextId = 1
function task(overrides: Partial<Task> = {}): Task {
  return {
    id: nextId++,
    title: 'T',
    description: null,
    deadline: null,
    dueStatus: 'none',
    priority: 4,
    createdAt: '2026-05-01T00:00:00Z',
    isCompleted: false,
    completedAt: null,
    projectId: null,
    labels: [],
    recurrence: null,
    seriesId: null,
    isRecurring: false,
    isHabit: false,
    weeklyTarget: null,
    ...overrides,
  }
}

describe('groupTasksForBoard', () => {
  it('groups by due bucket into the 5 fixed columns in order', () => {
    const tasks = [
      task({ dueStatus: 'today' }),
      task({ dueStatus: 'overdue' }),
      task({ dueStatus: 'none' }),
    ]
    const cols = groupTasksForBoard(tasks, 'due', projects)
    expect(cols.map((c) => c.key)).toEqual(['overdue', 'today', 'this_week', 'later', 'none'])
    expect(cols.find((c) => c.key === 'overdue')!.tasks).toHaveLength(1)
    expect(cols.find((c) => c.key === 'this_week')!.tasks).toHaveLength(0) // empty column still present
  })

  it('groups by priority into P1-P4 columns', () => {
    const cols = groupTasksForBoard([task({ priority: 1 }), task({ priority: 1 }), task({ priority: 3 })], 'priority', projects)
    expect(cols.map((c) => c.key)).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(cols[0].tasks).toHaveLength(2)
    expect(cols[2].tasks).toHaveLength(1)
  })

  it('groups by project: Inbox + only projects that have tasks', () => {
    const cols = groupTasksForBoard(
      [task({ projectId: null }), task({ projectId: 1 })],
      'project',
      projects,
    )
    expect(cols.map((c) => c.label)).toEqual(['Inbox', 'Work']) // Home has no tasks -> omitted
  })

  it('orders within a column by soonest deadline first, no-deadline last', () => {
    const a = task({ dueStatus: 'later', deadline: '2026-06-10' })
    const b = task({ dueStatus: 'later', deadline: '2026-06-01' })
    const c = task({ dueStatus: 'later', deadline: null })
    const col = groupTasksForBoard([a, b, c], 'due', projects).find((x) => x.key === 'later')!
    expect(col.tasks.map((t) => t.id)).toEqual([b.id, a.id, c.id])
  })
})
