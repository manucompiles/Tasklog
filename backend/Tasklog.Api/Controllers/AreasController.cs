using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Tasklog.Api.Data;
using Tasklog.Api.Models;

namespace Tasklog.Api.Controllers
{
    // Areas (v4.1 Stage B, pin 11) - the broad life domains the Projects sidebar
    // groups by. Born lazily (usually create-on-type from the composer or by
    // Sage), each carrying a free-text why. Deleting an area ungroups its
    // projects, never deletes them.
    [ApiController]
    [Route("api/areas")]
    public class AreasController : ControllerBase
    {
        private readonly TasklogDbContext _context;

        public AreasController(TasklogDbContext context)
        {
            _context = context;
        }

        [HttpGet]
        public async Task<IActionResult> List()
        {
            var areas = await _context.Areas.OrderBy(a => a.Position).ToListAsync();
            return Ok(areas);
        }

        // POST /api/areas  { name, why? } - get-or-create by name (case-insensitive):
        // areas are born from use, re-saying one must never duplicate it.
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] AreaRequest request)
        {
            var name = request.Name?.Trim();
            if (string.IsNullOrEmpty(name))
                return BadRequest(new { message = "Area name is required." });

            var existing = (await _context.Areas.ToListAsync())
                .FirstOrDefault(a => string.Equals(a.Name, name, StringComparison.OrdinalIgnoreCase));
            if (existing is not null)
            {
                if (!string.IsNullOrWhiteSpace(request.Why)) { existing.Why = request.Why; existing.UpdatedAt = DateTime.Now; await _context.SaveChangesAsync(); }
                return Ok(existing);
            }

            var maxPosition = await _context.Areas.AnyAsync() ? await _context.Areas.MaxAsync(a => a.Position) : 0;
            var area = new Area
            {
                Name = name,
                Why = string.IsNullOrWhiteSpace(request.Why) ? null : request.Why,
                Position = maxPosition + 1,
                CreatedAt = DateTime.Now,
                UpdatedAt = DateTime.Now,
            };
            _context.Areas.Add(area);
            await _context.SaveChangesAsync();
            return CreatedAtAction(nameof(List), new { }, area);
        }

        // PATCH /api/areas/{id}  { name?, why? } - present-key edit.
        [HttpPatch("{id:int}")]
        public async Task<IActionResult> Update(int id, [FromBody] AreaRequest request)
        {
            var area = await _context.Areas.FindAsync(id);
            if (area is null)
                return NotFound(new { message = $"Area {id} not found." });

            if (request.Name is not null)
            {
                var name = request.Name.Trim();
                if (name.Length == 0) return BadRequest(new { message = "Area name cannot be blank." });
                area.Name = name;
            }
            if (request.Why is not null) area.Why = request.Why.Length == 0 ? null : request.Why;

            area.UpdatedAt = DateTime.Now;
            await _context.SaveChangesAsync();
            return Ok(area);
        }

        // DELETE /api/areas/{id} - projects go ungrouped (SET NULL), never lost.
        [HttpDelete("{id:int}")]
        public async Task<IActionResult> Delete(int id)
        {
            var area = await _context.Areas.FindAsync(id);
            if (area is null)
                return NotFound(new { message = $"Area {id} not found." });
            _context.Areas.Remove(area);
            await _context.SaveChangesAsync();
            return NoContent();
        }
    }

    public record AreaRequest(string? Name, string? Why);
}
