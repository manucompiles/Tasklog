namespace Tasklog.Api.Models
{
    // A per-project goal (v4.1 Stage B, the locked goal entity in
    // design-principles-v4.md): born from one spoken line, every field optional
    // and deepened over time - the anti-empty-folder rule. Goals keep THIS
    // project pointed somewhere; life-level direction belongs to Areas.
    public class Goal
    {
        public int Id { get; set; }

        public int ProjectId { get; set; }

        public Project? Project { get; set; }

        public required string Title { get; set; }

        // One line, never demanded.
        public string? Why { get; set; }

        // Timespan tier: 10Y / 5Y / 3Y / 1Y / 6M / 3M / 1M. String, registry rule.
        public string? Timespan { get; set; }

        public DateTime? TargetDate { get; set; }

        // 0-100. Derives from evidence eventually; always accepts a manual nudge
        // (the bar must not argue when the evidence lags reality).
        public int Progress { get; set; }

        // Dated expectation history (chapters applied to goals): JSON array of
        // { at, text }, newest last. The current expectation is the last entry.
        public string ExpectationsJson { get; set; } = "[]";

        // The next smallest door: one attached 5-minute action, always current.
        public string? Door { get; set; }

        // "active" | "done" | "parked". String, registry rule.
        public string Status { get; set; } = "active";

        public DateTime CreatedAt { get; set; }

        public DateTime UpdatedAt { get; set; }
    }
}
