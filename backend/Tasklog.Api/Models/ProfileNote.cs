namespace Tasklog.Api.Models
{
    // Sage's own note sheet (plan Step 4) - the WORN knowledge layer of the profile.
    // Distilled lines about the user ("wakes 06:35-06:45", "deadpan = done, don't
    // celebrate", lexicon entries), written by Sage at session close via its
    // write_profile_note tool and loaded into every conversation's context. Distinct
    // from memories (Notes with kind=memory), which are looked up when relevant;
    // profile notes are always on. Every line is user-correctable (pin 15): the
    // Profile tab's "What Sage knows" list with an X per row - deactivation keeps
    // the record, active=false just stops the loading.
    public class ProfileNote
    {
        public int Id { get; set; }

        // One distilled line, plain text.
        public string Text { get; set; } = "";

        // Loose taxonomy for grouping: "routine" | "preference" | "lexicon" | "fact".
        // String, not enum - the registry rule.
        public string Kind { get; set; } = "fact";

        // The day the pattern was learned (local date).
        public DateTime SourceDate { get; set; }

        public bool Active { get; set; } = true;

        public DateTime CreatedAt { get; set; }

        public DateTime UpdatedAt { get; set; }
    }
}
