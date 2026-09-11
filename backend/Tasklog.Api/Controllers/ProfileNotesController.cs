using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Tasklog.Api.Data;
using Tasklog.Api.Models;

namespace Tasklog.Api.Controllers
{
    // The worn knowledge layer (see ProfileNote). Tiny by design: list what loads
    // into Sage's context, add a distilled line, correct or retire one. The
    // transparency contract: nothing Sage believes about the user is hidden or
    // uncorrectable.
    [ApiController]
    [Route("api/profile-notes")]
    public class ProfileNotesController : ControllerBase
    {
        private const int MaxTextChars = 500;

        private readonly TasklogDbContext _context;

        public ProfileNotesController(TasklogDbContext context)
        {
            _context = context;
        }

        // GET /api/profile-notes?all=true - active lines by default (what Sage wears);
        // all=true includes retired lines for the Profile tab's history view.
        [HttpGet]
        public async Task<IActionResult> List([FromQuery] bool all = false)
        {
            var query = _context.ProfileNotes.AsQueryable();
            if (!all) query = query.Where(n => n.Active);
            var notes = await query.OrderBy(n => n.Kind).ThenBy(n => n.CreatedAt).ToListAsync();
            return Ok(notes);
        }

        // POST /api/profile-notes  { text, kind?, sourceDate? }
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] ProfileNoteRequest request)
        {
            var text = request.Text?.Trim();
            if (string.IsNullOrEmpty(text))
                return BadRequest(new { message = "text is required." });
            if (text.Length > MaxTextChars)
                return BadRequest(new { message = $"text must be {MaxTextChars} characters or fewer." });

            // Dedupe on exact text - Sage re-learning the same line must not stack it.
            var existing = await _context.ProfileNotes.FirstOrDefaultAsync(n => n.Text == text);
            if (existing is not null)
            {
                if (!existing.Active) { existing.Active = true; existing.UpdatedAt = DateTime.Now; await _context.SaveChangesAsync(); }
                return Ok(existing);
            }

            var note = new ProfileNote
            {
                Text = text,
                Kind = string.IsNullOrWhiteSpace(request.Kind) ? "fact" : request.Kind!,
                SourceDate = (request.SourceDate ?? DateTime.Today).Date,
                CreatedAt = DateTime.Now,
                UpdatedAt = DateTime.Now,
            };
            _context.ProfileNotes.Add(note);
            await _context.SaveChangesAsync();
            return CreatedAtAction(nameof(List), new { }, note);
        }

        // PATCH /api/profile-notes/{id}  { text?, kind?, active? } - correct a line or
        // retire it (the X). Retired lines keep their history; active=true revives.
        [HttpPatch("{id:int}")]
        public async Task<IActionResult> Update(int id, [FromBody] ProfileNoteRequest request)
        {
            var note = await _context.ProfileNotes.FindAsync(id);
            if (note is null)
                return NotFound(new { message = $"Profile note {id} not found." });

            if (request.Text is not null)
            {
                var text = request.Text.Trim();
                if (text.Length == 0) return BadRequest(new { message = "text cannot be blank." });
                if (text.Length > MaxTextChars) return BadRequest(new { message = $"text must be {MaxTextChars} characters or fewer." });
                note.Text = text;
            }
            if (!string.IsNullOrWhiteSpace(request.Kind)) note.Kind = request.Kind!;
            if (request.Active is bool active) note.Active = active;

            note.UpdatedAt = DateTime.Now;
            await _context.SaveChangesAsync();
            return Ok(note);
        }
    }

    public record ProfileNoteRequest(string? Text, string? Kind, DateTime? SourceDate, bool? Active);
}
