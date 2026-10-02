namespace Tasklog.Api.Models
{
    // A timestamped mood check-in - several per day (morning, mid-day, evening...), so this
    // mirrors TimeEntry (moment-based) rather than habit CheckIn (one per day). Mood belongs
    // to the day itself, not to a task: this is the project's first table with no Task FK.
    public class MoodCheckin
    {
        public int Id { get; set; }

        // When the check-in happened (local ISO datetime, no timezone suffix - the same
        // local-clock convention as TimeEntry.StartedAt).
        public DateTime CheckinAt { get; set; }

        // The user's mood words as a JSON string array (own words lead; feelings-wheel
        // picks are stored the same way). Plain TEXT + System.Text.Json.
        public string WordsJson { get; set; } = "[]";

        // Energy 0-10 at that moment. Nullable since v4.1: spoken check-ins carry
        // words, rarely numbers ("now i feel gulty" has no energy figure) - forcing
        // one blocked natural capture (dogfood finding, 11 Sep).
        public int? Energy { get; set; }

        // Map of Consciousness level, derived by the client from the selected feelings
        // (never self-tagged). Null when the user logged only free words with no wheel picks.
        public int? MocLevel { get; set; }

        public DateTime CreatedAt { get; set; }
    }
}
