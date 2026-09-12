using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Tasklog.Api.Data;
using Tasklog.Api.Models;

namespace Tasklog.Api.Services
{
    // The single implementation of per-section journal merging (v4.1, plan D2).
    // Two callers: JournalController.MergeSections (the HTTP PATCH) and the capture
    // note-writer (Sage's weave confirm). One code path so agent writes and API
    // writes can never diverge in semantics.
    public static class JournalSectionMerge
    {
        public sealed record MergeResult(bool Ok, string? Error, JournalEntry? Entry);

        // Merges are serialized process-wide: two concurrent weaves both read-modify-
        // write the whole ContentJson, so without the gate the second SaveChanges wins
        // and silently drops the first one's sections (and two creates of the same day
        // race the unique (TemplateId, EntryDate) index into a 500 - both found by the
        // Step 6 race test). One API process, sub-ms merges: a semaphore is the honest
        // simple fix; the PUT endpoint stays outside it by design (wholesale replace).
        private static readonly SemaphoreSlim Gate = new(1, 1);

        public static async Task<MergeResult> MergeAsync(
            TasklogDbContext context, string templateKey, DateTime date, JsonElement sections)
        {
            await Gate.WaitAsync();
            try
            {
                return await MergeLockedAsync(context, templateKey, date, sections);
            }
            catch (DbUpdateException)
            {
                // A same-moment PUT created the day first: reload and merge once more.
                context.ChangeTracker.Clear();
                return await MergeLockedAsync(context, templateKey, date, sections);
            }
            finally
            {
                Gate.Release();
            }
        }

        private static async Task<MergeResult> MergeLockedAsync(
            TasklogDbContext context, string templateKey, DateTime date, JsonElement sections)
        {
            var template = await context.JournalTemplates.FirstOrDefaultAsync(t => t.Key == templateKey);
            if (template is null)
                return new(false, $"Journal template '{templateKey}' not found.", null);
            if (sections.ValueKind != JsonValueKind.Object)
                return new(false, "sections must be a JSON object.", null);

            // Section kinds come from the template definition - the same source the
            // renderer trusts, so merge semantics can never drift from display.
            var kinds = new Dictionary<string, string>();
            foreach (var def in JsonSerializer.Deserialize<JsonElement>(template.SectionsJson).EnumerateArray())
                kinds[def.GetProperty("key").GetString()!] = def.GetProperty("kind").GetString()!;

            foreach (var prop in sections.EnumerateObject())
            {
                if (!kinds.TryGetValue(prop.Name, out var kind))
                    return new(false, $"Unknown section '{prop.Name}' for template '{templateKey}'.", null);
                if (kind == "checkins")
                    return new(false, "The checkins section is derived and cannot be written.", null);
            }

            var day = date.Date;
            var now = DateTime.Now;
            var entry = await context.JournalEntries
                .FirstOrDefaultAsync(e => e.TemplateId == template.Id && e.EntryDate == day);
            if (entry is null)
            {
                entry = new JournalEntry { TemplateId = template.Id, EntryDate = day, CreatedAt = now };
                context.JournalEntries.Add(entry);
            }

            var content = JsonNode.Parse(
                string.IsNullOrWhiteSpace(entry.ContentJson) ? "{}" : entry.ContentJson)!.AsObject();

            foreach (var prop in sections.EnumerateObject())
            {
                var kind = kinds[prop.Name];
                var incoming = JsonNode.Parse(prop.Value.GetRawText());
                switch (kind)
                {
                    case "prose":
                        // Append with a blank-line separator; set when empty.
                        if (prop.Value.ValueKind != JsonValueKind.String)
                            return new(false, $"Section '{prop.Name}' expects a string.", null);
                        var existing = content[prop.Name]?.GetValue<string>() ?? "";
                        content[prop.Name] = string.IsNullOrWhiteSpace(existing)
                            ? prop.Value.GetString()
                            : existing.TrimEnd() + "\n\n" + prop.Value.GetString();
                        break;
                    case "mind":
                    case "list":
                        // Append items; a mind item is { text, cleared?, verdict? }.
                        if (prop.Value.ValueKind != JsonValueKind.Array)
                            return new(false, $"Section '{prop.Name}' expects an array.", null);
                        var arr = content[prop.Name]?.AsArray() ?? new JsonArray();
                        content[prop.Name] = arr;
                        foreach (var item in incoming!.AsArray())
                            arr.Add(item?.DeepClone());
                        break;
                    case "evening":
                        // Shallow-merge only the provided fields; unsaid stays unsaid.
                        if (prop.Value.ValueKind != JsonValueKind.Object)
                            return new(false, $"Section '{prop.Name}' expects an object.", null);
                        var target = content[prop.Name]?.AsObject() ?? new JsonObject();
                        content[prop.Name] = target;
                        foreach (var field in incoming!.AsObject())
                            target[field.Key] = field.Value?.DeepClone();
                        break;
                    default:
                        // plan, projects - rebuilt wholes, not accreted.
                        content[prop.Name] = incoming;
                        break;
                }
            }

            var raw = content.ToJsonString();
            if (raw.Length > 256 * 1024)
                return new(false, "Entry content must be under 256KB.", null);

            entry.ContentJson = raw;
            entry.UpdatedAt = now;
            await context.SaveChangesAsync();
            entry.Template = template;
            return new(true, null, entry);
        }
    }
}
