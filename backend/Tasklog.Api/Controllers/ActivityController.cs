using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Tasklog.Api.Data;
using Tasklog.Api.Models;

namespace Tasklog.Api.Controllers
{
    // The tape (v4.1, #92): screen-activity samples shipped by each machine's
    // watchman agent. Sage's check_screen tool reads this to arbitrate time
    // boundaries from evidence ("the PC went idle at 22:05") instead of
    // narration timing - the lesson of 12 Sep, learned twice in one day.
    [ApiController]
    [Route("api/activity")]
    public class ActivityController : ControllerBase
    {
        private const int MaxBatch = 5000;
        private const int MaxWindowChars = 300;

        private readonly TasklogDbContext _context;

        public ActivityController(TasklogDbContext context)
        {
            _context = context;
        }

        // POST /api/activity/batch  { machine, samples: [{ ts, win?, idleS?, state? }] }
        // Idempotent: (machine, ts) pairs that already exist are skipped, so the
        // shipper can resend freely after a failed run. Returns how many landed.
        [HttpPost("batch")]
        public async Task<IActionResult> Batch([FromBody] ActivityBatchRequest request)
        {
            var machine = request.Machine?.Trim().ToLowerInvariant();
            if (string.IsNullOrEmpty(machine) || machine.Length > 30)
                return BadRequest(new { message = "machine is required (short name like 'pc')." });
            if (request.Samples is null || request.Samples.Count == 0)
                return Ok(new { inserted = 0 });
            if (request.Samples.Count > MaxBatch)
                return BadRequest(new { message = $"at most {MaxBatch} samples per batch." });

            var incoming = request.Samples
                .Where(s => s.Ts != default)
                .Select(s => new ActivitySample
                {
                    Ts = s.Ts,
                    Machine = machine,
                    Win = (s.Win ?? "").Length > MaxWindowChars ? s.Win![..MaxWindowChars] : s.Win ?? "",
                    IdleS = s.IdleS ?? 0,
                    State = s.State == "idle" ? "idle" : "active",
                })
                .DistinctBy(s => s.Ts)
                .OrderBy(s => s.Ts)
                .ToList();
            if (incoming.Count == 0) return Ok(new { inserted = 0 });

            // Skip already-present timestamps inside the batch's range - one query.
            var from = incoming[0].Ts;
            var to = incoming[^1].Ts;
            var existing = (await _context.ActivitySamples
                    .Where(a => a.Machine == machine && a.Ts >= from && a.Ts <= to)
                    .Select(a => a.Ts)
                    .ToListAsync())
                .ToHashSet();
            var fresh = incoming.Where(s => !existing.Contains(s.Ts)).ToList();

            _context.ActivitySamples.AddRange(fresh);
            await _context.SaveChangesAsync();
            return Ok(new { inserted = fresh.Count, skipped = incoming.Count - fresh.Count });
        }

        // GET /api/activity/segments?from=&to=&machine= - the tape, coalesced
        // server-side into segments (state + dominant window), capped and cheap
        // enough to hand straight to Sage's check_screen tool.
        [HttpGet("segments")]
        public async Task<IActionResult> Segments([FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] string machine = "pc")
        {
            var start = from ?? DateTime.Today;
            var end = to ?? DateTime.Now;
            if ((end - start).TotalDays > 7)
                return BadRequest(new { message = "range must not exceed 7 days." });

            var samples = await _context.ActivitySamples
                .Where(a => a.Machine == machine && a.Ts >= start && a.Ts <= end)
                .OrderBy(a => a.Ts)
                .ToListAsync();
            if (samples.Count == 0)
                return Ok(new { segments = Array.Empty<object>(), note = "no samples in range (machine off, or the watchman is not running)" });

            // Coalesce consecutive same-state samples; track the dominant window
            // title per active segment so "what was on screen" survives.
            var segments = new List<(DateTime From, DateTime To, string State, Dictionary<string, int> Wins)>();
            foreach (var s in samples)
            {
                var state = s.State == "idle" || s.IdleS >= 240 ? "idle" : "active";
                if (segments.Count > 0 && segments[^1].State == state && (s.Ts - segments[^1].To).TotalMinutes <= 5)
                {
                    var last = segments[^1];
                    last.To = s.Ts;
                    if (state == "active" && s.Win.Length > 0)
                        last.Wins[s.Win] = last.Wins.GetValueOrDefault(s.Win) + 1;
                    segments[^1] = last;
                }
                else
                {
                    var wins = new Dictionary<string, int>();
                    if (state == "active" && s.Win.Length > 0) wins[s.Win] = 1;
                    segments.Add((s.Ts, s.Ts, state, wins));
                }
            }

            return Ok(new
            {
                segments = segments
                    .Where(seg => (seg.To - seg.From).TotalMinutes >= 2)
                    .Select(seg => new
                    {
                        from = seg.From.ToString("yyyy-MM-ddTHH:mm"),
                        to = seg.To.ToString("yyyy-MM-ddTHH:mm"),
                        minutes = (int)(seg.To - seg.From).TotalMinutes,
                        state = seg.State,
                        topWindow = seg.Wins.Count > 0 ? seg.Wins.MaxBy(w => w.Value).Key : null,
                    }),
            });
        }
    }

    public record ActivitySampleIn(DateTime Ts, string? Win, int? IdleS, string? State);

    public record ActivityBatchRequest(string? Machine, List<ActivitySampleIn>? Samples);
}
