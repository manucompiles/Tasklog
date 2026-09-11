using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Tasklog.Api.Data;
using Tasklog.Api.Models;

namespace Tasklog.Api.Controllers
{
    // Notes (v4.1, plan D3) - the markdown entity behind memories, ideas,
    // reflections, quotes, wishes. Sage writes them through the capture pipeline;
    // this controller is the hand-edit surface and the read model for destiny
    // links, the future Profile tab, and per-day journal mentions.
    [ApiController]
    [Route("api/notes")]
    public class NotesController : ControllerBase
    {
        private const int MaxTitleChars = 500;
        private const int MaxBodyChars = 16384;

        private readonly TasklogDbContext _context;
        private readonly Services.EmbeddingService? _embeddings;

        public NotesController(TasklogDbContext context, Services.EmbeddingService? embeddings = null)
        {
            _context = context;
            _embeddings = embeddings;
        }

        // GET /api/notes?kind=&date= - typed views (kind=memory -> the memories list)
        // and per-day mentions (date -> that day's origin notes).
        [HttpGet]
        public async Task<IActionResult> List([FromQuery] string? kind, [FromQuery] DateTime? date)
        {
            var query = _context.Notes.AsQueryable();
            if (!string.IsNullOrWhiteSpace(kind)) query = query.Where(n => n.Kind == kind);
            if (date is DateTime day) query = query.Where(n => n.OriginDate == day.Date);
            var notes = await query.OrderByDescending(n => n.CreatedAt).ToListAsync();
            return Ok(notes);
        }

        [HttpGet("{id:int}")]
        public async Task<IActionResult> GetById(int id)
        {
            var note = await _context.Notes.FindAsync(id);
            return note is null
                ? NotFound(new { message = $"Note {id} not found." })
                : Ok(note);
        }

        // POST /api/notes - the manual door.
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] NoteRequest request)
        {
            var title = request.Title?.Trim();
            if (string.IsNullOrEmpty(title)) return BadRequest(new { message = "title is required." });
            if (title.Length > MaxTitleChars) return BadRequest(new { message = $"title must be {MaxTitleChars} characters or fewer." });
            if (request.BodyMd is { Length: > MaxBodyChars }) return BadRequest(new { message = "body too large." });

            var note = new Note
            {
                Title = title,
                BodyMd = request.BodyMd ?? "",
                Kind = string.IsNullOrWhiteSpace(request.Kind) ? "note" : request.Kind!,
                AboutJson = string.IsNullOrWhiteSpace(request.AboutJson) ? "[]" : request.AboutJson!,
                Source = string.IsNullOrWhiteSpace(request.Source) ? null : request.Source,
                OriginDate = (request.OriginDate ?? DateTime.Today).Date,
                CreatedAt = DateTime.Now,
                UpdatedAt = DateTime.Now,
            };
            _context.Notes.Add(note);
            await _context.SaveChangesAsync();

            if (_embeddings is not null)
                await _embeddings.UpsertAsync("note", note.Id, $"{note.Title}\n{note.BodyMd}");

            return CreatedAtAction(nameof(GetById), new { id = note.Id }, note);
        }

        // PATCH /api/notes/{id} - present-key edit (omit = keep). Re-embeds on
        // title/body change so recall follows the edit.
        [HttpPatch("{id:int}")]
        public async Task<IActionResult> Update(int id, [FromBody] NoteRequest request)
        {
            var note = await _context.Notes.FindAsync(id);
            if (note is null)
                return NotFound(new { message = $"Note {id} not found." });

            var textChanged = false;
            if (request.Title is not null)
            {
                var title = request.Title.Trim();
                if (title.Length == 0) return BadRequest(new { message = "title cannot be blank." });
                if (title.Length > MaxTitleChars) return BadRequest(new { message = $"title must be {MaxTitleChars} characters or fewer." });
                note.Title = title;
                textChanged = true;
            }
            if (request.BodyMd is not null)
            {
                if (request.BodyMd.Length > MaxBodyChars) return BadRequest(new { message = "body too large." });
                note.BodyMd = request.BodyMd;
                textChanged = true;
            }
            if (!string.IsNullOrWhiteSpace(request.Kind)) note.Kind = request.Kind!;
            if (request.AboutJson is not null) note.AboutJson = request.AboutJson;
            if (request.Source is not null) note.Source = request.Source.Length == 0 ? null : request.Source;
            if (request.OriginDate is DateTime day) note.OriginDate = day.Date;

            note.UpdatedAt = DateTime.Now;
            await _context.SaveChangesAsync();

            if (textChanged && _embeddings is not null)
                await _embeddings.UpsertAsync("note", note.Id, $"{note.Title}\n{note.BodyMd}");

            return Ok(note);
        }

        // DELETE /api/notes/{id} - hard delete (the receipt row on the originating
        // capture keeps the audit trail).
        [HttpDelete("{id:int}")]
        public async Task<IActionResult> Delete(int id)
        {
            var note = await _context.Notes.FindAsync(id);
            if (note is null)
                return NotFound(new { message = $"Note {id} not found." });
            _context.Notes.Remove(note);
            await _context.SaveChangesAsync();
            return NoContent();
        }
    }

    public record NoteRequest(
        string? Title,
        string? BodyMd,
        string? Kind,
        string? AboutJson,
        string? Source,
        DateTime? OriginDate);
}
