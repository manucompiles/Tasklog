import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AssignProjectButton from '@/components/AssignProjectButton'
import { assignTaskProject } from '@/lib/api'
import { useRouter } from 'next/navigation'

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}))

jest.mock('@/lib/api', () => ({
  assignTaskProject: jest.fn(),
}))

const mockedAssign = assignTaskProject as jest.MockedFunction<typeof assignTaskProject>
const mockedUseRouter = useRouter as jest.Mock

const homeFields = { status: 'active', areaId: null, area: null, about: null, nowText: null, nowHistoryJson: '[]' }
const projects = [
  { id: 1, name: 'Work', color: null, clientId: null, client: null, position: 0, createdAt: '2024-01-01T00:00:00Z', ...homeFields },
  { id: 2, name: 'Personal', color: null, clientId: null, client: null, position: 1, createdAt: '2024-01-01T00:00:00Z', ...homeFields },
]

describe('AssignProjectButton', () => {
  const mockRefresh = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockedUseRouter.mockReturnValue({ refresh: mockRefresh })
  })

  it('renders with the current project pre-selected', () => {
    render(
      <AssignProjectButton taskId={1} currentProjectId={2} projects={projects} />
    )

    expect(screen.getByRole('combobox')).toHaveValue('2')
  })

  it('updates the selection and refreshes on successful assignment', async () => {
    mockedAssign.mockResolvedValue({} as any)
    render(
      <AssignProjectButton taskId={1} currentProjectId={null} projects={projects} />
    )

    await userEvent.selectOptions(screen.getByRole('combobox'), '1')

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toHaveValue('1')
      expect(mockRefresh).toHaveBeenCalledTimes(1)
    })
  })

  it('passes null projectId when Inbox is selected', async () => {
    mockedAssign.mockResolvedValue({} as any)
    render(
      <AssignProjectButton taskId={1} currentProjectId={1} projects={projects} />
    )

    await userEvent.selectOptions(screen.getByRole('combobox'), 'inbox')

    await waitFor(() => {
      expect(mockedAssign).toHaveBeenCalledWith(1, null)
    })
  })

  it('shows an inline error when the API call fails', async () => {
    mockedAssign.mockRejectedValue(new Error('Network error'))
    render(
      <AssignProjectButton taskId={1} currentProjectId={null} projects={projects} />
    )

    await userEvent.selectOptions(screen.getByRole('combobox'), '1')

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to update project')
    })
  })
})
