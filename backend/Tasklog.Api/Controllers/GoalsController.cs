using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Tasklog.Api.Data;
using Tasklog.Api.Models;

namespace Tasklog.Api.Controllers
{
    // Per-project goals (v4.1 Stage B, the locked goal entity). Born from one
    // line; every field optional and deepened later - the Second Brain lesson
    // (a perfect template, zero rows) inverted. Progress accepts a manual nudge;
    // expectations archive as dated history when revised.
    [ApiController]
    [Route("api/goals")]
    public class GoalsController : ControllerBase
    {
        private static readonly HashSet<string> Timespans =
            new() { "10Y", "5Y", "3Y", "1Y", "6M", "3M", "1M" };

        private readonly TasklogDbContext _context;

        public GoalsController(TasklogDbContext context)
        {
            _context = context;
        }

        // GET /api/goals?projectId= - a project home's goal list (all when omitted).
        [HttpGet]
        public async Task<IActionResult> List([FromQuery] int? projectId)
        {
            var query = _context.Goals.AsQueryable();
            if (projectId is not null) query = query.Where(g => g.ProjectId == projectId);
            var goals = await query.OrderBy(g => g.Status).ThenByDescending(g => g.UpdatedAt).ToListAsync();
            return Ok(goals);
        }

        // POST /api/goals  { projectId, title, why?, timespan?, targetDate?, expectation?, door? }
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] GoalRequest request)
        {
            var title = request.Title?.Trim();
            if (string.IsNullOrEmpty(title))
                return BadRequest(new { message = "A goal is born from one line - title is required." });
            if (request.ProjectId is not int pid || !await _context.Projects.AnyAsync(p => p.Id == pid))
                return BadRequest(new { message = "A valid projectId is required (goals are per-project)." });
            if (request.Timespan is not null && !Timespans.Contains(request.Timespan))
                return BadRequest(new { message = $"timespan must be one of: {string.Join(", ", Timespans)}." });

            var goal = new Goal
            {
                ProjectId = pid,
                Title = title,
                Why = Clean(request.Why),
                Timespan = request.Timespan,
                TargetDate = request.TargetDate,
                Door = Clean(request.Door),
                CreatedAt = DateTime.Now,
                UpdatedAt = DateTime.Now,
            };
            if (!string.IsNullOrWhiteSpace(request.Expectation))
                goal.ExpectationsJson = new JsonArray(new JsonObject
                {
                    ["at"] = DateTime.Now.ToString("yyyy-MM-dd"),
                    ["text"] = request.Expectation.Trim(),
                }).ToJsonString();

            _context.Goals.Add(goal);
            await _context.SaveChangesAsync();
            return CreatedAtAction(nameof(List), new { }, goal);
        }

        // PATCH /api/goals/{id} - present-key edit. progress = the manual nudge
        // (0-100); expectation = a REVISION (the old one stays as a dated chapter).
        [HttpPatch("{id:int}")]
        public async Task<IActionResult> Update(int id, [FromBody] GoalRequest request)
        {
            var goal = await _context.Goals.FindAsync(id);
            if (goal is null)
                return NotFound(new { message = $"Goal {id} not found." });

            if (request.Title is not null)
            {
                var title = request.Title.Trim();
                if (title.Length == 0) return BadRequest(new { message = "title cannot be blank." });
                goal.Title = title;
            }
            if (request.Why is not null) goal.Why = Clean(request.Why);
            if (request.Timespan is not null)
            {
                if (!Timespans.Contains(request.Timespan))
                    return BadRequest(new { message = $"timespan must be one of: {string.Join(", ", Timespans)}." });
                goal.Timespan = request.Timespan;
            }
            if (request.TargetDate is not null) goal.TargetDate = request.TargetDate;
            if (request.Door is not null) goal.Door = Clean(request.Door);
            if (request.Progress is int progress)
            {
                if (progress is < 0 or > 100) return BadRequest(new { message = "progress must be 0-100." });
                goal.Progress = progress;
            }
            if (request.Status is not null)
            {
                if (request.Status is not ("active" or "done" or "parked"))
                    return BadRequest(new { message = "status must be active, done, or parked." });
                goal.Status = request.Status;
                if (request.Status == "done") goal.Progress = 100;
            }
            if (!string.IsNullOrWhiteSpace(request.Expectation))
            {
                var history = JsonNode.Parse(goal.ExpectationsJson)!.AsArray();
                history.Add(new JsonObject
                {
                    ["at"] = DateTime.Now.ToString("yyyy-MM-dd"),
                    ["text"] = request.Expectation.Trim(),
                });
                goal.ExpectationsJson = history.ToJsonString();
            }

            goal.UpdatedAt = DateTime.Now;
            await _context.SaveChangesAsync();
            return Ok(goal);
        }

        // DELETE /api/goals/{id} - prefer status=parked; delete is for mistakes.
        [HttpDelete("{id:int}")]
        public async Task<IActionResult> Delete(int id)
        {
            var goal = await _context.Goals.FindAsync(id);
            if (goal is null)
                return NotFound(new { message = $"Goal {id} not found." });
            _context.Goals.Remove(goal);
            await _context.SaveChangesAsync();
            return NoContent();
        }

        private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    }

    public record GoalRequest(
        int? ProjectId,
        string? Title,
        string? Why,
        string? Timespan,
        DateTime? TargetDate,
        string? Expectation,
        string? Door,
        int? Progress,
        string? Status);
}
