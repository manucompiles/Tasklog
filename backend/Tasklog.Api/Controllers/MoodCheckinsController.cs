using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Tasklog.Api.Data;
using Tasklog.Api.Models;

namespace Tasklog.Api.Controllers
{
    // Timestamped mood check-ins (#79) - several per day, powering the journal's mood arc
    // and the derived emotion-shift / energy-EOD fields. Words are the user's own labels;
    // the MoC level arrives pre-derived from the feelings-wheel picks (never self-tagged,
    // and null when only free words were logged).
    [ApiController]
    [Route("api/mood-checkins")]
    public class MoodCheckinsController : ControllerBase
    {
        private readonly TasklogDbContext _context;

        public MoodCheckinsController(TasklogDbContext context)
        {
            _context = context;
        }

        // GET /api/mood-checkins?date=yyyy-MM-dd - that day's check-ins, oldest first
        // (the arc reads left to right). Defaults to today.
        [HttpGet]
        public async Task<IActionResult> List([FromQuery] DateTime? date)
        {
            var dayStart = (date ?? DateTime.Today).Date;
            var dayEnd = dayStart.AddDays(1);
            var checkins = await _context.MoodCheckins
                .Where(m => m.CheckinAt >= dayStart && m.CheckinAt < dayEnd)
                .OrderBy(m => m.CheckinAt)
                .ToListAsync();
            return Ok(checkins.Select(Project).ToList());
        }

        // POST /api/mood-checkins  { words: string[], energy?: 0-10, mocLevel?, checkinAt? }
        // Energy optional since v4.1 - spoken check-ins carry words, rarely numbers.
        // checkinAt defaults to now (backfilling a missed morning is allowed).
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] MoodCheckinRequest request)
        {
            // Words flow verbatim into markdown structure (frontmatter lines, list rows),
            // so control characters/newlines are collapsed to spaces - a word must never
            // be able to inject extra lines into the note. Caps keep the blobs honest.
            var words = (request.Words ?? Array.Empty<string>())
                .Select(w => System.Text.RegularExpressions.Regex.Replace(w, "[\\u0000-\\u001F]+", " ").Trim())
                .Where(w => w.Length > 0)
                .ToArray();
            if (words.Length == 0)
                return BadRequest(new { message = "At least one mood word is required." });
            if (words.Length > 20)
                return BadRequest(new { message = "At most 20 mood words per check-in." });
            if (words.Any(w => w.Length > 60))
                return BadRequest(new { message = "A mood word must be 60 characters or fewer." });
            if (request.Energy is < 0 or > 10)
                return BadRequest(new { message = "energy must be between 0 and 10." });
            if (request.MocLevel is < 20 or > 1000)
                return BadRequest(new { message = "mocLevel must be between 20 and 1000." });

            var checkin = new MoodCheckin
            {
                CheckinAt = request.CheckinAt ?? DateTime.Now,
                WordsJson = JsonSerializer.Serialize(words),
                Energy = request.Energy,
                MocLevel = request.MocLevel,
                CreatedAt = DateTime.Now,
            };
            _context.MoodCheckins.Add(checkin);
            await _context.SaveChangesAsync();

            return CreatedAtAction(nameof(List), Project(checkin));
        }

        // DELETE /api/mood-checkins/{id} - remove a mistaken check-in.
        [HttpDelete("{id:int}")]
        public async Task<IActionResult> Delete(int id)
        {
            var checkin = await _context.MoodCheckins.FindAsync(id);
            if (checkin is null)
                return NotFound(new { message = $"Mood check-in {id} not found." });

            _context.MoodCheckins.Remove(checkin);
            await _context.SaveChangesAsync();
            return NoContent();
        }

        private static object Project(MoodCheckin m) => new
        {
            m.Id,
            m.CheckinAt,
            Words = JsonSerializer.Deserialize<string[]>(m.WordsJson) ?? Array.Empty<string>(),
            m.Energy,
            m.MocLevel,
        };
    }

    public record MoodCheckinRequest(string[]? Words, int? Energy, int? MocLevel, DateTime? CheckinAt);
}
