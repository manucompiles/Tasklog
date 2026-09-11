namespace Tasklog.Api.Models
{
    // A note is markdown at its core - the Obsidian-equivalent entity of the type
    // system (design-principles-v4.md). Journal lines and mention rows carry only a
    // note's link phrase; this row is the thing itself. Kind decides the note's
    // surfaces and lifecycle:
    //   memory     - notable, worth saving; resurfaces when relevant
    //   idea       - graduates (idea -> backlog -> project)
    //   reflection - tied to its day, usually carries a Source
    //   quote      - verbatim text + source + own commentary
    //   wish       - the someday shelf
    //   note       - everything else
    // Kind is a string, not an enum - the registry grows without migrations (the
    // Capture.Type precedent).
    public class Note
    {
        public int Id { get; set; }

        // Short title / link phrase. This is what other surfaces render.
        public string Title { get; set; } = "";

        // Markdown body - the cleaned, voice-intact version. The verbatim original
        // stays on the originating capture row (two-pass rule).
        public string BodyMd { get; set; } = "";

        public string Kind { get; set; } = "note";

        // Where the note points: JSON array of {type, id?|name} about-links, e.g.
        // [{"type":"project","id":2},{"type":"person","name":"Deepika"}].
        // Names are allowed before their entity exists (Stage B materializes them).
        public string AboutJson { get; set; } = "[]";

        // External source for reflections/quotes (book, URL, a person) - free text.
        public string? Source { get; set; }

        // The day this note belongs to narratively (journal linkage), local date.
        public DateTime? OriginDate { get; set; }

        public DateTime CreatedAt { get; set; }

        public DateTime UpdatedAt { get; set; }
    }
}
