using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Tasklog.Api.Data;
using Tasklog.Api.Models;

namespace Tasklog.Api.Controllers
{
    // The Capture inbox (#87, reshaped in #92) - the generic ingest + audit layer of the
    // Living Profile. v4.0 ran a propose-then-approve trust loop; v4.1 inverts it (plan
    // D1): Sage is AUTONOMOUS - writers create AND confirm in one transactional call, the
    // entity lands in its typed home immediately, and the capture row survives as the
    // receipt. The trust loop moved after the act: every Sage-written entity carries a
    // receipt affordance (edit / update / delete / undo). Dismissing a confirmed capture
    // is the UNDO - it reverses the materialized entity.
    //
    // Type/Status/Source are strings, not enums: the registry grows without a migration
    // per facet. v4.1 registers: task, mood, thought, note (journal weave), expense, time.
    [ApiController]
    [Route("api/captures")]
    public class CapturesController : ControllerBase
    {
        private static readonly HashSet<string> RegisteredTypes =
            new() { "task", "mood", "thought", "note", "expense", "time" };

        private static readonly HashSet<string> NoteKinds =
            new() { "memory", "idea", "reflection", "quote", "wish", "note" };

        private const int MaxTitleChars = 500;
        private const int MaxSpanChars = 500;
        private const int MaxSourceChars = 50;
        private const int MaxPayloadChars = 4000;
        // The weave carries whole journal sections; thoughts carry markdown bodies.
        private const int MaxLargePayloadChars = 16384;

        private readonly TasklogDbContext _context;
        private readonly Services.EmbeddingService? _embeddings;

        public CapturesController(TasklogDbContext context, Services.EmbeddingService? embeddings = null)
        {
            _context = context;
            _embeddings = embeddings;
        }

        private static int MaxPayloadFor(string type) =>
            type is "note" or "thought" ? MaxLargePayloadChars : MaxPayloadChars;

        // GET /api/captures?status=&sessionId= - the receipts drawer / audit trail.
        [HttpGet]
        public async Task<IActionResult> List([FromQuery] string? status, [FromQuery] int? sessionId)
        {
            var query = _context.Captures.AsQueryable();
            if (!string.IsNullOrWhiteSpace(status)) query = query.Where(c => c.Status == status);
            if (sessionId is not null) query = query.Where(c => c.SessionId == sessionId);
            var captures = await query.OrderByDescending(c => c.CreatedAt).ToListAsync();
            return Ok(captures.Select(Project).ToList());
        }

        [HttpGet("{id:int}")]
        public async Task<IActionResult> GetById(int id)
        {
            var capture = await _context.Captures.FindAsync(id);
            return capture is null
                ? NotFound(new { message = $"Capture {id} not found." })
                : Ok(Project(capture));
        }

        // POST /api/captures  { type, payload, sessionId?, span?, confidence?, source?, autoConfirm? }
        // autoConfirm=true (the v4.1 default posture for Sage) creates the capture and
        // materializes its typed home in the same call - one receipt, one entity, no card.
        // autoConfirm=false/absent keeps the v4.0 proposed flow (manual/MCP writers may
        // still want a staging step).
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] CaptureRequest request)
        {
            if (string.IsNullOrWhiteSpace(request.Type) || !RegisteredTypes.Contains(request.Type))
                return BadRequest(new { message = $"type must be one of: {string.Join(", ", RegisteredTypes)}." });
            if (request.Payload.ValueKind != JsonValueKind.Object)
                return BadRequest(new { message = "payload must be a JSON object." });
            if (request.Payload.GetRawText().Length > MaxPayloadFor(request.Type))
                return BadRequest(new { message = "payload too large." });
            if (request.Confidence is < 0 or > 1)
                return BadRequest(new { message = "confidence must be between 0 and 1." });
            if (request.Span is { Length: > MaxSpanChars })
                return BadRequest(new { message = $"span must be {MaxSpanChars} characters or fewer." });
            if (request.Source is { Length: > MaxSourceChars })
                return BadRequest(new { message = $"source must be {MaxSourceChars} characters or fewer." });

            var structural = ValidateStructure(request.Type, request.Payload);
            if (structural is not null)
                return BadRequest(new { message = structural });

            if (request.SessionId is not null)
            {
                var sessionExists = await _context.CompanionSessions
                    .AnyAsync(s => s.Id == request.SessionId);
                if (!sessionExists)
                    return BadRequest(new { message = $"Companion session {request.SessionId} not found." });

                // Dedupe within the conversation by normalized title (task type). Any
                // status counts: a dismissed "Call the plumber" must stay dismissed.
                var title = GetTitle(request.Payload);
                if (request.Type == "task" && title is not null)
                {
                    var normalized = title.Trim().ToLowerInvariant();
                    var existing = (await _context.Captures
                            .Where(c => c.SessionId == request.SessionId && c.Type == request.Type)
                            .ToListAsync())
                        .FirstOrDefault(c => GetTitle(JsonSerializer.Deserialize<JsonElement>(c.PayloadJson))
                            ?.Trim().ToLowerInvariant() == normalized);
                    if (existing is not null)
                        return Ok(Project(existing));
                }
            }

            var capture = new Capture
            {
                Type = request.Type,
                Status = "proposed",
                Source = string.IsNullOrWhiteSpace(request.Source) ? "companion" : request.Source!,
                SessionId = request.SessionId,
                PayloadJson = request.Payload.GetRawText(),
                Span = string.IsNullOrWhiteSpace(request.Span) ? null : request.Span,
                Confidence = request.Confidence,
                CreatedAt = DateTime.Now,
                UpdatedAt = DateTime.Now,
            };
            _context.Captures.Add(capture);
            await _context.SaveChangesAsync();

            if (request.AutoConfirm == true)
                return await ConfirmCore(capture);

            return CreatedAtAction(nameof(GetById), new { id = capture.Id }, Project(capture));
        }

        // PATCH /api/captures/{id}  { payload, sessionId? } - edit a proposal before
        // confirming. Only proposed captures are editable; resolved ones are receipts
        // (edit the entity itself instead - pin 17: everything is editable at home).
        [HttpPatch("{id:int}")]
        public async Task<IActionResult> Update(int id, [FromBody] JsonElement body)
        {
            var capture = await _context.Captures.FindAsync(id);
            if (capture is null)
                return NotFound(new { message = $"Capture {id} not found." });
            if (capture.Status != "proposed")
                return BadRequest(new { message = $"Capture {id} is {capture.Status}; edit the created entity instead." });

            if (body.TryGetProperty("sessionId", out var sid))
            {
                if (sid.ValueKind != JsonValueKind.Number || capture.SessionId != sid.GetInt32())
                    return BadRequest(new { message = $"Capture {id} does not belong to this conversation." });
            }

            if (!body.TryGetProperty("payload", out var payload) || payload.ValueKind != JsonValueKind.Object)
                return BadRequest(new { message = "payload must be a JSON object." });
            if (payload.GetRawText().Length > MaxPayloadFor(capture.Type))
                return BadRequest(new { message = "payload too large." });
            var structural = ValidateStructure(capture.Type, payload);
            if (structural is not null)
                return BadRequest(new { message = structural });

            capture.PayloadJson = payload.GetRawText();
            capture.UpdatedAt = DateTime.Now;
            await _context.SaveChangesAsync();
            return Ok(Project(capture));
        }

        // POST /api/captures/{id}/confirm - materializes the typed home. Kept for the
        // staged (non-auto) flow and idempotent for already-confirmed receipts.
        [HttpPost("{id:int}/confirm")]
        public async Task<IActionResult> Confirm(int id)
        {
            var capture = await _context.Captures.FindAsync(id);
            if (capture is null)
                return NotFound(new { message = $"Capture {id} not found." });
            if (capture.Status == "confirmed")
                return Ok(Project(capture));
            if (capture.Status == "dismissed")
                return BadRequest(new { message = $"Capture {id} was dismissed; it cannot be confirmed." });
            return await ConfirmCore(capture);
        }

        // The shared claim + materialize body (plan D1). Claim is a guarded UPDATE inside
        // one transaction on relational providers (review R5/R18): two concurrent confirms
        // cannot double-materialize, and a crash cannot leave a confirmed capture without
        // its ConfirmedId. The InMemory test provider runs the same body optimistically.
        private async Task<IActionResult> ConfirmCore(Capture capture)
        {
            var payload = JsonSerializer.Deserialize<JsonElement>(capture.PayloadJson);

            var relational = _context.Database.IsRelational();
            await using var tx = relational ? await _context.Database.BeginTransactionAsync() : null;
            if (relational)
            {
                var claimed = await _context.Captures
                    .Where(c => c.Id == capture.Id && c.Status == "proposed")
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(c => c.Status, "confirmed")
                        .SetProperty(c => c.UpdatedAt, DateTime.Now));
                if (claimed == 0)
                {
                    await tx!.RollbackAsync();
                    await _context.Entry(capture).ReloadAsync();
                    return capture.Status == "confirmed"
                        ? Ok(Project(capture))
                        : BadRequest(new { message = $"Capture {capture.Id} was dismissed; it cannot be confirmed." });
                }
                await _context.Entry(capture).ReloadAsync();
            }

            var (confirmedType, entity, error) = capture.Type switch
            {
                "task" => await MaterializeTask(payload),
                "mood" => MaterializeMood(payload),
                "thought" => MaterializeThought(capture, payload),
                "expense" => await MaterializeExpense(payload),
                "time" => await MaterializeTime(payload),
                "note" => await MaterializeWeave(payload),
                _ => (null, null, $"No writer registered for type '{capture.Type}'."),
            };
            if (error is not null)
            {
                if (tx is not null) await tx.RollbackAsync();
                return BadRequest(new { message = error });
            }

            capture.Status = "confirmed";
            capture.ConfirmedType = confirmedType;
            capture.UpdatedAt = DateTime.Now;
            await _context.SaveChangesAsync(); // new entities get their ids here

            capture.ConfirmedId = EntityId(entity!);
            await _context.SaveChangesAsync();

            if (tx is not null) await tx.CommitAsync();

            // Semantic index entry AFTER commit - a failed embed never rolls back a write.
            if (_embeddings is not null)
            {
                if (entity is TaskModel t) await _embeddings.UpsertAsync("task", t.Id, t.Title);
                if (entity is Note n) await _embeddings.UpsertAsync("note", n.Id, $"{n.Title}\n{n.BodyMd}");
            }

            return Ok(new { capture = Project(capture), entity });
        }

        // ---- writers (one per registered type) ----

        private async Task<(string?, object?, string?)> MaterializeTask(JsonElement payload)
        {
            var title = GetTitle(payload);
            if (title is null) return (null, null, "a task payload requires a non-empty title.");

            int? projectId = null;
            if (payload.TryGetProperty("projectId", out var pid) && pid.ValueKind == JsonValueKind.Number)
            {
                projectId = pid.GetInt32();
                if (!await _context.Projects.AnyAsync(p => p.Id == projectId))
                    return (null, null, $"Project {projectId} not found. Edit the capture first.");
            }

            DateTime? deadline = null;
            if (payload.TryGetProperty("deadline", out var dl) && dl.ValueKind == JsonValueKind.String)
            {
                if (!DateTime.TryParse(dl.GetString(), out var parsed))
                    return (null, null, "deadline is not a valid date. Edit the capture first.");
                deadline = parsed;
            }

            // newProjectName (#87): one confirm materializes BOTH task and project.
            // Get-or-create by name; an explicit existing projectId wins.
            if (projectId is null &&
                payload.TryGetProperty("newProjectName", out var npn) &&
                npn.ValueKind == JsonValueKind.String &&
                !string.IsNullOrWhiteSpace(npn.GetString()))
            {
                var name = npn.GetString()!.Trim();
                var project = (await _context.Projects.ToListAsync())
                    .FirstOrDefault(p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase));
                if (project is null)
                {
                    var maxPosition = await _context.Projects.AnyAsync()
                        ? await _context.Projects.MaxAsync(p => p.Position)
                        : 0;
                    project = new Project { Name = name, Position = maxPosition + 1, CreatedAt = DateTime.Now };
                    _context.Projects.Add(project);
                    await _context.SaveChangesAsync();
                }
                projectId = project.Id;
            }

            var task = new TaskModel { Title = title, ProjectId = projectId, Deadline = deadline, CreatedAt = DateTime.Now };
            _context.Tasks.Add(task);
            return ("task", task, null);
        }

        private (string?, object?, string?) MaterializeMood(JsonElement payload)
        {
            var words = payload.TryGetProperty("words", out var w) && w.ValueKind == JsonValueKind.Array
                ? w.GetRawText() : "[]";
            int? energy = payload.TryGetProperty("energy", out var e) && e.ValueKind == JsonValueKind.Number
                ? e.GetInt32() : null;
            if (energy is < 0 or > 10) return (null, null, "energy must be between 0 and 10.");
            int? moc = payload.TryGetProperty("mocLevel", out var m) && m.ValueKind == JsonValueKind.Number
                ? m.GetInt32() : null;
            var at = payload.TryGetProperty("checkinAt", out var ca) && ca.ValueKind == JsonValueKind.String
                     && DateTime.TryParse(ca.GetString(), out var parsed) ? parsed : DateTime.Now;

            var checkin = new MoodCheckin
            {
                CheckinAt = at, WordsJson = words, Energy = energy, MocLevel = moc, CreatedAt = DateTime.Now,
            };
            _context.MoodCheckins.Add(checkin);
            return ("moodCheckin", checkin, null);
        }

        private (string?, object?, string?) MaterializeThought(Capture capture, JsonElement payload)
        {
            var title = GetTitle(payload);
            if (title is null) return (null, null, "a thought payload requires a non-empty title.");
            var kind = payload.TryGetProperty("kind", out var k) && k.ValueKind == JsonValueKind.String
                ? k.GetString()! : "note";
            if (!NoteKinds.Contains(kind))
                return (null, null, $"kind must be one of: {string.Join(", ", NoteKinds)}.");

            var note = new Note
            {
                Title = title,
                // Cleaned body from the model; the verbatim original lives on the capture
                // row (Span/payload) - the two-pass rule made structural.
                BodyMd = payload.TryGetProperty("bodyMd", out var b) && b.ValueKind == JsonValueKind.String
                    ? b.GetString()! : capture.Span ?? "",
                Kind = kind,
                AboutJson = payload.TryGetProperty("about", out var a) && a.ValueKind == JsonValueKind.Array
                    ? a.GetRawText() : "[]",
                Source = payload.TryGetProperty("source", out var src) && src.ValueKind == JsonValueKind.String
                    ? src.GetString() : null,
                OriginDate = payload.TryGetProperty("originDate", out var od) && od.ValueKind == JsonValueKind.String
                             && DateTime.TryParse(od.GetString(), out var d) ? d.Date : DateTime.Today,
                CreatedAt = DateTime.Now,
                UpdatedAt = DateTime.Now,
            };
            _context.Notes.Add(note);
            return ("note", note, null);
        }

        private async Task<(string?, object?, string?)> MaterializeExpense(JsonElement payload)
        {
            if (!payload.TryGetProperty("amount", out var amt) || amt.ValueKind != JsonValueKind.Number || amt.GetDouble() <= 0)
                return (null, null, "an expense payload requires a positive amount.");
            var note = payload.TryGetProperty("note", out var n) && n.ValueKind == JsonValueKind.String
                ? n.GetString()!.Trim() : "";
            if (note.Length == 0) return (null, null, "an expense payload requires a note (what it was).");

            int? projectId = null;
            if (payload.TryGetProperty("projectId", out var pid) && pid.ValueKind == JsonValueKind.Number)
            {
                projectId = pid.GetInt32();
                if (!await _context.Projects.AnyAsync(p => p.Id == projectId))
                    return (null, null, $"Project {projectId} not found.");
            }

            var expense = new Expense
            {
                Amount = amt.GetDouble(),
                Direction = payload.TryGetProperty("direction", out var dir) && dir.GetString() == "in" ? "in" : "out",
                OccurredOn = payload.TryGetProperty("occurredOn", out var oc) && oc.ValueKind == JsonValueKind.String
                             && DateTime.TryParse(oc.GetString(), out var d) ? d.Date : DateTime.Today,
                Note = note,
                SplitJson = payload.TryGetProperty("split", out var sp) && sp.ValueKind == JsonValueKind.Object
                    ? sp.GetRawText() : "{}",
                ProjectId = projectId,
                CreatedAt = DateTime.Now,
                UpdatedAt = DateTime.Now,
            };
            _context.Expenses.Add(expense);
            return ("expense", expense, null);
        }

        // Time narration (dogfood: "ended rise and shine 10 mins ago", "now lunch").
        // ops: start (auto-stops running), stop, manual (closed interval), edit (retro).
        // No grid-snapping here - agent writes record what was said; the Time tab's own
        // editor keeps its snapping behavior.
        private async Task<(string?, object?, string?)> MaterializeTime(JsonElement payload)
        {
            var op = payload.TryGetProperty("op", out var o) && o.ValueKind == JsonValueKind.String
                ? o.GetString() : null;
            var now = DateTime.Now;

            DateTime? Get(string name) =>
                payload.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
                && DateTime.TryParse(v.GetString(), out var d) ? d : null;
            string? Desc() =>
                payload.TryGetProperty("description", out var v) && v.ValueKind == JsonValueKind.String
                    ? v.GetString() : null;

            int? taskId = payload.TryGetProperty("taskId", out var t) && t.ValueKind == JsonValueKind.Number
                ? t.GetInt32() : null;
            TaskModel? task = null;
            if (taskId is not null)
            {
                task = await _context.Tasks.FindAsync(taskId);
                if (task is null) return (null, null, $"Task {taskId} not found.");
            }

            switch (op)
            {
                case "start":
                {
                    var running = await _context.TimeEntries.Where(x => x.EndedAt == null).ToListAsync();
                    foreach (var r in running) r.EndedAt = now;
                    var entry = new TimeEntry
                    {
                        TaskId = task?.Id,
                        Description = Desc(),
                        ProjectId = task?.ProjectId,
                        StartedAt = Get("startedAt") ?? now,
                        CreatedAt = now,
                    };
                    _context.TimeEntries.Add(entry);
                    return ("timeEntry", entry, null);
                }
                case "stop":
                {
                    var entry = payload.TryGetProperty("entryId", out var eid) && eid.ValueKind == JsonValueKind.Number
                        ? await _context.TimeEntries.FindAsync(eid.GetInt32())
                        : await _context.TimeEntries.Where(x => x.EndedAt == null)
                            .OrderByDescending(x => x.StartedAt).FirstOrDefaultAsync();
                    if (entry is null) return (null, null, "no running time entry to stop.");
                    entry.EndedAt = Get("endedAt") ?? now;
                    return ("timeEntry", entry, null);
                }
                case "manual":
                {
                    var start = Get("startedAt");
                    var end = Get("endedAt");
                    if (start is null || end is null || end <= start)
                        return (null, null, "a manual time payload requires ordered startedAt and endedAt.");
                    var entry = new TimeEntry
                    {
                        TaskId = task?.Id,
                        Description = Desc(),
                        ProjectId = task?.ProjectId,
                        StartedAt = start.Value,
                        EndedAt = end.Value,
                        CreatedAt = now,
                    };
                    _context.TimeEntries.Add(entry);
                    return ("timeEntry", entry, null);
                }
                case "edit":
                {
                    if (!payload.TryGetProperty("entryId", out var eid) || eid.ValueKind != JsonValueKind.Number)
                        return (null, null, "a time edit requires entryId.");
                    var entry = await _context.TimeEntries.FindAsync(eid.GetInt32());
                    if (entry is null) return (null, null, $"Time entry {eid.GetInt32()} not found.");
                    if (Get("startedAt") is DateTime s) entry.StartedAt = s;
                    if (Get("endedAt") is DateTime e2) entry.EndedAt = e2;
                    if (Desc() is string ds) entry.Description = ds;
                    if (task is not null) { entry.TaskId = task.Id; entry.ProjectId ??= task.ProjectId; }
                    if (entry.EndedAt is DateTime ee && ee <= entry.StartedAt)
                        return (null, null, "endedAt must be after startedAt.");
                    return ("timeEntry", entry, null);
                }
                default:
                    return (null, null, "time op must be one of: start, stop, manual, edit.");
            }
        }

        // The weave (type "note"): merge whole journal sections for a day through the
        // shared merge service - the same semantics as the HTTP PATCH, so an agent write
        // can never clobber an open tab.
        private async Task<(string?, object?, string?)> MaterializeWeave(JsonElement payload)
        {
            var templateKey = payload.TryGetProperty("templateKey", out var tk) && tk.ValueKind == JsonValueKind.String
                ? tk.GetString()! : "daily";
            var date = payload.TryGetProperty("date", out var dt) && dt.ValueKind == JsonValueKind.String
                       && DateTime.TryParse(dt.GetString(), out var d) ? d : DateTime.Today;
            if (!payload.TryGetProperty("sections", out var sections))
                return (null, null, "a note payload requires a sections object.");

            var result = await Services.JournalSectionMerge.MergeAsync(_context, templateKey, date, sections);
            return result.Ok ? ("journalEntry", result.Entry, null) : (null, null, result.Error);
        }

        // POST /api/captures/{id}/restore - undo an accidental TOSS: dismissed -> proposed.
        [HttpPost("{id:int}/restore")]
        public async Task<IActionResult> Restore(int id)
        {
            var capture = await _context.Captures.FindAsync(id);
            if (capture is null)
                return NotFound(new { message = $"Capture {id} not found." });
            if (capture.Status == "proposed")
                return Ok(Project(capture));
            if (capture.Status == "confirmed")
                return BadRequest(new { message = $"Capture {id} is confirmed; there is nothing to restore." });

            capture.Status = "proposed";
            capture.UpdatedAt = DateTime.Now;
            await _context.SaveChangesAsync();
            return Ok(Project(capture));
        }

        // POST /api/captures/{id}/dismiss - on a proposed capture: the TOSS (unchanged).
        // On a CONFIRMED capture: the UNDO (plan D1) - deletes the materialized entity,
        // then marks the receipt dismissed. Weave merges cannot be cleanly un-merged;
        // the journal is edited directly instead.
        [HttpPost("{id:int}/dismiss")]
        public async Task<IActionResult> Dismiss(int id)
        {
            var capture = await _context.Captures.FindAsync(id);
            if (capture is null)
                return NotFound(new { message = $"Capture {id} not found." });
            if (capture.Status == "dismissed")
                return Ok(Project(capture));

            if (capture.Status == "confirmed" && capture.ConfirmedId is int entityId)
            {
                switch (capture.ConfirmedType)
                {
                    case "task":
                        var task = await _context.Tasks.FindAsync(entityId);
                        if (task is not null) _context.Tasks.Remove(task);
                        break;
                    case "moodCheckin":
                        var mood = await _context.MoodCheckins.FindAsync(entityId);
                        if (mood is not null) _context.MoodCheckins.Remove(mood);
                        break;
                    case "note":
                        var note = await _context.Notes.FindAsync(entityId);
                        if (note is not null) _context.Notes.Remove(note);
                        break;
                    case "expense":
                        var expense = await _context.Expenses.FindAsync(entityId);
                        if (expense is not null) _context.Expenses.Remove(expense);
                        break;
                    case "timeEntry":
                        var entry = await _context.TimeEntries.FindAsync(entityId);
                        if (entry is not null) _context.TimeEntries.Remove(entry);
                        break;
                    case "journalEntry":
                        return BadRequest(new { message = "A journal weave cannot be undone wholesale; edit the journal instead." });
                    default:
                        return BadRequest(new { message = $"No undo path for '{capture.ConfirmedType}'." });
                }
            }

            capture.Status = "dismissed";
            capture.UpdatedAt = DateTime.Now;
            await _context.SaveChangesAsync();
            return Ok(Project(capture));
        }

        // ---- helpers ----

        // Structural (propose-time) validation per type: cheap shape checks only; strict
        // referential checks (project ids...) stay in the writers.
        private static string? ValidateStructure(string type, JsonElement payload)
        {
            switch (type)
            {
                case "task":
                case "thought":
                    var title = GetTitle(payload);
                    if (title is null) return $"a {type} payload requires a non-empty title.";
                    if (title.Length > MaxTitleChars) return $"title must be {MaxTitleChars} characters or fewer.";
                    return null;
                case "mood":
                    var hasWords = payload.TryGetProperty("words", out var w)
                                   && w.ValueKind == JsonValueKind.Array && w.GetArrayLength() > 0;
                    var hasEnergy = payload.TryGetProperty("energy", out var e) && e.ValueKind == JsonValueKind.Number;
                    return hasWords || hasEnergy ? null : "a mood payload requires words or energy.";
                case "note":
                    return payload.TryGetProperty("sections", out var s) && s.ValueKind == JsonValueKind.Object
                        ? null : "a note payload requires a sections object.";
                case "expense":
                    return payload.TryGetProperty("amount", out var a) && a.ValueKind == JsonValueKind.Number
                        ? null : "an expense payload requires a numeric amount.";
                case "time":
                    return payload.TryGetProperty("op", out var op) && op.ValueKind == JsonValueKind.String
                        ? null : "a time payload requires an op.";
                default:
                    return null;
            }
        }

        private static string? GetTitle(JsonElement payload)
        {
            if (payload.ValueKind != JsonValueKind.Object) return null;
            if (!payload.TryGetProperty("title", out var t) || t.ValueKind != JsonValueKind.String) return null;
            var title = t.GetString()?.Trim();
            return string.IsNullOrEmpty(title) ? null : title;
        }

        private static int EntityId(object entity) => entity switch
        {
            TaskModel t => t.Id,
            MoodCheckin m => m.Id,
            Note n => n.Id,
            Expense x => x.Id,
            TimeEntry e => e.Id,
            JournalEntry j => j.Id,
            _ => 0,
        };

        // PayloadJson is TEXT in the DB but real JSON on the wire (MoodCheckins precedent).
        private static object Project(Capture c) => new
        {
            c.Id,
            c.Type,
            c.Status,
            c.Source,
            c.SessionId,
            Payload = JsonSerializer.Deserialize<JsonElement>(c.PayloadJson),
            c.Span,
            c.Confidence,
            c.ConfirmedType,
            c.ConfirmedId,
            c.CreatedAt,
            c.UpdatedAt,
        };
    }

    public record CaptureRequest(
        string? Type,
        JsonElement Payload,
        int? SessionId,
        string? Span,
        double? Confidence,
        string? Source,
        bool? AutoConfirm = null);
}
