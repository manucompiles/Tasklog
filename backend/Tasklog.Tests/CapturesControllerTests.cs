using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Tasklog.Api.Controllers;
using Tasklog.Api.Data;
using Tasklog.Api.Models;

namespace Tasklog.Tests;

// The Capture inbox trust loop (#87): propose -> confirm (materializes a real
// Task) / dismiss (stays recorded). Controllers are constructed without an
// EmbeddingService (optional ctor arg) - embedding is enrichment, not behavior.
public class CapturesControllerTests
{
    private static TasklogDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<TasklogDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new TasklogDbContext(options);
    }

    private static JsonElement Payload(string json) =>
        JsonDocument.Parse(json).RootElement.Clone();

    private static async Task<int> SeedSession(TasklogDbContext context)
    {
        var session = new CompanionSession { SessionDate = DateTime.Today, CreatedAt = DateTime.Now, UpdatedAt = DateTime.Now };
        context.CompanionSessions.Add(session);
        await context.SaveChangesAsync();
        return session.Id;
    }

    private static Capture Single(TasklogDbContext context) => context.Captures.Single();

    // ---- propose ----

    [Fact]
    public async Task Create_TaskProposal_Returns201AndStoresProposed()
    {
        using var context = CreateContext();
        var controller = new CapturesController(context);
        var sessionId = await SeedSession(context);

        var result = await controller.Create(new CaptureRequest(
            "task", Payload("""{"title":"Call the plumber"}"""), sessionId,
            "the plumber never got called", 0.9, null));

        result.Should().BeOfType<CreatedAtActionResult>();
        var row = Single(context);
        row.Status.Should().Be("proposed");
        row.Source.Should().Be("companion"); // defaulted
        row.Span.Should().Be("the plumber never got called");
    }

    [Fact]
    public async Task Create_UnknownType_Returns400()
    {
        using var context = CreateContext();
        var controller = new CapturesController(context);

        var result = await controller.Create(new CaptureRequest(
            "teleport", Payload("""{"words":["ok"]}"""), null, null, null, null));

        result.Should().BeOfType<BadRequestObjectResult>(); // not in the type registry
    }

    [Fact]
    public async Task Create_TaskWithoutTitle_Returns400()
    {
        using var context = CreateContext();
        var controller = new CapturesController(context);

        var result = await controller.Create(new CaptureRequest(
            "task", Payload("""{"title":"   "}"""), null, null, null, null));

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task Create_DuplicateTitleInSession_ReturnsExistingRow()
    {
        using var context = CreateContext();
        var controller = new CapturesController(context);
        var sessionId = await SeedSession(context);

        await controller.Create(new CaptureRequest(
            "task", Payload("""{"title":"Call the plumber"}"""), sessionId, null, null, null));
        // Same normalized title (case + whitespace differ) -> the existing capture, no new row.
        var repeat = await controller.Create(new CaptureRequest(
            "task", Payload("""{"title":"  call the PLUMBER "}"""), sessionId, null, null, null));

        repeat.Should().BeOfType<OkObjectResult>();
        context.Captures.Count().Should().Be(1);
    }

    // ---- confirm ----

    [Fact]
    public async Task Confirm_CreatesRealTask_WithProjectAndDeadline()
    {
        using var context = CreateContext();
        var controller = new CapturesController(context);
        context.Projects.Add(new Project { Name = "Home", CreatedAt = DateTime.Now });
        await context.SaveChangesAsync();
        var projectId = context.Projects.Single().Id;

        await controller.Create(new CaptureRequest(
            "task",
            Payload($$"""{"title":"Call the plumber","projectId":{{projectId}},"deadline":"2026-09-07"}"""),
            null, null, null, null));
        var capture = Single(context);

        var result = await controller.Confirm(capture.Id);

        result.Should().BeOfType<OkObjectResult>();
        var task = context.Tasks.Single();
        task.Title.Should().Be("Call the plumber");
        task.ProjectId.Should().Be(projectId);
        task.Deadline.Should().Be(new DateTime(2026, 9, 7));
        capture.Status.Should().Be("confirmed");
        capture.ConfirmedType.Should().Be("task");
        capture.ConfirmedId.Should().Be(task.Id);
    }

    [Fact]
    public async Task Confirm_Twice_IsIdempotent_NoDuplicateTask()
    {
        using var context = CreateContext();
        var controller = new CapturesController(context);
        await controller.Create(new CaptureRequest(
            "task", Payload("""{"title":"File ITR"}"""), null, null, null, null));
        var capture = Single(context);

        await controller.Confirm(capture.Id);
        var second = await controller.Confirm(capture.Id);

        second.Should().BeOfType<OkObjectResult>();
        context.Tasks.Count().Should().Be(1);
        capture.ConfirmedId.Should().Be(context.Tasks.Single().Id);
    }

    [Fact]
    public async Task Confirm_DismissedCapture_Returns400()
    {
        using var context = CreateContext();
        var controller = new CapturesController(context);
        await controller.Create(new CaptureRequest(
            "task", Payload("""{"title":"Try the flight sim"}"""), null, null, null, null));
        var capture = Single(context);
        await controller.Dismiss(capture.Id);

        var result = await controller.Confirm(capture.Id);

        result.Should().BeOfType<BadRequestObjectResult>();
        context.Tasks.Should().BeEmpty();
    }

    [Fact]
    public async Task Confirm_UnknownProjectInPayload_Returns400AndStaysProposed()
    {
        using var context = CreateContext();
        var controller = new CapturesController(context);
        await controller.Create(new CaptureRequest(
            "task", Payload("""{"title":"Ghost project task","projectId":999}"""), null, null, null, null));
        var capture = Single(context);

        var result = await controller.Confirm(capture.Id);

        result.Should().BeOfType<BadRequestObjectResult>();
        capture.Status.Should().Be("proposed"); // still editable, not corrupted
        context.Tasks.Should().BeEmpty();
    }

    [Fact]
    public async Task Confirm_NewProjectName_CreatesProjectAndTaskTogether()
    {
        using var context = CreateContext();
        var controller = new CapturesController(context);
        await controller.Create(new CaptureRequest(
            "task", Payload("""{"title":"Show ProcureFlow progress","newProjectName":"ProcureFlow"}"""),
            null, null, null, null));
        var capture = Single(context);

        var result = await controller.Confirm(capture.Id);

        result.Should().BeOfType<OkObjectResult>();
        var project = context.Projects.Single();
        project.Name.Should().Be("ProcureFlow");
        var task = context.Tasks.Single();
        task.ProjectId.Should().Be(project.Id);
        capture.Status.Should().Be("confirmed");
    }

    [Fact]
    public async Task Confirm_NewProjectName_ReusesExistingProjectCaseInsensitive()
    {
        using var context = CreateContext();
        var controller = new CapturesController(context);
        context.Projects.Add(new Project { Name = "procureflow", Position = 1, CreatedAt = DateTime.Now });
        await context.SaveChangesAsync();
        await controller.Create(new CaptureRequest(
            "task", Payload("""{"title":"Show progress","newProjectName":"ProcureFlow"}"""),
            null, null, null, null));
        var capture = Single(context);

        await controller.Confirm(capture.Id);

        context.Projects.Count().Should().Be(1); // reused, never duplicated
        context.Tasks.Single().ProjectId.Should().Be(context.Projects.Single().Id);
    }

    // ---- dismiss + edit ----

    [Fact]
    public async Task Dismiss_ThenReproposeSameTitle_ReturnsDismissedRow()
    {
        using var context = CreateContext();
        var controller = new CapturesController(context);
        var sessionId = await SeedSession(context);
        await controller.Create(new CaptureRequest(
            "task", Payload("""{"title":"Try the flight sim"}"""), sessionId, null, null, null));
        var capture = Single(context);
        await controller.Dismiss(capture.Id);

        // The model re-proposing across turns must NOT resurrect a tossed card.
        var repeat = await controller.Create(new CaptureRequest(
            "task", Payload("""{"title":"Try the flight sim"}"""), sessionId, null, null, null));

        repeat.Should().BeOfType<OkObjectResult>();
        context.Captures.Count().Should().Be(1);
        capture.Status.Should().Be("dismissed");
    }

    [Fact]
    public async Task Restore_RevivesADismissedCapture_ButNeverAConfirmedOne()
    {
        using var context = CreateContext();
        var controller = new CapturesController(context);
        await controller.Create(new CaptureRequest(
            "task", Payload("""{"title":"Accidental toss victim"}"""), null, null, null, null));
        var capture = Single(context);
        await controller.Dismiss(capture.Id);

        var restored = await controller.Restore(capture.Id);

        restored.Should().BeOfType<OkObjectResult>();
        capture.Status.Should().Be("proposed"); // back on the table, confirmable again

        await controller.Confirm(capture.Id);
        var afterConfirm = await controller.Restore(capture.Id);
        afterConfirm.Should().BeOfType<BadRequestObjectResult>(); // confirmed is final
    }

    [Fact]
    public async Task Update_EditsPayloadWhileProposed_ButNotAfterResolve()
    {
        using var context = CreateContext();
        var controller = new CapturesController(context);
        await controller.Create(new CaptureRequest(
            "task", Payload("""{"title":"Call plumber"}"""), null, null, null, null));
        var capture = Single(context);

        var edit = await controller.Update(capture.Id,
            Payload("""{"payload":{"title":"Call the plumber about the leak"}}"""));
        edit.Should().BeOfType<OkObjectResult>();
        capture.PayloadJson.Should().Contain("about the leak");

        await controller.Confirm(capture.Id);
        var editAfter = await controller.Update(capture.Id,
            Payload("""{"payload":{"title":"too late"}}"""));
        editAfter.Should().BeOfType<BadRequestObjectResult>(); // audit rows are immutable
    }
}
