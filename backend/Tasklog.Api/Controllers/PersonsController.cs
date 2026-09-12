using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Tasklog.Api.Data;
using Tasklog.Api.Models;

namespace Tasklog.Api.Controllers
{
    // People (v4.1 Stage B, pin 17). Born from mentions - POST is get-or-create
    // by name, so re-mentioning someone never duplicates them. Deleting keeps
    // nothing hidden: memories about a person are Notes and survive on their own.
    [ApiController]
    [Route("api/persons")]
    public class PersonsController : ControllerBase
    {
        private readonly TasklogDbContext _context;

        public PersonsController(TasklogDbContext context)
        {
            _context = context;
        }

        [HttpGet]
        public async Task<IActionResult> List()
        {
            var persons = await _context.Persons.OrderBy(p => p.Name).ToListAsync();
            return Ok(persons);
        }

        // POST /api/persons  { name, relation?, whoTheyAre?, ... } - get-or-create
        // by name (case-insensitive); provided fields fill blanks, never overwrite.
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] PersonRequest request)
        {
            var name = request.Name?.Trim();
            if (string.IsNullOrEmpty(name))
                return BadRequest(new { message = "name is required." });

            var existing = (await _context.Persons.ToListAsync())
                .FirstOrDefault(p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase));
            if (existing is not null)
            {
                var touched = false;
                if (existing.Relation is null && request.Relation is not null) { existing.Relation = request.Relation; touched = true; }
                if (existing.WhoTheyAre is null && request.WhoTheyAre is not null) { existing.WhoTheyAre = request.WhoTheyAre; touched = true; }
                if (touched) { existing.UpdatedAt = DateTime.Now; await _context.SaveChangesAsync(); }
                return Ok(existing);
            }

            var person = new Person
            {
                Name = name,
                Relation = request.Relation,
                WhoTheyAre = request.WhoTheyAre,
                RhythmDays = request.RhythmDays,
                LastContactAt = request.LastContactAt,
                Birthday = request.Birthday,
                NextTime = request.NextTime,
                CreatedAt = DateTime.Now,
                UpdatedAt = DateTime.Now,
            };
            _context.Persons.Add(person);
            await _context.SaveChangesAsync();
            return CreatedAtAction(nameof(List), new { }, person);
        }

        // PATCH /api/persons/{id} - present-key edit; threads replace wholesale
        // (a small list, rebuilt not accreted).
        [HttpPatch("{id:int}")]
        public async Task<IActionResult> Update(int id, [FromBody] PersonRequest request)
        {
            var person = await _context.Persons.FindAsync(id);
            if (person is null)
                return NotFound(new { message = $"Person {id} not found." });

            if (request.Name is not null)
            {
                var name = request.Name.Trim();
                if (name.Length == 0) return BadRequest(new { message = "name cannot be blank." });
                person.Name = name;
            }
            if (request.Relation is not null) person.Relation = Clean(request.Relation);
            if (request.WhoTheyAre is not null) person.WhoTheyAre = Clean(request.WhoTheyAre);
            if (request.RhythmDays is not null) person.RhythmDays = request.RhythmDays == 0 ? null : request.RhythmDays;
            if (request.LastContactAt is not null) person.LastContactAt = request.LastContactAt;
            if (request.Birthday is not null) person.Birthday = request.Birthday;
            if (request.NextTime is not null) person.NextTime = Clean(request.NextTime);
            if (request.Threads is not null)
                person.ThreadsJson = System.Text.Json.JsonSerializer.Serialize(
                    request.Threads.Where(t => !string.IsNullOrWhiteSpace(t)).Select(t => t.Trim()));

            person.UpdatedAt = DateTime.Now;
            await _context.SaveChangesAsync();
            return Ok(person);
        }

        [HttpDelete("{id:int}")]
        public async Task<IActionResult> Delete(int id)
        {
            var person = await _context.Persons.FindAsync(id);
            if (person is null)
                return NotFound(new { message = $"Person {id} not found." });
            _context.Persons.Remove(person);
            await _context.SaveChangesAsync();
            return NoContent();
        }

        private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    }

    public record PersonRequest(
        string? Name,
        string? Relation,
        string? WhoTheyAre,
        int? RhythmDays,
        DateTime? LastContactAt,
        DateTime? Birthday,
        string? NextTime,
        string[]? Threads);
}
