namespace Tasklog.Api.Models
{
    // One screen-activity sample (v4.1, #92 "the tape"): shipped from a machine's
    // local tracker (the PC's Argonaut tracker today) so Sage can arbitrate time
    // boundaries from evidence instead of narration timing. Window titles are
    // intimate data - they live only in this LAN-bound DB and its backups.
    public class ActivitySample
    {
        public long Id { get; set; }

        // Sample moment, local clock of the source machine.
        public DateTime Ts { get; set; }

        // Which machine's screen ("pc", "laptop"...). With Ts it forms the
        // idempotency key - re-shipping a batch can never duplicate.
        public string Machine { get; set; } = "pc";

        // Active window title at that moment ("" when locked/none).
        public string Win { get; set; } = "";

        // Seconds since last input at sample time.
        public int IdleS { get; set; }

        // "active" | "idle" (as the tracker judged it).
        public string State { get; set; } = "active";
    }
}
