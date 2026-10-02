using System.Text;
using System.Text.Json;
using Tasklog.Api.Models;

namespace Tasklog.Api.Services
{
    // Renders one day's journal (all templates) to a single Obsidian-compatible markdown
    // note. Pure static helper (RecurrenceRule pattern): callers resolve entries, check-ins,
    // and task titles first, so this is unit-testable with plain data and exists exactly
    // once - the preview pane and the export download both consume its output. We only
    // WRITE markdown here; nothing ever parses it back (structured data stays the truth).
    public static class JournalMarkdown
    {
        // A mood check-in already resolved out of storage.
        public record CheckinData(DateTime At, string[] Words, int? Energy, int? MocLevel);

        // A plan-referenced task resolved to its display state.
        public record PlanTaskData(int Id, string Title, bool IsCompleted);

        // Bucket key -> heading, in render order. Content JSON uses the keys.
        // PAIRED CONTRACT: these keys are mirrored verbatim in frontend/src/lib/journal.ts
        // (PLAN_BUCKETS) - change both together.
        private static readonly (string Key, string Title)[] PlanBuckets =
        {
            ("non_negotiable", "Non-negotiable"),
            ("if_energy", "If energy allows"),
            ("easy_wins", "Easy wins"),
        };

        // Flatten a user string onto one line: control chars (incl. newlines) become
        // spaces. Every string interpolated into markdown STRUCTURE (frontmatter values,
        // list rows, checklist lines, bold field values) goes through this so no stored
        // value - including a task title created via the public MCP surface - can inject
        // extra lines, headings, or frontmatter keys into the note. Multi-line prose
        // sections don't use this: they render per-line inside blockquotes instead.
        private static string Inline(string? s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            var sb = new StringBuilder(s.Length);
            foreach (var c in s) sb.Append(char.IsControl(c) ? ' ' : c);
            return sb.ToString().Trim();
        }

        private static string Inline(IEnumerable<string> words) =>
            string.Join(", ", words.Select(w => Inline(w)).Where(w => w.Length > 0));

        public static string Render(
            DateTime date,
            IReadOnlyList<JournalTemplate> templates,
            IReadOnlyDictionary<string, JsonElement> contentByTemplateKey,
            IReadOnlyList<CheckinData> checkins,
            IReadOnlyDictionary<int, PlanTaskData> planTasks,
            IReadOnlyList<string> unplannedDone)
        {
            var sb = new StringBuilder();
            AppendFrontmatter(sb, date, checkins);
            sb.AppendLine($"# {date:dddd, d MMMM yyyy}");
            sb.AppendLine();
            sb.AppendLine($"[[{date.AddDays(-1):yyyy-MM-dd}|Yesterday]] | [[{date.AddDays(1):yyyy-MM-dd}|Tomorrow]]");

            foreach (var template in templates.OrderBy(t => t.SortOrder))
            {
                contentByTemplateKey.TryGetValue(template.Key, out var content);
                var sections = JsonSerializer.Deserialize<JsonElement>(template.SectionsJson);
                foreach (var section in sections.EnumerateArray())
                {
                    var key = section.GetProperty("key").GetString() ?? "";
                    var title = section.GetProperty("title").GetString() ?? key;
                    var kind = section.GetProperty("kind").GetString() ?? "prose";
                    var value = TryGetSection(content, key);

                    // Optional sections stay silent when empty ("earned depth only");
                    // everything else renders its heading so the note keeps its shape.
                    var optional = section.TryGetProperty("optional", out var opt) && opt.GetBoolean();
                    if (optional && IsEmpty(kind, value, checkins)) continue;

                    AppendSection(sb, title, kind, value, checkins, planTasks, unplannedDone);
                }
            }
            return sb.ToString();
        }

        private static void AppendFrontmatter(StringBuilder sb, DateTime date, IReadOnlyList<CheckinData> checkins)
        {
            var first = checkins.Count > 0 ? checkins[0] : null;
            var last = checkins.Count > 1 ? checkins[^1] : null;
            sb.AppendLine("---");
            sb.AppendLine("type: daily-note");
            sb.AppendLine($"date: {date:yyyy-MM-dd}");
            sb.AppendLine($"day-of-week: {date:dddd}");
            if (first != null)
            {
                sb.AppendLine($"mood: {Inline(first.Words)}{(last != null ? $" -> {Inline(last.Words)}" : "")}");
                sb.AppendLine($"energy: {(first.Energy is int fe ? fe.ToString() : "--")}{(last != null ? $" -> {(last.Energy is int le ? le.ToString() : "--")}" : "")}");
            }
            sb.AppendLine($"checkins: {checkins.Count}");
            sb.AppendLine("tags:");
            sb.AppendLine("  - periodic/daily");
            sb.AppendLine("---");
            sb.AppendLine();
        }

        private static void AppendSection(
            StringBuilder sb,
            string title,
            string kind,
            JsonElement? value,
            IReadOnlyList<CheckinData> checkins,
            IReadOnlyDictionary<int, PlanTaskData> planTasks,
            IReadOnlyList<string> unplannedDone)
        {
            sb.AppendLine();
            sb.AppendLine($"## {title}");
            sb.AppendLine();

            switch (kind)
            {
                case "checkins":
                    if (checkins.Count == 0) { sb.AppendLine("- (none)"); break; }
                    foreach (var c in checkins)
                        sb.AppendLine($"- {c.At:HH:mm} - {Inline(c.Words)}{(c.Energy is int ce ? $" - energy {ce}" : "")}{(c.MocLevel is int m ? $" - MoC {m}" : "")}");
                    break;

                case "prose":
                    AppendBlockquote(sb, value?.ValueKind == JsonValueKind.String ? value.Value.GetString() : null);
                    break;

                case "projects":
                    if (value?.ValueKind != JsonValueKind.Array || value.Value.GetArrayLength() == 0) { sb.AppendLine("- (none)"); break; }
                    foreach (var p in value.Value.EnumerateArray())
                    {
                        var name = Inline(GetString(p, "name"));
                        var focus = Inline(GetString(p, "focus"));
                        sb.AppendLine($"- **{name}**{(focus.Length > 0 ? $" - {focus}" : "")}");
                    }
                    break;

                case "plan":
                    AppendPlan(sb, value, planTasks, unplannedDone);
                    break;

                case "mind":
                    if (value?.ValueKind != JsonValueKind.Array || value.Value.GetArrayLength() == 0) { sb.AppendLine("- (cleared)"); break; }
                    foreach (var item in value.Value.EnumerateArray())
                    {
                        var text = Inline(GetString(item, "text"));
                        var cleared = item.TryGetProperty("cleared", out var cl) && cl.ValueKind == JsonValueKind.True;
                        sb.AppendLine(cleared ? $"- ~~{text}~~ (cleared)" : $"- {text}");
                    }
                    break;

                case "evening":
                    AppendEvening(sb, value, checkins);
                    break;

                case "list":
                    if (value?.ValueKind != JsonValueKind.Array || value.Value.GetArrayLength() == 0) { sb.AppendLine("- (none)"); break; }
                    foreach (var item in value.Value.EnumerateArray())
                        sb.AppendLine($"- {Inline(item.GetString())}");
                    break;
            }
        }

        private static void AppendPlan(
            StringBuilder sb,
            JsonElement? value,
            IReadOnlyDictionary<int, PlanTaskData> planTasks,
            IReadOnlyList<string> unplannedDone)
        {
            var buckets = value?.ValueKind == JsonValueKind.Object
                && value.Value.TryGetProperty("buckets", out var b) && b.ValueKind == JsonValueKind.Object
                ? b : (JsonElement?)null;

            foreach (var (key, bucketTitle) in PlanBuckets)
            {
                if (buckets is null || !buckets.Value.TryGetProperty(key, out var ids)
                    || ids.ValueKind != JsonValueKind.Array || ids.GetArrayLength() == 0)
                    continue;

                sb.AppendLine($"**{bucketTitle}**");
                foreach (var idEl in ids.EnumerateArray())
                {
                    if (!idEl.TryGetInt32(out var id)) continue;
                    if (planTasks.TryGetValue(id, out var t))
                        sb.AppendLine($"- [{(t.IsCompleted ? "x" : " ")}] {Inline(t.Title)}");
                    else
                        sb.AppendLine("- [ ] (deleted task)");
                }
                sb.AppendLine();
            }

            if (unplannedDone.Count > 0)
            {
                sb.AppendLine("**Unplanned, got done**");
                foreach (var title in unplannedDone)
                    sb.AppendLine($"- [x] {Inline(title)}");
            }
        }

        // Evening sub-fields in template order. Emotion shift + energy EOD are derived
        // from check-ins, never stored - the renderer computes them the same way the UI does.
        // PAIRED CONTRACT: these keys are mirrored verbatim in frontend/src/lib/journal.ts
        // (EVENING_FIELDS) - change both together.
        private static readonly (string Key, string Label)[] EveningFields =
        {
            ("whatDroveIt", "What drove it"),
            ("whatMovedForward", "What moved forward"),
            ("whatSlowedYouDown", "What slowed you down"),
            ("patternNoticed", "Pattern noticed"),
            ("oneSmallAdjustment", "One small adjustment"),
            ("closeTheTabs", "Close the tabs"),
            ("justNoticing", "Just noticing"),
        };

        private static void AppendEvening(StringBuilder sb, JsonElement? value, IReadOnlyList<CheckinData> checkins)
        {
            var first = checkins.Count > 0 ? checkins[0] : null;
            var last = checkins.Count > 1 ? checkins[^1] : null;
            // FirstOrDefault: the controller rejects empty word arrays, but Render is a
            // public pure function - a stored "[]" must degrade, not throw.
            var firstWord = Inline(first?.Words.FirstOrDefault());
            var lastWord = Inline(last?.Words.FirstOrDefault());
            var shift = first == null ? "--"
                : last == null ? $"{firstWord} -> (no evening check-in)"
                : $"{firstWord} -> {lastWord}";
            sb.AppendLine($"**Emotion shift:** {shift}");
            sb.AppendLine();

            foreach (var (key, label) in EveningFields)
            {
                var text = Inline(value?.ValueKind == JsonValueKind.Object ? GetString(value.Value, key) : "");
                sb.AppendLine($"**{label}:** {(text.Length > 0 ? text : "--")}");
                sb.AppendLine();
            }

            sb.AppendLine($"**Energy at end of day:** {(last?.Energy is int ee ? ee.ToString() : "--")}");
        }

        private static void AppendBlockquote(StringBuilder sb, string? text)
        {
            if (string.IsNullOrWhiteSpace(text)) { sb.AppendLine("> --"); return; }
            foreach (var line in text.Replace("\r\n", "\n").Split('\n'))
                sb.AppendLine($"> {line}");
        }

        private static bool IsEmpty(string kind, JsonElement? value, IReadOnlyList<CheckinData> checkins) => kind switch
        {
            "checkins" => checkins.Count == 0,
            "prose" => value?.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(value.Value.GetString()),
            "list" or "projects" or "mind" => value?.ValueKind != JsonValueKind.Array || value.Value.GetArrayLength() == 0,
            _ => value is null,
        };

        private static JsonElement? TryGetSection(JsonElement content, string key) =>
            content.ValueKind == JsonValueKind.Object && content.TryGetProperty(key, out var v) ? v : null;

        private static string GetString(JsonElement obj, string prop) =>
            obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String
                ? (v.GetString() ?? "").Trim()
                : "";
    }
}
