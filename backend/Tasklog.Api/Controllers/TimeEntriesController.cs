using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Tasklog.Api.Data;
using Tasklog.Api.Models;

namespace Tasklog.Api.Controllers
{
    // Time tracking (#77; decoupled from tasks in #86). A TimeEntry is one start->stop
    // interval; EndedAt null = running. At most one entry is running app-wide (single timer) -
    // starting a new one auto-stops the current. As of #86 an entry is a first-class actual:
    // it may be task-free, carries its own free-text description, and its own project (Client
    // via the project). Responses are projected to include the effective project color +
    // client so the timeline is self-contained. Per-day totals / block geometry are computed
    // client-side (the timeline is the only consumer), so there is no aggregation here.
    [ApiController]
    [Route("api/time-entries")]
    public class TimeEntriesController : ControllerBase
    {
        private const int MaxDescriptionLength = 500;
        // Tidy rules applied to the STORED data when a timer entry CLOSES (stop/auto-stop), #86:
        private const int MinDurationSeconds = 150; // under 2.5 min = accidental tap -> discarded
        private const int SnapMinutes = 5;          // both edges snapped to the nearest 5-min grid

        private readonly TasklogDbContext _context;

        public TimeEntriesController(TasklogDbContext context)
        {
            _context = context;
        }

        // GET /api/time-entries?from=...&to=...
        // Entries that OVERLAP the [from, to) window (so an interval started before `from`
        // but still running/ending inside it is included - e.g. a timer left running
        // overnight shows on today). Defaults to today if the range is omitted.
        // Max range: 366 days (guard against accidentally fetching the entire history).
        //
        // GET /api/time-entries?taskId=X
        // All entries for a specific task, newest first. Date range is ignored in this mode.
        [HttpGet]
        public async Task<IActionResult> List([FromQuery] int? taskId, [FromQuery] DateTime? from, [FromQuery] DateTime? to)
        {
            if (taskId.HasValue)
            {
                var taskEntries = await WithGrouping(_context.TimeEntries)
                    .Where(e => e.TaskId == taskId.Value)
                    .OrderByDescending(e => e.StartedAt)
                    .ToListAsync();
                return Ok(taskEntries.Select(Project).ToList());
            }

            var start = from ?? DateTime.Today;
            var end = to ?? DateTime.Today.AddDays(1);
            if ((end - start).TotalDays > 366)
                return BadRequest(new { message = "Date range must not exceed 366 days." });
            var now = DateTime.Now;

            var entries = await WithGrouping(_context.TimeEntries)
                .Where(e => e.StartedAt < end && (e.EndedAt ?? now) >= start)
                .OrderBy(e => e.StartedAt)
                .ToListAsync();

            return Ok(entries.Select(Project).ToList());
        }

        // GET /api/time-entries/active - the running entry (EndedAt == null), or null.
        [HttpGet("active")]
        public async Task<IActionResult> Active()
        {
            var running = await WithGrouping(_context.TimeEntries)
                .FirstOrDefaultAsync(e => e.EndedAt == null);
            return Ok(running is null ? null : Project(running));
        }

        // GET /api/time-entries/suggestions?text=&limit=
        // Autocomplete backing (#86): distinct recent entry descriptions matching `text`,
        // each carrying the project it was most recently used with (so the composer can
        // pre-fill project/client). A lookup over recent history - no managed "activity"
        // entity. Bounded to the last 500 entries before grouping.
        [HttpGet("suggestions")]
        public async Task<IActionResult> Suggestions([FromQuery] string? text, [FromQuery] int? limit)
        {
            var query = _context.TimeEntries.Where(e => e.Description != null && e.Description != "");
            if (!string.IsNullOrWhiteSpace(text))
            {
                // Case-insensitive substring match. ToLower().Contains translates to SQLite
                // (case-insensitive instr) and also evaluates on the in-memory test provider,
                // unlike EF.Functions.Like which is relational-only.
                var t = text.Trim().ToLower();
                query = query.Where(e => e.Description!.ToLower().Contains(t));
            }

            var recent = await query
                .OrderByDescending(e => e.StartedAt)
                .Select(e => new { e.Description, e.ProjectId, e.StartedAt })
                .Take(500)
                .ToListAsync();

            var suggestions = recent
                .GroupBy(r => r.Description!, StringComparer.OrdinalIgnoreCase)
                .Select(g => g.OrderByDescending(r => r.StartedAt).First())
                .OrderByDescending(r => r.StartedAt)
                .Take(limit is > 0 ? limit.Value : 8)
                .Select(r => new EntrySuggestion(r.Description!, r.ProjectId))
                .ToList();

            return Ok(suggestions);
        }

        // POST /api/time-entries/start  { taskId?, description?, projectId? }
        // Auto-stops any running entry, then opens a new one. Everything is optional (#86):
        // a task-free entry with just a description, or a bare timer to categorize later.
        // When started on a task with no explicit project, the entry's project defaults from
        // the task's project. 404 if a supplied task/project id does not exist.
        [HttpPost("start")]
        public async Task<IActionResult> Start([FromBody] StartRequest request)
        {
            var task = await ResolveTaskAsync(request.TaskId);
            if (request.TaskId.HasValue && task is null)
                return NotFound(new { message = $"Task {request.TaskId} not found." });
            if (request.ProjectId is int pid && !await _context.Projects.AnyAsync(p => p.Id == pid))
                return NotFound(new { message = $"Project {pid} not found." });

            if (!TryNormalizeDescription(request.Description, out var description))
                return BadRequest(new { message = $"Description must be {MaxDescriptionLength} characters or fewer." });

            var now = DateTime.Now;
            await StopAllRunning(now);

            var entry = new TimeEntry
            {
                TaskId = task?.Id,
                Description = description,
                ProjectId = request.ProjectId ?? task?.ProjectId,
                StartedAt = now,
                CreatedAt = now,
            };
            _context.TimeEntries.Add(entry);
            await _context.SaveChangesAsync();

            return CreatedAtAction(nameof(Active), await ProjectByIdAsync(entry.Id));
        }

        // POST /api/time-entries/{id}/stop - close a running entry (idempotent: an
        // already-stopped entry is returned unchanged).
        [HttpPost("{id:int}/stop")]
        public async Task<IActionResult> Stop(int id)
        {
            // Load with grouping so the projection works even if CloseEntry discards the row
            // (we read the in-memory object after it is removed from the context).
            var entry = await WithGrouping(_context.TimeEntries).FirstOrDefaultAsync(e => e.Id == id);
            if (entry is null)
                return NotFound(new { message = $"Time entry {id} not found." });

            if (entry.EndedAt is null)
            {
                CloseEntry(entry, DateTime.Now); // discard-if-tiny + snap edges to the grid (#86)
                await _context.SaveChangesAsync();
            }
            return Ok(Project(entry));
        }

        // POST /api/time-entries  { taskId?, description?, projectId?, startedAt, endedAt }
        // Manual (retroactive) entry - a closed interval logged without the timer. Task and
        // project are optional (#86), same defaulting as Start.
        [HttpPost]
        public async Task<IActionResult> AddManual([FromBody] ManualRequest request)
        {
            var task = await ResolveTaskAsync(request.TaskId);
            if (request.TaskId.HasValue && task is null)
                return NotFound(new { message = $"Task {request.TaskId} not found." });
            if (request.ProjectId is int pid && !await _context.Projects.AnyAsync(p => p.Id == pid))
                return NotFound(new { message = $"Project {pid} not found." });

            if (!TryNormalizeDescription(request.Description, out var description))
                return BadRequest(new { message = $"Description must be {MaxDescriptionLength} characters or fewer." });
            if (request.EndedAt <= request.StartedAt)
                return BadRequest(new { message = "End time must be after the start time." });
            if (request.EndedAt > DateTime.Now.AddMinutes(5))
                return BadRequest(new { message = "End time cannot be more than 5 minutes in the future." });

            // A retro interval trims any running timer it overlaps (#92): inserting
            // "sleep 00:50-06:00" while a dinner timer is still open must stop that
            // timer at 00:50, not leave it running through the night.
            var overlappedRunning = await _context.TimeEntries
                .Where(e => e.EndedAt == null && e.StartedAt < request.StartedAt)
                .ToListAsync();
            foreach (var r in overlappedRunning) r.EndedAt = request.StartedAt;

            var entry = new TimeEntry
            {
                TaskId = task?.Id,
                Description = description,
                ProjectId = request.ProjectId ?? task?.ProjectId,
                StartedAt = request.StartedAt,
                EndedAt = request.EndedAt,
                CreatedAt = DateTime.Now,
            };
            _context.TimeEntries.Add(entry);
            await _context.SaveChangesAsync();

            return CreatedAtAction(nameof(Active), await ProjectByIdAsync(entry.Id));
        }

        // PATCH /api/time-entries/{id}  { startedAt?, endedAt?, description?, projectId?, taskId? }
        // Edit an entry. Present-key (omit = keep): timestamps stay ordered when closed;
        // description/projectId/taskId accept null to clear/unlink (#86). We don't reopen a
        // closed entry here (use the timer for live tracking), so endedAt must be a datetime.
        [HttpPatch("{id:int}")]
        public async Task<IActionResult> Update(int id, [FromBody] JsonElement body)
        {
            var entry = await _context.TimeEntries.FindAsync(id);
            if (entry is null)
                return NotFound(new { message = $"Time entry {id} not found." });
            if (body.ValueKind != JsonValueKind.Object)
                return BadRequest(new { message = "Request body must be a JSON object." });

            if (body.TryGetProperty("startedAt", out var startEl))
            {
                if (startEl.ValueKind != JsonValueKind.String || !startEl.TryGetDateTime(out var s))
                    return BadRequest(new { message = "startedAt must be an ISO 8601 date string." });
                entry.StartedAt = s;
            }
            if (body.TryGetProperty("endedAt", out var endEl))
            {
                if (endEl.ValueKind != JsonValueKind.String || !endEl.TryGetDateTime(out var e))
                    return BadRequest(new { message = "endedAt must be an ISO 8601 date string." });
                entry.EndedAt = e;
            }
            if (entry.EndedAt is DateTime ended && ended <= entry.StartedAt)
                return BadRequest(new { message = "End time must be after the start time." });

            if (body.TryGetProperty("description", out var descEl))
            {
                if (descEl.ValueKind == JsonValueKind.Null)
                    entry.Description = null;
                else if (descEl.ValueKind == JsonValueKind.String)
                {
                    if (!TryNormalizeDescription(descEl.GetString(), out var d))
                        return BadRequest(new { message = $"Description must be {MaxDescriptionLength} characters or fewer." });
                    entry.Description = d;
                }
                else
                    return BadRequest(new { message = "description must be a string or null." });
            }

            if (body.TryGetProperty("projectId", out var projEl))
            {
                if (projEl.ValueKind == JsonValueKind.Null)
                    entry.ProjectId = null;
                else if (projEl.ValueKind == JsonValueKind.Number && projEl.TryGetInt32(out var pid))
                {
                    if (!await _context.Projects.AnyAsync(p => p.Id == pid))
                        return NotFound(new { message = $"Project {pid} not found." });
                    entry.ProjectId = pid;
                }
                else
                    return BadRequest(new { message = "projectId must be an integer or null." });
            }

            if (body.TryGetProperty("taskId", out var taskEl))
            {
                if (taskEl.ValueKind == JsonValueKind.Null)
                    entry.TaskId = null;
                else if (taskEl.ValueKind == JsonValueKind.Number && taskEl.TryGetInt32(out var tid))
                {
                    if (!await _context.Tasks.AnyAsync(t => t.Id == tid))
                        return NotFound(new { message = $"Task {tid} not found." });
                    entry.TaskId = tid;
                }
                else
                    return BadRequest(new { message = "taskId must be an integer or null." });
            }

            await _context.SaveChangesAsync();
            return Ok(await ProjectByIdAsync(id));
        }

        // DELETE /api/time-entries/{id} - hard delete a logged interval.
        [HttpDelete("{id:int}")]
        public async Task<IActionResult> Delete(int id)
        {
            var entry = await _context.TimeEntries.FindAsync(id);
            if (entry is null)
                return NotFound(new { message = $"Time entry {id} not found." });

            _context.TimeEntries.Remove(entry);
            await _context.SaveChangesAsync();
            return NoContent();
        }

        // Stop every running entry (normally at most one) - the single-timer invariant.
        private async Task StopAllRunning(DateTime now)
        {
            var running = await _context.TimeEntries.Where(e => e.EndedAt == null).ToListAsync();
            foreach (var r in running) CloseEntry(r, now);
        }

        // Close a running entry at `endedAt`, applying the #86 tidy rules to the STORED data:
        //  - discard it if the real duration is under 2.5 min (an accidental start/stop);
        //  - otherwise snap BOTH edges to the nearest 5-min grid, so the calendar is smooth and
        //    consecutive entries stay contiguous (a shared transition instant rounds to the same
        //    value on both sides). Applied only on close, so the timestamps are already in the
        //    past - no future-dated starts, and a running timer is never touched.
        // Returns false if the entry was discarded (removed from the context).
        private bool CloseEntry(TimeEntry entry, DateTime endedAt)
        {
            if ((endedAt - entry.StartedAt).TotalSeconds < MinDurationSeconds)
            {
                _context.TimeEntries.Remove(entry);
                return false;
            }
            entry.StartedAt = SnapToGrid(entry.StartedAt);
            entry.EndedAt = SnapToGrid(endedAt);
            if (entry.EndedAt <= entry.StartedAt) // a ~2.5 min edge case that snapped to zero length
            {
                _context.TimeEntries.Remove(entry);
                return false;
            }
            return true;
        }

        // Round a timestamp to the nearest 5-minute mark (ties round up).
        private static DateTime SnapToGrid(DateTime t)
        {
            var mins = Math.Round(t.TimeOfDay.TotalMinutes / SnapMinutes, MidpointRounding.AwayFromZero) * SnapMinutes;
            return t.Date.AddMinutes(mins);
        }

        private async Task<TaskModel?> ResolveTaskAsync(int? taskId) =>
            taskId.HasValue ? await _context.Tasks.FindAsync(taskId.Value) : null;

        // Eager-load both the linked task's project and the entry's own project, each with
        // its client, so Project(...) can resolve the effective grouping without extra queries.
        private static IQueryable<TimeEntry> WithGrouping(IQueryable<TimeEntry> query) =>
            query
                .Include(e => e.Task!).ThenInclude(t => t.Project!).ThenInclude(p => p.Client)
                .Include(e => e.Project!).ThenInclude(p => p.Client);

        private async Task<TimeEntryResponse> ProjectByIdAsync(int id)
        {
            var entry = await WithGrouping(_context.TimeEntries).FirstAsync(e => e.Id == id);
            return Project(entry);
        }

        private static TimeEntryResponse Project(TimeEntry e)
        {
            // Effective project: the entry's own (#86) if set, else the linked task's project.
            // The fallback keeps legacy (pre-#86) entries and task-defaulted display working.
            var proj = e.Project ?? e.Task?.Project;
            return new(
                e.Id,
                e.TaskId,
                e.Task?.Title ?? "",
                e.Description,
                proj?.Id,
                proj?.Color,
                proj?.ClientId,
                proj?.Client?.Name,
                proj?.Client?.Color,
                e.StartedAt,
                e.EndedAt,
                e.DurationSeconds);
        }

        // Trim + cap a description. Returns false if over the limit. Blank -> null.
        private static bool TryNormalizeDescription(string? raw, out string? normalized)
        {
            var trimmed = raw?.Trim();
            if (string.IsNullOrEmpty(trimmed)) { normalized = null; return true; }
            if (trimmed.Length > MaxDescriptionLength) { normalized = null; return false; }
            normalized = trimmed;
            return true;
        }
    }

    // All fields optional (#86): a task-free bare timer is valid. JSON binds by name, so the
    // positional order here is only for C# call sites.
    public record StartRequest(int? TaskId = null, string? Description = null, int? ProjectId = null);

    // StartedAt/EndedAt are required; task/description/project are optional. Required params
    // lead so the optionals can default. JSON binds by name regardless of this order.
    public record ManualRequest(DateTime StartedAt, DateTime EndedAt, int? TaskId = null, string? Description = null, int? ProjectId = null);

    // Autocomplete row: a past description + the project it was most recently used with.
    public record EntrySuggestion(string Description, int? ProjectId);

    // The timeline-facing shape: the interval plus the denormalized task title, description,
    // and the effective project color + client it needs to render a block without a second lookup.
    public record TimeEntryResponse(
        int Id,
        int? TaskId,
        string TaskTitle,
        string? Description,
        int? ProjectId,
        string? ProjectColor,
        int? ClientId,
        string? ClientName,
        string? ClientColor,
        DateTime StartedAt,
        DateTime? EndedAt,
        int DurationSeconds);
}
