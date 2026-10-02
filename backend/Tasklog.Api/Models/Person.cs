namespace Tasklog.Api.Models
{
    // A person (v4.1 Stage B, mockup pin 17): a deep entity - who they are to
    // the user, contact rhythm, dates, open threads, a next-time note. Born
    // from a mention (get-or-create by name), deepened over time; memories
    // about them are Notes with an about-link, money is derived from expense
    // splits. Every field hand- and AI-editable.
    public class Person
    {
        public int Id { get; set; }

        public required string Name { get; set; }

        // "friend" | "family" | "colleague" | free text.
        public string? Relation { get; set; }

        // Who they are to me - the one-line why they matter.
        public string? WhoTheyAre { get; set; }

        // Expected contact rhythm in days (Sage nudges when the gap stretches
        // past it). Null = no rhythm tracked.
        public int? RhythmDays { get; set; }

        public DateTime? LastContactAt { get; set; }

        // Asked casually, once, someday (pin 17). Date only; year optional by
        // convention (year 1 = unknown year).
        public DateTime? Birthday { get; set; }

        // Open threads as a JSON array of strings ("pickup by Saturday").
        public string ThreadsJson { get; set; } = "[]";

        // The next-time note ("ask how the new job is settling in").
        public string? NextTime { get; set; }

        public DateTime CreatedAt { get; set; }

        public DateTime UpdatedAt { get; set; }
    }
}
