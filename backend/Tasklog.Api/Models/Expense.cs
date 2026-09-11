namespace Tasklog.Api.Models
{
    // An expense is not a task and not a comment (mockup pin 10): a real row with
    // arithmetic, day-matched into the journal's daily-expenses section and rolled up
    // per project. Born from speech through the capture pipeline; every field is
    // hand- and AI-editable afterwards.
    public class Expense
    {
        public int Id { get; set; }

        // Positive amount in the user's currency (INR today). Direction below signs it.
        public double Amount { get; set; }

        // "out" (spent) or "in" (received). String over enum - same registry rule.
        public string Direction { get; set; } = "out";

        // The day the money moved (local date) - purchases backfill to their real day,
        // not the day they were mentioned (dogfood: tickets Sep 4, said Sep 10).
        public DateTime OccurredOn { get; set; }

        // What it was, in the user's words ("MMT stay, Vagamon").
        public string Note { get; set; } = "";

        // Split state as JSON, or "{}" when unshared:
        // { "with": "Manish", "share": 1290, "settled": false }.
        // A one-clause dictation ("splits both ways, covered later") is a whole
        // feature - kept opaque here, aggregated in views.
        public string SplitJson { get; set; } = "{}";

        // Optional home: the project (often a trip) this spend belongs to.
        public int? ProjectId { get; set; }

        public Project? Project { get; set; }

        public DateTime CreatedAt { get; set; }

        public DateTime UpdatedAt { get; set; }
    }
}
