// API client for the Tasklog .NET Web API.
// The base URL is resolved by getApiUrl() differently for server and browser:
//
// Server-side (SSR/Next.js Node process):
//   Uses API_URL env var if set (production: http://localhost:5115 on the VM),
//   otherwise falls back to localhost:5115. Server-to-server call - never goes through nginx.
//
// Client-side (browser):
//   Uses NEXT_PUBLIC_API_URL env var if set (production: https://tasklog.manudubey.in),
//   otherwise derives from the browser's hostname with port 5115 (dev LAN access from phone).

function getApiUrl(): string {
  if (typeof window === "undefined") {
    // Server-side: API_URL is a private env var set on the VM; not exposed to the browser.
    return process.env.API_URL ?? "http://localhost:5115";
  }
  // Client-side: NEXT_PUBLIC_API_URL is baked into the browser bundle at build time.
  return process.env.NEXT_PUBLIC_API_URL ?? `http://${window.location.hostname}:5115`;
}

// A client (#86): the grouping level above projects (a life area). Name + optional color.
export interface Client {
  id: number;
  name: string;
  color: string | null;
  createdAt: string;
}

// The shape returned by the API for every project.
export interface Project {
  id: number;
  name: string;
  // Optional display color, a "#RRGGBB" hex string or null (#77). Drives timeline block
  // colors and a sidebar dot.
  color: string | null;
  // The client (grouping level) this project belongs to, or null = Ungrouped (#86).
  clientId: number | null;
  client: Client | null;
  // Manual sidebar sort order (#86); lower = higher in the list.
  position: number;
  createdAt: string; // ISO 8601 datetime string
}

// The shape returned by the API for every label.
export interface Label {
  id: number;
  name: string;
  // Index into the 10-color VIBGYOR palette (0-9). Use labelColor() from lib/format.ts to resolve hex.
  colorIndex: number;
  createdAt: string; // ISO 8601 datetime string
}

// The shape returned by the API for every task.
export interface Task {
  id: number;
  title: string;
  // Optional free-text notes/context. Null = no description.
  description: string | null;
  deadline: string | null; // ISO 8601 date string or null
  // Server-computed due bucket relative to today. Read-only (the API never accepts it).
  // Available for display; the deadline pill keeps its own color thresholds (see format.ts).
  dueStatus: "overdue" | "today" | "this_week" | "later" | "none";
  // Todoist priority: 1=P1 (urgent) .. 4=P4 (none, default). Always present.
  priority: number;
  createdAt: string;       // ISO 8601 date string
  isCompleted: boolean;    // Whether the task has been marked done
  completedAt: string | null; // ISO 8601 datetime when completed, or null
  // The project this task belongs to. Null means the task is in the Inbox (uncategorized).
  projectId: number | null;
  // Labels applied to this task. Always present (empty array if none).
  labels: Label[];
  // Recurrence rule (RRULE-shaped) or null if the task does not repeat.
  // Completing a recurring task spawns the next occurrence server-side.
  recurrence: string | null;
  // Links all occurrences of the same repeating task; null for one-offs.
  seriesId: string | null;
  // Server-computed convenience flag (recurrence != null). Read-only.
  isRecurring: boolean;
  // Whether this task is tracked as a daily habit (shown on the Habits view with a streak).
  isHabit: boolean;
  // "x times a week" habit frequency target (1-7), or null when the habit is scheduled on
  // specific days (recurrence) / daily, or is not a habit. Mutually exclusive with recurrence.
  weeklyTarget: number | null;
  // Timestamped comments. Present on getTask (detail); absent on the list.
  comments?: Comment[];
  // Subtask progress counts, present on every task (0 when none) - drives the card's
  // "2/5" badge. The full rows (subtasks[]) are present only on getTask.
  subtaskCount?: number;
  completedSubtaskCount?: number;
  subtasks?: Subtask[];
  // Projected-subtask fields (#78). Set only on the synthetic rows the list returns for a
  // dated subtask: isSubtask flags it, parentTaskId/parentTitle identify the owner (rendered
  // as a breadcrumb). Absent/false on a normal task. The row's id is the SUBTASK id, so the
  // frontend keys the list by `${isSubtask ? "s" : "t"}-${id}` and routes its toggle to the
  // subtask endpoint.
  isSubtask?: boolean;
  parentTaskId?: number | null;
  parentTitle?: string;
}

// A timestamped free-text note on a task.
export interface Comment {
  id: number;
  body: string;
  createdAt: string;
}

// A lightweight checklist item under a task: title + done flag + manual order +
// optional deadline. Project/labels are inherited from the parent for filtering.
export interface Subtask {
  id: number;
  title: string;
  isCompleted: boolean;
  position: number;
  deadline: string | null;
  createdAt: string;
  taskId: number;
}

// A single daily check-in on a habit. checkInDate is date-only (local midnight).
export interface CheckIn {
  id: number;
  checkInDate: string; // ISO date string
  createdAt: string;
  taskId: number;
}

// One week's status for a frequency habit's coloured cell strip (oldest first .. current).
export interface WeekStatus {
  weekStart: string; // ISO date of that week's Monday
  count: number;     // distinct days checked in that week
  status: "met" | "partial" | "none"; // green / yellow / grey
}

// The /api/habits response: a habit task plus its computed check-in stats.
export interface Habit {
  task: Task;
  // The current streak. Unit-aware: DAYS for a specific-days / daily habit, WEEKS for a
  // frequency habit (task.weeklyTarget != null tells you which). Counts back from today.
  currentStreak: number;
  // Whether today's check-in is already logged.
  doneToday: boolean;
  // Recent check-in dates (newest first), enough for the last-7-days dot row.
  recentCheckIns: string[]; // ISO date strings
  // Frequency-habit fields (null for specific-days / daily habits):
  // the weekly target, how many days done in the current week, and the recent week strip.
  weeklyTarget: number | null;
  thisWeekCount: number | null;
  recentWeeks: WeekStatus[] | null;
}

// GET /api/tasks - fetch all tasks ordered by creation date (newest first).
// includeSubtasks=true asks the backend to also project dated, incomplete subtasks
// into the list as their own synthetic cards (the web list wants these; MCP does not).
export async function getTasks(): Promise<Task[]> {
  const res = await fetch(`${getApiUrl()}/api/tasks?includeSubtasks=true`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch tasks.");
  return res.json();
}

// GET /api/tasks/:id - fetch a single task by ID.
export async function getTask(id: number): Promise<Task> {
  const res = await fetch(`${getApiUrl()}/api/tasks/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Task ${id} not found.`);
  return res.json();
}

// POST /api/tasks - create a new task. Returns the created task.
export async function createTask(
  title: string,
  deadline?: string,
  projectId?: number | null,
  priority?: number,
  description?: string,
  recurrence?: string,
  isHabit?: boolean,
  weeklyTarget?: number
): Promise<Task> {
  const res = await fetch(`${getApiUrl()}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, deadline: deadline ?? null, projectId: projectId ?? null, priority, description, recurrence, isHabit, weeklyTarget }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to create task.");
  }
  return res.json();
}

// DELETE /api/tasks/:id - delete a task. Returns nothing on success.
export async function deleteTask(id: number): Promise<void> {
  const res = await fetch(`${getApiUrl()}/api/tasks/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete task ${id}.`);
}

// PATCH /api/tasks/:id - partial update of title and/or deadline.
// Only the keys present in `fields` are sent; the backend leaves omitted
// fields unchanged. deadline: null clears the deadline, a string sets it.
// Returns the updated task.
export async function updateTask(
  id: number,
  fields: {
    title?: string;
    deadline?: string | null;
    priority?: number;
    description?: string | null;
    recurrence?: string | null;
    isHabit?: boolean;
    weeklyTarget?: number | null;
  },
): Promise<Task> {
  const res = await fetch(`${getApiUrl()}/api/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    // Surface the backend's message (e.g. "A recurring task needs a deadline")
    // so the edit modal can show why a recurrence change was rejected.
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Failed to update task ${id}.`);
  }
  return res.json();
}

// PATCH /api/tasks/:id/complete - mark a task complete or incomplete.
// subtaskMode decides what happens to a completed parent's still-open subtasks:
// "completeAll" (default) ticks them, "pullOut" graduates them into standalone tasks.
// Ignored when reopening or when the task has no open subtasks. Returns the updated task.
export async function completeTask(
  id: number,
  isCompleted: boolean,
  subtaskMode?: "completeAll" | "pullOut",
): Promise<Task> {
  const res = await fetch(`${getApiUrl()}/api/tasks/${id}/complete`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isCompleted, subtaskMode }),
  });
  if (!res.ok) throw new Error(`Failed to update task ${id}.`);
  return res.json();
}

// --- Subtasks ---

// POST /api/tasks/:taskId/subtasks - add a checklist item. Returns the created subtask.
export async function createSubtask(taskId: number, title: string, deadline?: string | null): Promise<Subtask> {
  const res = await fetch(`${getApiUrl()}/api/tasks/${taskId}/subtasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, deadline: deadline ?? null }),
  });
  if (!res.ok) {
    const b = await res.json().then((x) => x?.message).catch(() => null);
    throw new Error(b || "Failed to add subtask.");
  }
  return res.json();
}

// PATCH /api/tasks/:taskId/subtasks/:id - partial update (title / deadline / isCompleted).
// Only the present keys are sent; deadline: null clears it. Returns the updated subtask.
export async function updateSubtask(
  taskId: number,
  subtaskId: number,
  fields: { title?: string; deadline?: string | null; isCompleted?: boolean },
): Promise<Subtask> {
  const res = await fetch(`${getApiUrl()}/api/tasks/${taskId}/subtasks/${subtaskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const b = await res.json().then((x) => x?.message).catch(() => null);
    throw new Error(b || "Failed to update subtask.");
  }
  return res.json();
}

// Convenience wrapper for the most common subtask op: tick it off / reopen.
export function toggleSubtask(taskId: number, subtaskId: number, isCompleted: boolean): Promise<Subtask> {
  return updateSubtask(taskId, subtaskId, { isCompleted });
}

// DELETE /api/tasks/:taskId/subtasks/:id - remove a subtask.
export async function deleteSubtask(taskId: number, subtaskId: number): Promise<void> {
  const res = await fetch(`${getApiUrl()}/api/tasks/${taskId}/subtasks/${subtaskId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete subtask.");
}

// POST /api/tasks/:taskId/subtasks/reorder - rewrite order from an ordered id array.
// orderedIds must be exactly the task's subtask ids in the desired order. Returns the list.
export async function reorderSubtasks(taskId: number, orderedIds: number[]): Promise<Subtask[]> {
  const res = await fetch(`${getApiUrl()}/api/tasks/${taskId}/subtasks/reorder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderedIds }),
  });
  if (!res.ok) throw new Error("Failed to reorder subtasks.");
  return res.json();
}

// POST /api/tasks/bulk - apply one operation to many tasks in a single
// transaction. data carries the per-operation payload. Returns the affected tasks.
export type BulkOperation = "complete" | "assignProject" | "setDeadline" | "setPriority";
export async function bulkTasks(
  operation: BulkOperation,
  taskIds: number[],
  data?: { isCompleted?: boolean; projectId?: number | null; deadline?: string | null; priority?: number },
): Promise<Task[]> {
  const res = await fetch(`${getApiUrl()}/api/tasks/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation, taskIds, data }),
  });
  if (!res.ok) {
    // Surface the backend's specific message (e.g. "Project 999 not found")
    // instead of a flat failure, so the caller can tell a bad request apart
    // from a server error. Fall back to the status if the body has no message.
    const message = await res
      .json()
      .then((b) => b?.message)
      .catch(() => null);
    throw new Error(message || `Bulk operation failed (HTTP ${res.status}).`);
  }
  return res.json();
}

// POST /api/tasks/:id/comments - add a comment. Returns the created comment.
export async function addComment(taskId: number, body: string): Promise<Comment> {
  const res = await fetch(`${getApiUrl()}/api/tasks/${taskId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    const b = await res.json().then((x) => x?.message).catch(() => null);
    throw new Error(b || "Failed to add comment.");
  }
  return res.json();
}

// DELETE /api/tasks/:id/comments/:commentId - remove a comment.
export async function deleteComment(taskId: number, commentId: number): Promise<void> {
  const res = await fetch(`${getApiUrl()}/api/tasks/${taskId}/comments/${commentId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete comment.");
}

// GET /api/habits - fetch habit tasks, each with its streak, doneToday, and recent check-ins.
export async function getHabits(): Promise<Habit[]> {
  const res = await fetch(`${getApiUrl()}/api/habits`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch habits.");
  return res.json();
}

// POST /api/tasks/:id/checkins - mark a habit done for a day (default today).
// Idempotent: a second call for the same day returns the existing check-in.
export async function addCheckIn(taskId: number, date?: string): Promise<CheckIn> {
  const res = await fetch(`${getApiUrl()}/api/tasks/${taskId}/checkins`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(date ? { date } : {}),
  });
  if (!res.ok) throw new Error(`Failed to check in habit ${taskId}.`);
  return res.json();
}

// DELETE /api/tasks/:id/checkins?date=yyyy-MM-dd - undo a check-in (default today).
export async function removeCheckIn(taskId: number, date?: string): Promise<void> {
  const qs = date ? `?date=${date}` : "";
  const res = await fetch(`${getApiUrl()}/api/tasks/${taskId}/checkins${qs}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to undo check-in for habit ${taskId}.`);
}

// GET /api/projects - fetch all projects.
export async function getProjects(): Promise<Project[]> {
  const res = await fetch(`${getApiUrl()}/api/projects`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch projects.");
  return res.json();
}

// POST /api/projects - create a new project (with optional color + client). Returns it.
export async function createProject(name: string, color?: string | null, clientId?: number | null): Promise<Project> {
  const res = await fetch(`${getApiUrl()}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color: color ?? null, ...(clientId != null ? { clientId } : {}) }),
  });
  if (!res.ok) throw new Error("Failed to create project.");
  return res.json();
}

// PATCH /api/projects/:id - present-key update of name / color / clientId (#86). Only the
// keys present in `fields` are sent; the backend leaves omitted fields unchanged. color/
// clientId: null clears (recolor default / Ungrouped). Returns the updated project.
export async function updateProject(
  id: number,
  fields: { name?: string; color?: string | null; clientId?: number | null },
): Promise<Project> {
  const res = await fetch(`${getApiUrl()}/api/projects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(`Failed to update project ${id}.`);
  return res.json();
}

// POST /api/projects/reorder - rewrite sidebar order from an ordered id array (must be the
// full set of project ids). Returns the reordered list.
export async function reorderProjects(orderedIds: number[]): Promise<Project[]> {
  const res = await fetch(`${getApiUrl()}/api/projects/reorder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderedIds }),
  });
  if (!res.ok) throw new Error("Failed to reorder projects.");
  return res.json();
}

// DELETE /api/projects/:id - delete a project. Returns nothing on success.
export async function deleteProject(id: number): Promise<void> {
  const res = await fetch(`${getApiUrl()}/api/projects/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete project ${id}.`);
}

// --- Clients (#86) ---

// GET /api/clients - all clients, alphabetical.
export async function getClients(): Promise<Client[]> {
  const res = await fetch(`${getApiUrl()}/api/clients`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch clients.");
  return res.json();
}

// POST /api/clients - create a client (life area) with optional color. Returns it.
export async function createClient(name: string, color?: string | null): Promise<Client> {
  const res = await fetch(`${getApiUrl()}/api/clients`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color: color ?? null }),
  });
  if (!res.ok) throw new Error("Failed to create client.");
  return res.json();
}

// PATCH /api/clients/:id - rename and/or recolor a client. A non-null color sets it; null
// leaves it unchanged (mirrors the project convention). Returns it.
export async function renameClient(id: number, name: string, color?: string | null): Promise<Client> {
  const res = await fetch(`${getApiUrl()}/api/clients/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color: color ?? null }),
  });
  if (!res.ok) throw new Error(`Failed to rename client ${id}.`);
  return res.json();
}

// DELETE /api/clients/:id - delete a client; its projects survive as Ungrouped.
export async function deleteClient(id: number): Promise<void> {
  const res = await fetch(`${getApiUrl()}/api/clients/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete client ${id}.`);
}

// PATCH /api/tasks/:taskId/project - assign a task to a project (or null for Inbox).
// Returns the updated task.
export async function assignTaskProject(taskId: number, projectId: number | null): Promise<Task> {
  const res = await fetch(`${getApiUrl()}/api/tasks/${taskId}/project`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId }),
  });
  if (!res.ok) throw new Error(`Failed to assign project for task ${taskId}.`);
  return res.json();
}

// PATCH /api/tasks/:taskId/labels - replace the full label set on a task.
// Pass an empty array to remove all labels. Returns the updated task.
export async function setTaskLabels(taskId: number, labelIds: number[]): Promise<Task> {
  const res = await fetch(`${getApiUrl()}/api/tasks/${taskId}/labels`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ labelIds }),
  });
  if (!res.ok) throw new Error(`Failed to update labels for task ${taskId}.`);
  return res.json();
}

// GET /api/labels - fetch all labels ordered alphabetically.
export async function getLabels(): Promise<Label[]> {
  const res = await fetch(`${getApiUrl()}/api/labels`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch labels.");
  return res.json();
}

// POST /api/labels - create a new label. Returns the created label.
export async function createLabel(name: string, colorIndex: number): Promise<Label> {
  const res = await fetch(`${getApiUrl()}/api/labels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, colorIndex }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to create label.");
  }
  return res.json();
}

// PATCH /api/labels/:id - update a label's name and/or color. Returns the updated label.
export async function updateLabel(id: number, name: string, colorIndex: number): Promise<Label> {
  const res = await fetch(`${getApiUrl()}/api/labels/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, colorIndex }),
  });
  if (!res.ok) throw new Error(`Failed to update label ${id}.`);
  return res.json();
}

// DELETE /api/labels/:id - delete a label. Unlinks it from all tasks (tasks are not deleted).
export async function deleteLabel(id: number): Promise<void> {
  const res = await fetch(`${getApiUrl()}/api/labels/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete label ${id}.`);
}

// --- Time tracking (#77) ---------------------------------------------------

// One tracked interval, as returned by the time-entry endpoints. Denormalized with the
// task title + project color so the timeline can render a block without a second lookup.
// endedAt null = the entry is still running. Times are local ISO strings.
export interface TimeEntry {
  id: number;
  // Null (#86) = a task-free entry (life-logging like "Sleep"); the label is `description`.
  taskId: number | null;
  taskTitle: string; // "" when task-free
  // Free-text label (#86). Null for a task-linked entry that just uses the task title.
  description: string | null;
  // Effective project = the entry's own, else the linked task's (#86).
  projectId: number | null;
  projectColor: string | null;
  // The project's client, denormalized for grouped summaries (#86).
  clientId: number | null;
  clientName: string | null;
  clientColor: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
}

// An autocomplete suggestion (#86): a past description + the project it was last used with.
export interface EntrySuggestion {
  description: string;
  projectId: number | null;
}

async function timeEntryOrThrow(res: Response, fallback: string): Promise<TimeEntry> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? fallback);
  }
  return res.json();
}

// GET /api/time-entries?from&to - entries overlapping the [from, to) window (ISO strings).
export async function getTimeEntries(from: string, to: string): Promise<TimeEntry[]> {
  const qs = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const res = await fetch(`${getApiUrl()}/api/time-entries${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch time entries.");
  return res.json();
}

// GET /api/time-entries?taskId=X - all entries for a task, newest first.
export async function getTaskTimeEntries(taskId: number): Promise<TimeEntry[]> {
  const res = await fetch(`${getApiUrl()}/api/time-entries?taskId=${taskId}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch time entries.");
  return res.json();
}

// GET /api/time-entries/active - the running entry, or null. A 204 (and an empty body) both
// mean "no timer running" - guard against them so res.json() doesn't choke on no content.
export async function getActiveTimeEntry(): Promise<TimeEntry | null> {
  const res = await fetch(`${getApiUrl()}/api/time-entries/active`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch the active timer.");
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// POST /api/time-entries/start - start a timer (auto-stops any running timer). Accepts a
// bare task id (legacy convenience) OR a body (#86): task-free entries pass a description
// and/or projectId. Project defaults from the task when tracking one.
export async function startTimer(
  arg: number | { taskId?: number; description?: string; projectId?: number | null },
): Promise<TimeEntry> {
  const body = typeof arg === "number" ? { taskId: arg } : arg;
  const res = await fetch(`${getApiUrl()}/api/time-entries/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return timeEntryOrThrow(res, "Failed to start the timer.");
}

// POST /api/time-entries/:id/stop - stop a running entry.
export async function stopTimer(id: number): Promise<TimeEntry> {
  const res = await fetch(`${getApiUrl()}/api/time-entries/${id}/stop`, { method: "POST" });
  return timeEntryOrThrow(res, "Failed to stop the timer.");
}

// POST /api/time-entries - log a manual (retroactive) interval (#86). startedAt/endedAt are
// required; task/description/project optional. Project defaults from the task when given.
export async function addTimeEntry(
  fields: { startedAt: string; endedAt: string; taskId?: number | null; description?: string | null; projectId?: number | null },
): Promise<TimeEntry> {
  const res = await fetch(`${getApiUrl()}/api/time-entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  return timeEntryOrThrow(res, "Failed to add the time entry.");
}

// PATCH /api/time-entries/:id - present-key edit (#86): start/end, description, project, or
// the linked task. Omit to keep; description/projectId/taskId null clears/unlinks.
export async function updateTimeEntry(
  id: number,
  fields: { startedAt?: string; endedAt?: string; description?: string | null; projectId?: number | null; taskId?: number | null },
): Promise<TimeEntry> {
  const res = await fetch(`${getApiUrl()}/api/time-entries/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  return timeEntryOrThrow(res, "Failed to update the time entry.");
}

// DELETE /api/time-entries/:id - delete a logged interval.
export async function deleteTimeEntry(id: number): Promise<void> {
  const res = await fetch(`${getApiUrl()}/api/time-entries/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete time entry ${id}.`);
}

// GET /api/time-entries/suggestions?text= - autocomplete over recent entry descriptions,
// each with the project it was last used with (#86). Empty text = most recent overall.
export async function getEntrySuggestions(text?: string, limit?: number): Promise<EntrySuggestion[]> {
  const params = new URLSearchParams();
  if (text) params.set("text", text);
  if (limit !== undefined) params.set("limit", String(limit));
  const qs = params.toString();
  const res = await fetch(`${getApiUrl()}/api/time-entries/suggestions${qs ? `?${qs}` : ""}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch suggestions.");
  return res.json();
}

// --- Journal (#79) ---

// A section definition inside a journal template (parsed server-side from SectionsJson).
export interface JournalSectionDef {
  key: string;
  title: string;
  kind: "checkins" | "prose" | "projects" | "plan" | "mind" | "evening" | "list";
  // Optional sections stay silent when empty ("earned depth only" - e.g. the Journal section).
  optional?: boolean;
}

export interface JournalTemplateDef {
  id: number;
  key: string; // "daily" | "gratitude" | "affirmations"
  name: string;
  periodicity: string;
  sortOrder: number;
  sections: JournalSectionDef[];
}

// One template's note for one day. Content is a JSON object keyed by section key;
// value shapes per kind live in lib/journal.ts.
export interface JournalEntryDto {
  id: number;
  templateKey: string;
  entryDate: string; // "yyyy-MM-dd"
  content: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// A timestamped mood check-in. mocLevel is derived from feelings-wheel picks
// (null when only free words were logged) - never self-tagged.
export interface MoodCheckinDto {
  id: number;
  checkinAt: string; // local ISO datetime
  words: string[];
  energy: number | null; // 0-10; null when the words came without a number (v4.1)
  mocLevel: number | null;
}

// GET /api/journal/templates - all templates in display order.
export async function getJournalTemplates(): Promise<JournalTemplateDef[]> {
  const res = await fetch(`${getApiUrl()}/api/journal/templates`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load journal templates.");
  return res.json();
}

// GET /api/journal/entries?date= - the day's entries (any template). Empty array = blank day.
export async function getJournalEntries(date: string): Promise<JournalEntryDto[]> {
  const res = await fetch(`${getApiUrl()}/api/journal/entries?date=${date}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load journal entries.");
  return res.json();
}

// GET /api/journal/entries/dates?from=&to= - days having entries (calendar dots).
export async function getJournalEntryDates(from: string, to: string): Promise<string[]> {
  const res = await fetch(`${getApiUrl()}/api/journal/entries/dates?from=${from}&to=${to}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load journal entry dates.");
  return res.json();
}

// PUT /api/journal/entries/:templateKey/:date - upsert the day's note for a template.
// One entry per template per date is an API guarantee; this never duplicates.
export async function upsertJournalEntry(
  templateKey: string,
  date: string,
  content: Record<string, unknown>,
): Promise<JournalEntryDto> {
  const res = await fetch(`${getApiUrl()}/api/journal/entries/${templateKey}/${date}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to save the journal entry.");
  }
  return res.json();
}

// GET /api/mood-checkins?date= - that day's check-ins, oldest first.
export async function getMoodCheckins(date: string): Promise<MoodCheckinDto[]> {
  const res = await fetch(`${getApiUrl()}/api/mood-checkins?date=${date}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load mood check-ins.");
  return res.json();
}

// POST /api/mood-checkins - log a check-in (checkinAt defaults to now server-side).
export async function addMoodCheckin(
  words: string[],
  energy: number,
  mocLevel?: number | null,
  // Local ISO datetime to backfill a past day; omitted = now (server default).
  checkinAt?: string,
): Promise<MoodCheckinDto> {
  const res = await fetch(`${getApiUrl()}/api/mood-checkins`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ words, energy, mocLevel: mocLevel ?? null, checkinAt: checkinAt ?? null }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to log the mood check-in.");
  }
  return res.json();
}

// DELETE /api/mood-checkins/:id - remove a mistaken check-in.
export async function deleteMoodCheckin(id: number): Promise<void> {
  const res = await fetch(`${getApiUrl()}/api/mood-checkins/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete mood check-in ${id}.`);
}

// GET /api/journal/export?date= - the day's rendered markdown (preview + download share it).
export async function getJournalDayMarkdown(date: string): Promise<string> {
  const res = await fetch(`${getApiUrl()}/api/journal/export?date=${date}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to render the journal markdown.");
  return res.text();
}

// Download URLs for <a href> (browser handles the file save).
export function journalExportUrl(date?: string): string {
  return date
    ? `${getApiUrl()}/api/journal/export?date=${date}`
    : `${getApiUrl()}/api/journal/export/all`;
}

// GET /api/tasks?text=&completed=false - open tasks matching a title substring,
// for the plan combobox. Small limit: it is a type-ahead, not a browse.
export async function searchOpenTasks(text: string): Promise<Task[]> {
  const params = new URLSearchParams({ text, completed: "false", limit: "6" });
  const res = await fetch(`${getApiUrl()}/api/tasks?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to search tasks.");
  return res.json();
}

// GET /api/tasks?completedOn= - tasks completed that calendar day, for the journal's
// derived "Unplanned, got done" bucket (#79).
export async function getTasksCompletedOn(date: string): Promise<Task[]> {
  const res = await fetch(`${getApiUrl()}/api/tasks?completedOn=${date}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load completed tasks.");
  return res.json();
}

// ---------------------------------------------------------------------------
// Companion (#87): daily conversation sessions + the Capture inbox trust loop.
// The chat TURN itself goes to the same-origin Next.js route (/api/companion/
// chat, NDJSON stream) - these functions cover the .NET persistence around it.
// ---------------------------------------------------------------------------

// One transcript message. The client owns this shape; the API stores it verbatim.
export interface CompanionMessage {
  role: "user" | "assistant";
  content: string;
  at: string; // ISO timestamp
}

// One conversation day (unique per SessionDate on the server).
export interface CompanionSessionDto {
  id: number;
  sessionDate: string;
  messages: CompanionMessage[];
  sdkSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

// A row in the Capture inbox. v4.0 staged proposals; v4.1 (#92) rows are mostly
// RECEIPTS - Sage writes autonomously and the row is the audit/undo record.
// Payload shape depends on type (task/mood/thought/note/expense/time).
export interface CaptureDto {
  id: number;
  type: string;
  status: "proposed" | "confirmed" | "dismissed";
  source: string;
  sessionId: number | null;
  payload: {
    title?: string; projectId?: number; newProjectName?: string; deadline?: string;
    // mood
    words?: string[]; energy?: number;
    // thought
    kind?: string; bodyMd?: string; source?: string;
    // expense
    amount?: number; direction?: string; note?: string; occurredOn?: string;
    split?: { with?: string; share?: number; settled?: boolean };
    // time
    op?: string; description?: string; startedAt?: string; endedAt?: string;
    // weave
    date?: string; sections?: Record<string, unknown>;
  };
  span: string | null;
  confidence: number | null;
  confirmedType: string | null;
  confirmedId: number | null;
  createdAt: string;
  updatedAt: string;
}

// GET /api/companion/sessions/today - today's session, or null when none exists
// yet (the server returns 204; reads never auto-create).
export async function getTodayCompanionSession(): Promise<CompanionSessionDto | null> {
  const res = await fetch(`${getApiUrl()}/api/companion/sessions/today`, { cache: "no-store" });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error("Failed to load today's companion session.");
  return res.json();
}

// GET /api/companion/sessions?date= - a past day's conversation (history view),
// or null when that day has no session.
export async function getCompanionSessionByDate(date: string): Promise<CompanionSessionDto | null> {
  const res = await fetch(`${getApiUrl()}/api/companion/sessions?date=${date}`, { cache: "no-store" });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error("Failed to load that day's conversation.");
  return res.json();
}

// GET /api/companion/sessions/dates?from=&to= - days having a conversation
// (the history calendar's dots; the journal's entries/dates twin).
export async function getCompanionSessionDates(from: string, to: string): Promise<string[]> {
  const res = await fetch(`${getApiUrl()}/api/companion/sessions/dates?from=${from}&to=${to}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load conversation dates.");
  return res.json();
}

// GET /api/captures?sessionId= - the session's proposal cards, oldest first.
export async function getCaptures(sessionId: number): Promise<CaptureDto[]> {
  const res = await fetch(`${getApiUrl()}/api/captures?sessionId=${sessionId}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load cards.");
  return res.json();
}

// PATCH /api/captures/{id} - edit a proposed card's payload before keeping it.
export async function updateCapture(
  id: number,
  payload: CaptureDto["payload"],
): Promise<CaptureDto> {
  const res = await fetch(`${getApiUrl()}/api/captures/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to update the card.");
  }
  return res.json();
}

// POST /api/captures/{id}/confirm - KEEP: materializes the real task. Idempotent.
export async function confirmCapture(
  id: number,
): Promise<{ capture: CaptureDto; task?: Task }> {
  const res = await fetch(`${getApiUrl()}/api/captures/${id}/confirm`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to add the task.");
  }
  const data = await res.json();
  // A repeat confirm returns the bare capture (idempotent); first confirm
  // returns { capture, task }. Normalize to one shape for callers.
  return "capture" in data ? data : { capture: data };
}

// POST /api/captures/{id}/dismiss - TOSS: stays recorded so it is not re-proposed.
export async function dismissCapture(id: number): Promise<CaptureDto> {
  const res = await fetch(`${getApiUrl()}/api/captures/${id}/dismiss`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to toss the card.");
  }
  return res.json();
}

// POST /api/captures/{id}/restore - undo an accidental toss (dismissed -> proposed).
export async function restoreCapture(id: number): Promise<CaptureDto> {
  const res = await fetch(`${getApiUrl()}/api/captures/${id}/restore`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to restore the card.");
  }
  return res.json();
}
