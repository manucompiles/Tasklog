using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Tasklog.Api.Data;
using Tasklog.Api.Models;

namespace Tasklog.Api.Controllers
{
    // Expenses (v4.1, plan D4). Sage writes them through the capture pipeline; this
    // controller is the hand-edit surface (pin 17: every field editable) and the
    // read model for the journal's daily-expenses section and per-project rollups.
    [ApiController]
    [Route("api/expenses")]
    public class ExpensesController : ControllerBase
    {
        private readonly TasklogDbContext _context;

        public ExpensesController(TasklogDbContext context)
        {
            _context = context;
        }

        // GET /api/expenses?from=&to=&projectId= - date-ranged (journal day: from=to=that
        // date) or per-project. Defaults to the current month.
        [HttpGet]
        public async Task<IActionResult> List([FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] int? projectId)
        {
            var query = _context.Expenses.AsQueryable();
            if (projectId is not null)
            {
                query = query.Where(x => x.ProjectId == projectId);
            }
            else
            {
                var start = (from ?? new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1)).Date;
                var end = (to ?? start.AddMonths(1)).Date.AddDays(from == to && from != null ? 1 : 0);
                if (end <= start) end = start.AddDays(1);
                if ((end - start).TotalDays > 400)
                    return BadRequest(new { message = "Date range must not exceed 400 days." });
                query = query.Where(x => x.OccurredOn >= start && x.OccurredOn < end);
            }
            var rows = await query.OrderByDescending(x => x.OccurredOn).ThenByDescending(x => x.Id).ToListAsync();
            return Ok(rows);
        }

        // POST /api/expenses - the manual door (the capture pipeline is Sage's door).
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] ExpenseRequest request)
        {
            var error = await Validate(request, requireAmount: true);
            if (error is not null) return BadRequest(new { message = error });

            var expense = new Expense
            {
                Amount = request.Amount!.Value,
                Direction = request.Direction == "in" ? "in" : "out",
                OccurredOn = (request.OccurredOn ?? DateTime.Today).Date,
                Note = request.Note!.Trim(),
                SplitJson = string.IsNullOrWhiteSpace(request.SplitJson) ? "{}" : request.SplitJson!,
                ProjectId = request.ProjectId,
                CreatedAt = DateTime.Now,
                UpdatedAt = DateTime.Now,
            };
            _context.Expenses.Add(expense);
            await _context.SaveChangesAsync();
            return CreatedAtAction(nameof(List), new { }, expense);
        }

        // PATCH /api/expenses/{id} - present-key edit (omit = keep).
        [HttpPatch("{id:int}")]
        public async Task<IActionResult> Update(int id, [FromBody] ExpenseRequest request)
        {
            var expense = await _context.Expenses.FindAsync(id);
            if (expense is null)
                return NotFound(new { message = $"Expense {id} not found." });

            var error = await Validate(request, requireAmount: false);
            if (error is not null) return BadRequest(new { message = error });

            if (request.Amount is double amount) expense.Amount = amount;
            if (request.Direction is "in" or "out") expense.Direction = request.Direction;
            if (request.OccurredOn is DateTime day) expense.OccurredOn = day.Date;
            if (request.Note is not null)
            {
                if (string.IsNullOrWhiteSpace(request.Note)) return BadRequest(new { message = "note cannot be blank." });
                expense.Note = request.Note.Trim();
            }
            if (request.SplitJson is not null) expense.SplitJson = request.SplitJson;
            if (request.ProjectId is not null) expense.ProjectId = request.ProjectId == 0 ? null : request.ProjectId;

            expense.UpdatedAt = DateTime.Now;
            await _context.SaveChangesAsync();
            return Ok(expense);
        }

        // DELETE /api/expenses/{id} - hard delete; money rows have no soft state.
        [HttpDelete("{id:int}")]
        public async Task<IActionResult> Delete(int id)
        {
            var expense = await _context.Expenses.FindAsync(id);
            if (expense is null)
                return NotFound(new { message = $"Expense {id} not found." });
            _context.Expenses.Remove(expense);
            await _context.SaveChangesAsync();
            return NoContent();
        }

        private async Task<string?> Validate(ExpenseRequest request, bool requireAmount)
        {
            if (requireAmount && (request.Amount is null or <= 0)) return "a positive amount is required.";
            if (!requireAmount && request.Amount is <= 0) return "amount must be positive.";
            if (requireAmount && string.IsNullOrWhiteSpace(request.Note)) return "note is required (what it was).";
            if (request.ProjectId is int pid and not 0 && !await _context.Projects.AnyAsync(p => p.Id == pid))
                return $"Project {pid} not found.";
            return null;
        }
    }

    public record ExpenseRequest(
        double? Amount,
        string? Direction,
        DateTime? OccurredOn,
        string? Note,
        string? SplitJson,
        int? ProjectId);
}
