using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Tasklog.Api.Data;
using Tasklog.Api.Models;

namespace Tasklog.Api.Controllers
{
    // Journal (#79). Templates are code-defined (Services/JournalTemplates.cs) and served
    // from the table Program.cs seeds. Entries are one-per-template-per-date and always
    // upserted, never duplicated - the unique index makes that a DB guarantee. Content is
    // an opaque JSON object keyed by section key; the server validates it is a JSON object
    // and leaves the shape to the client + markdown renderer.
    [ApiController]
    [Route("api/journal")]
    public class JournalController : ControllerBase
    {
        private readonly TasklogDbContext _context;

        public JournalController(TasklogDbContext context)
        {
            _context = context;
        }

        // GET /api/journal/templates - all templates in display order, sections parsed.
        [HttpGet("templates")]
        public async Task<IActionResult> Templates()
        {
            var templates = await _context.JournalTemplates
                .OrderBy(t => t.SortOrder)
                .ToListAsync();
            return Ok(templates.Select(ProjectTemplate).ToList());
        }

        // GET /api/journal/entries?date=yyyy-MM-dd - all entries for that day (any template).
        // Days with no entries return an empty array; nothing is auto-created by a read.
        [HttpGet("entries")]
        public async Task<IActionResult> Entries([FromQuery] DateTime? date)
        {
            var day = (date ?? DateTime.Today).Date;
            var entries = await _context.JournalEntries
                .Include(e => e.Template)
                .Where(e => e.EntryDate == day)
                .ToListAsync();
            return Ok(entries.Select(ProjectEntry).ToList());
        }

        // GET /api/journal/entries/dates?from=&to= - which days in the range have at least
        // one entry (drives the calendar's entry dots). Defaults to the current month window.
        [HttpGet("entries/dates")]
        public async Task<IActionResult> EntryDates([FromQuery] DateTime? from, [FromQuery] DateTime? to)
        {
            var start = (from ?? new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1)).Date;
            var end = (to ?? start.AddMonths(1)).Date;
            if ((end - start).TotalDays > 400)
                return BadRequest(new { message = "Date range must not exceed 400 days." });

            var dates = await _context.JournalEntries
                .Where(e => e.EntryDate >= start && e.EntryDate < end)
                .Select(e => e.EntryDate)
                .Distinct()
                .OrderBy(d => d)
                .ToListAsync();
            return Ok(dates.Select(d => d.ToString("yyyy-MM-dd")).ToList());
        }

        // PUT /api/journal/entries/{templateKey}/{date}  { content: { ... } }
        // Upsert: creates the day's entry for that template or replaces its content.
        // 200 with the stored entry either way; 404 unknown template; 400 bad content.
        [HttpPut("entries/{templateKey}/{date}")]
        public async Task<IActionResult> Upsert(string templateKey, DateTime date, [FromBody] JsonElement body)
        {
            var template = await _context.JournalTemplates.FirstOrDefaultAsync(t => t.Key == templateKey);
            if (template is null)
                return NotFound(new { message = $"Journal template '{templateKey}' not found." });

            if (body.ValueKind != JsonValueKind.Object
                || !body.TryGetProperty("content", out var content)
                || content.ValueKind != JsonValueKind.Object)
                return BadRequest(new { message = "Body must be { content: { ... } } with content as a JSON object." });

            // A day's note is prose, not a payload: cap the stored blob so a runaway
            // client can't grow the DB (and the zip export) without bound.
            var raw = content.GetRawText();
            if (raw.Length > 256 * 1024)
                return BadRequest(new { message = "Entry content must be under 256KB." });

            var day = date.Date;
            var now = DateTime.Now;
            var entry = await _context.JournalEntries
                .FirstOrDefaultAsync(e => e.TemplateId == template.Id && e.EntryDate == day);

            if (entry is null)
            {
                entry = new JournalEntry
                {
                    TemplateId = template.Id,
                    EntryDate = day,
                    CreatedAt = now,
                };
                _context.JournalEntries.Add(entry);
            }
            entry.ContentJson = raw;
            entry.UpdatedAt = now;
            await _context.SaveChangesAsync();

            entry.Template = template;
            return Ok(ProjectEntry(entry));
        }

        // PATCH /api/journal/entries/{templateKey}/{date}/sections  { sections: { key: value } }
        // Server-side per-section merge (v4.1, D2) - the concurrent-writer answer. The PUT
        // above replaces the whole content and stays for the tab editor; every OTHER writer
        // (Sage's weave, the note confirm handler) merges through here so an agent write can
        // never clobber an open tab's autosave. Semantics by the template's section kind:
        //   prose   - append with a blank-line separator (set when empty). Value: string.
        //   mind    - append items. Value: array of { text, cleared?, verdict? }.
        //   list    - append strings. Value: array of strings.
        //   plan    - replace (a plan is rebuilt, not accreted). Value: object.
        //   projects- replace. Value: array.
        //   evening - shallow-merge provided fields only. Value: object.
        //   checkins- rejected: derived from MoodCheckins, never written.
        [HttpPatch("entries/{templateKey}/{date}/sections")]
        public async Task<IActionResult> MergeSections(string templateKey, DateTime date, [FromBody] JsonElement body)
        {
            if (body.ValueKind != JsonValueKind.Object
                || !body.TryGetProperty("sections", out var sections))
                return BadRequest(new { message = "Body must be { sections: { ... } } with sections as a JSON object." });

            var result = await Services.JournalSectionMerge.MergeAsync(_context, templateKey, date, sections);
            if (!result.Ok)
                return result.Error!.Contains("not found")
                    ? NotFound(new { message = result.Error })
                    : BadRequest(new { message = result.Error });
            return Ok(ProjectEntry(result.Entry!));
        }

        // GET /api/journal/export?date=yyyy-MM-dd - the day's full note as a .md download.
        // The preview pane fetches this too (same renderer output, no second code path).
        [HttpGet("export")]
        public async Task<IActionResult> ExportDay([FromQuery] DateTime? date)
        {
            var day = (date ?? DateTime.Today).Date;
            var templates = await _context.JournalTemplates.OrderBy(t => t.SortOrder).ToListAsync();
            var markdown = await RenderDayAsync(day, templates);
            return File(System.Text.Encoding.UTF8.GetBytes(markdown), "text/markdown", $"{day:yyyy-MM-dd}.md");
        }

        // GET /api/journal/export/all - every day that has an entry, one .md each, zipped.
        // The user's Obsidian-bound archive; Tasklog stays the source of truth.
        [HttpGet("export/all")]
        public async Task<IActionResult> ExportAll()
        {
            var templates = await _context.JournalTemplates.OrderBy(t => t.SortOrder).ToListAsync();
            var dates = await _context.JournalEntries
                .Select(e => e.EntryDate).Distinct().OrderBy(d => d).ToListAsync();

            using var buffer = new MemoryStream();
            using (var zip = new System.IO.Compression.ZipArchive(buffer, System.IO.Compression.ZipArchiveMode.Create, leaveOpen: true))
            {
                foreach (var day in dates)
                {
                    var entry = zip.CreateEntry($"{day:yyyy-MM-dd}.md");
                    using var writer = new StreamWriter(entry.Open(), System.Text.Encoding.UTF8);
                    writer.Write(await RenderDayAsync(day, templates));
                }
            }
            return File(buffer.ToArray(), "application/zip", "journal-export.zip");
        }

        // Resolve everything JournalMarkdown.Render needs for one day: parsed entry
        // contents, the day's mood check-ins, plan-task display states, and the derived
        // "unplanned, got done" titles (completed that day, not referenced by the plan).
        private async Task<string> RenderDayAsync(DateTime day, List<JournalTemplate> templates)
        {
            var entries = await _context.JournalEntries
                .Include(e => e.Template)
                .Where(e => e.EntryDate == day)
                .ToListAsync();
            var contentByKey = entries.ToDictionary(
                e => e.Template!.Key,
                e => JsonSerializer.Deserialize<JsonElement>(e.ContentJson));

            var dayEnd = day.AddDays(1);
            var checkins = (await _context.MoodCheckins
                .Where(m => m.CheckinAt >= day && m.CheckinAt < dayEnd)
                .OrderBy(m => m.CheckinAt)
                .ToListAsync())
                .Select(m => new Services.JournalMarkdown.CheckinData(
                    m.CheckinAt,
                    JsonSerializer.Deserialize<string[]>(m.WordsJson) ?? Array.Empty<string>(),
                    m.Energy,
                    m.MocLevel))
                .ToList();

            var planIds = ExtractPlanTaskIds(contentByKey);
            var planTasks = (await _context.Tasks.Where(t => planIds.Contains(t.Id)).ToListAsync())
                .ToDictionary(t => t.Id, t => new Services.JournalMarkdown.PlanTaskData(t.Id, t.Title, t.IsCompleted));

            var unplanned = await _context.Tasks
                .Where(t => t.CompletedAt.HasValue && t.CompletedAt.Value >= day && t.CompletedAt.Value < dayEnd
                            && !planIds.Contains(t.Id))
                .OrderBy(t => t.CompletedAt)
                .Select(t => t.Title)
                .ToListAsync();

            return Services.JournalMarkdown.Render(day, templates, contentByKey, checkins, planTasks, unplanned);
        }

        // Pull every task id referenced by any plan-kind section (daily's todays_plan).
        private static List<int> ExtractPlanTaskIds(IReadOnlyDictionary<string, JsonElement> contentByKey)
        {
            var ids = new List<int>();
            foreach (var content in contentByKey.Values)
            {
                if (content.ValueKind != JsonValueKind.Object) continue;
                foreach (var section in content.EnumerateObject())
                {
                    if (section.Value.ValueKind != JsonValueKind.Object
                        || !section.Value.TryGetProperty("buckets", out var buckets)
                        || buckets.ValueKind != JsonValueKind.Object) continue;
                    foreach (var bucket in buckets.EnumerateObject())
                    {
                        if (bucket.Value.ValueKind != JsonValueKind.Array) continue;
                        foreach (var idEl in bucket.Value.EnumerateArray())
                            if (idEl.TryGetInt32(out var id)) ids.Add(id);
                    }
                }
            }
            return ids;
        }

        // Sections/content are stored as raw JSON text; parse them into the response so
        // clients receive real JSON instead of a double-encoded string.
        private static object ProjectTemplate(JournalTemplate t) => new
        {
            t.Id,
            t.Key,
            t.Name,
            t.Periodicity,
            t.SortOrder,
            Sections = JsonSerializer.Deserialize<JsonElement>(t.SectionsJson),
        };

        private static object ProjectEntry(JournalEntry e) => new
        {
            e.Id,
            TemplateKey = e.Template?.Key ?? "",
            EntryDate = e.EntryDate.ToString("yyyy-MM-dd"),
            Content = JsonSerializer.Deserialize<JsonElement>(e.ContentJson),
            e.CreatedAt,
            e.UpdatedAt,
        };
    }
}
