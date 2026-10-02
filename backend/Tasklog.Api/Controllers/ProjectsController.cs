using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Tasklog.Api.Data;
using Tasklog.Api.Models;

namespace Tasklog.Api.Controllers
{
    [ApiController]
    [Route("api/projects")]
    public class ProjectsController : ControllerBase
    {
        private readonly TasklogDbContext _context;

        public ProjectsController(TasklogDbContext context)
        {
            _context = context;
        }

        // GET /api/projects
        // Returns all projects in manual sidebar order (Position asc), name breaking ties.
        // Includes the client (grouping level, #86) so the sidebar can cluster + label them.
        [HttpGet]
        public async Task<IActionResult> GetAll()
        {
            var projects = await _context.Projects
                .Include(p => p.Client)
                .Include(p => p.Area)
                .OrderBy(p => p.Position)
                .ThenBy(p => p.Name)
                .ToListAsync();

            return Ok(projects);
        }

        // POST /api/projects
        // Creates a new project. Expects { name, color?, clientId? }. Position is assigned
        // as (current max + 1) so a new project lands at the bottom of the sidebar.
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] ProjectNameRequest request)
        {
            if (string.IsNullOrWhiteSpace(request.Name))
                return BadRequest(new { message = "Project name is required." });
            if (!IsValidColor(request.Color))
                return BadRequest(new { message = "Color must be a #RRGGBB hex string." });
            if (request.ClientId is int cid && !await _context.Clients.AnyAsync(c => c.Id == cid))
                return BadRequest(new { message = $"Client {cid} not found." });

            // Area (v4.1, pin 12): pick an existing one by id, or create-on-type by
            // name (the composer's search-or-create combobox) - born from use.
            int? areaId = request.AreaId;
            if (areaId is int aid && !await _context.Areas.AnyAsync(a => a.Id == aid))
                return BadRequest(new { message = $"Area {aid} not found." });
            if (areaId is null && !string.IsNullOrWhiteSpace(request.NewAreaName))
            {
                var areaName = request.NewAreaName.Trim();
                var area = (await _context.Areas.ToListAsync())
                    .FirstOrDefault(a => string.Equals(a.Name, areaName, StringComparison.OrdinalIgnoreCase));
                if (area is null)
                {
                    var maxAreaPos = await _context.Areas.AnyAsync() ? await _context.Areas.MaxAsync(a => a.Position) : 0;
                    area = new Area { Name = areaName, Position = maxAreaPos + 1, CreatedAt = DateTime.Now, UpdatedAt = DateTime.Now };
                    _context.Areas.Add(area);
                    await _context.SaveChangesAsync();
                }
                areaId = area.Id;
            }

            var maxPosition = await _context.Projects
                .Select(p => (int?)p.Position)
                .MaxAsync() ?? -1;

            var project = new Project
            {
                Name = request.Name.Trim(),
                Color = request.Color,
                ClientId = request.ClientId,
                AreaId = areaId,
                Position = maxPosition + 1,
                CreatedAt = DateTime.UtcNow
            };

            _context.Projects.Add(project);
            await _context.SaveChangesAsync();

            return CreatedAtAction(nameof(GetAll), new { id = project.Id }, project);
        }

        // PATCH /api/projects/{id}
        // Present-key update of name / color / clientId (JsonElement, like TasksController):
        // omit = keep, `color: null` / `clientId: null` = clear (recolor default / Ungrouped),
        // a value sets it. Returns the updated project with its client loaded.
        [HttpPatch("{id:int}")]
        public async Task<IActionResult> Update(int id, [FromBody] JsonElement body)
        {
            if (body.ValueKind != JsonValueKind.Object)
                return BadRequest(new { message = "Request body must be a JSON object." });

            var project = await _context.Projects.FindAsync(id);
            if (project is null)
                return NotFound(new { message = $"Project {id} not found." });

            if (body.TryGetProperty("name", out var nameEl))
            {
                if (nameEl.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(nameEl.GetString()))
                    return BadRequest(new { message = "Project name is required." });
                project.Name = nameEl.GetString()!.Trim();
            }

            if (body.TryGetProperty("color", out var colorEl))
            {
                if (colorEl.ValueKind == JsonValueKind.Null)
                    project.Color = null;
                else if (colorEl.ValueKind == JsonValueKind.String && IsValidColor(colorEl.GetString()))
                    project.Color = colorEl.GetString();
                else
                    return BadRequest(new { message = "Color must be a #RRGGBB hex string or null." });
            }

            if (body.TryGetProperty("clientId", out var clientEl))
            {
                if (clientEl.ValueKind == JsonValueKind.Null)
                {
                    project.ClientId = null;
                }
                else if (clientEl.ValueKind == JsonValueKind.Number && clientEl.TryGetInt32(out var cid))
                {
                    if (!await _context.Clients.AnyAsync(c => c.Id == cid))
                        return BadRequest(new { message = $"Client {cid} not found." });
                    project.ClientId = cid;
                }
                else
                {
                    return BadRequest(new { message = "clientId must be an integer or null." });
                }
            }

            if (body.TryGetProperty("areaId", out var areaEl))
            {
                if (areaEl.ValueKind == JsonValueKind.Null)
                    project.AreaId = null;
                else if (areaEl.ValueKind == JsonValueKind.Number && areaEl.TryGetInt32(out var aid2))
                {
                    if (!await _context.Areas.AnyAsync(a => a.Id == aid2))
                        return BadRequest(new { message = $"Area {aid2} not found." });
                    project.AreaId = aid2;
                }
                else return BadRequest(new { message = "areaId must be an integer or null." });
            }

            if (body.TryGetProperty("status", out var statusEl))
            {
                var status = statusEl.GetString();
                if (status is not ("active" or "onhold"))
                    return BadRequest(new { message = "status must be 'active' or 'onhold'." });
                project.Status = status;
            }

            if (body.TryGetProperty("about", out var aboutEl))
                project.About = aboutEl.ValueKind == JsonValueKind.String
                    ? aboutEl.GetString() : null;

            // NOW is append-only (pin 13): setting a new Now archives the old one as
            // a dated chapter instead of overwriting it.
            if (body.TryGetProperty("now", out var nowEl))
            {
                var newNow = nowEl.ValueKind == JsonValueKind.String ? nowEl.GetString() : null;
                if (!string.IsNullOrWhiteSpace(project.NowText) && project.NowText != newNow)
                {
                    var history = System.Text.Json.Nodes.JsonNode.Parse(project.NowHistoryJson)!.AsArray();
                    history.Add(new System.Text.Json.Nodes.JsonObject
                    {
                        ["at"] = DateTime.Now.ToString("yyyy-MM-dd"),
                        ["text"] = project.NowText,
                    });
                    project.NowHistoryJson = history.ToJsonString();
                }
                project.NowText = newNow;
            }

            await _context.SaveChangesAsync();
            await _context.Entry(project).Reference(p => p.Client).LoadAsync();
            await _context.Entry(project).Reference(p => p.Area).LoadAsync();
            return Ok(project);
        }

        // POST /api/projects/reorder
        // Rewrites Position from an ordered array of project ids. The ids must be exactly the
        // current set of project ids (a permutation) - the sidebar sends the full flattened
        // order after a drag. Mirrors the subtasks reorder endpoint. Returns the reordered list.
        [HttpPost("reorder")]
        public async Task<IActionResult> Reorder([FromBody] ReorderRequest request)
        {
            var projects = await _context.Projects.ToListAsync();
            var orderedIds = request.OrderedIds ?? Array.Empty<int>();
            var currentIds = projects.Select(p => p.Id).ToHashSet();

            if (orderedIds.Length != projects.Count || !orderedIds.ToHashSet().SetEquals(currentIds))
                return BadRequest(new { message = "orderedIds must contain exactly the existing project ids." });

            var byId = projects.ToDictionary(p => p.Id);
            for (var i = 0; i < orderedIds.Length; i++)
                byId[orderedIds[i]].Position = i;
            await _context.SaveChangesAsync();

            var reordered = await _context.Projects
                .Include(p => p.Client)
                .OrderBy(p => p.Position)
                .ThenBy(p => p.Name)
                .ToListAsync();
            return Ok(reordered);
        }

        // DELETE /api/projects/{id}
        // Deletes a project and all tasks that belong to it (cascade delete). Time entries
        // that referenced the project are NOT deleted - their ProjectId is SET NULL (#86),
        // so logged time survives as ungrouped history.
        // Returns 204 No Content on success, 404 if not found.
        [HttpDelete("{id:int}")]
        public async Task<IActionResult> Delete(int id)
        {
            var project = await _context.Projects.FindAsync(id);

            if (project is null)
                return NotFound(new { message = $"Project {id} not found." });

            // Cascade: delete all tasks in this project first.
            var tasks = await _context.Tasks
                .Where(t => t.ProjectId == id)
                .ToListAsync();

            // Keep any time tracked against those tasks legible after their TaskId is SET NULL
            // (#86): snapshot each task's title into its description-less entries first.
            await TasksController.SnapshotTaskTitlesIntoEntries(_context, tasks);

            _context.Tasks.RemoveRange(tasks);
            _context.Projects.Remove(project);
            await _context.SaveChangesAsync();

            return NoContent();
        }

        // A color is valid when null (no color) or a "#RRGGBB" hex string.
        private static bool IsValidColor(string? color) =>
            color is null || Regex.IsMatch(color, "^#[0-9a-fA-F]{6}$");
    }

    // Request body for project create. Color and clientId are optional.
    public record ProjectNameRequest(string Name, string? Color = null, int? ClientId = null, int? AreaId = null, string? NewAreaName = null);

    // Request body for project reorder: the full set of project ids, in the desired order.
    public record ReorderRequest(int[]? OrderedIds);
}
