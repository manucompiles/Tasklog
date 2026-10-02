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

    // ---- time writes: boundary edges + op-aware undo (review R1, R3-R5) ----

    private static async Task<TimeEntry> SeedRunning(TasklogDbContext context, DateTime startedAt, string? desc = null)
    {
        var entry = new TimeEntry { StartedAt = startedAt, Description = desc, CreatedAt = DateTime.Now };
        context.TimeEntries.Add(entry);
        await context.SaveChangesAsync();
        return entry;
    }

    private static CaptureRequest TimeRequest(string payloadJson) =>
        new("time", JsonDocument.Parse(payloadJson).RootElement.Clone(), null, null, null, null, AutoConfirm: true);

    [Fact]
    public async Task UndoStop_ReopensTheEntry_InsteadOfDeletingIt()
    {
        using var context = CreateContext();
        var controller = new CapturesController(context);
        var entry = await SeedRunning(context, DateTime.Now.AddHours(-2), "deep work");

        await controller.Create(TimeRequest("""{"op":"stop"}"""));
        entry.EndedAt.Should().NotBeNull();

        await controller.Dismiss(Single(context).Id);

        context.TimeEntries.Should().ContainSingle(); // "undo my stop" must never erase 2h of work
        entry.EndedAt.Should().BeNull();              // ...it reopens the timer
    }

    [Fact]
    public async Task UndoEdit_RestoresThePreImage_InsteadOfDeleting()
    {
        using var context = CreateContext();
        var controller = new CapturesController(context);
        var start = DateTime.Today.AddDays(-1).AddHours(9);
        var entry = new TimeEntry { StartedAt = start, EndedAt = start.AddHours(1), CreatedAt = DateTime.Now };
        context.TimeEntries.Add(entry);
        await context.SaveChangesAsync();

        await controller.Create(TimeRequest(
            $$"""{"op":"edit","entryId":{{entry.Id}},"endedAt":"{{start.AddMinutes(90):s}}"}"""));
        entry.EndedAt.Should().Be(start.AddMinutes(90));

        await controller.Dismiss(Single(context).Id);

        context.TimeEntries.Should().ContainSingle();
        entry.EndedAt.Should().Be(start.AddHours(1)); // the edited field reverts, nothing is deleted
    }

    [Fact]
    public async Task UndoStart_DeletesCreatedEntry_AndReopensTheSealedOne()
    {
        using var context = CreateContext();
        var controller = new CapturesController(context);
        var old = await SeedRunning(context, DateTime.Now.AddHours(-3), "dinner");

        await controller.Create(TimeRequest($$"""{"op":"start","startedAt":"{{DateTime.Now.AddHours(-1):s}}","description":"sleep"}"""));
        old.EndedAt.Should().NotBeNull(); // sealed at the new start

        await controller.Dismiss(Single(context).Id);

        context.TimeEntries.Should().ContainSingle(e => e.Description == "dinner");
        old.EndedAt.Should().BeNull(); // the displaced timer runs again
    }

    [Fact]
    public async Task Start_BackdatedToBeforeRunningStart_SupersedesIt_AndUndoRecreatesIt()
    {
        using var context = CreateContext();
        var controller = new CapturesController(context);
        // Timer mistakenly started 21:30; the narration says sleep began 21:00 (review
        // R4): sealing the old one at "now" would double-count 21:30-onward.
        var mistaken = await SeedRunning(context, DateTime.Now.AddMinutes(-90), "dinner");

        await controller.Create(TimeRequest(
            $$"""{"op":"start","startedAt":"{{DateTime.Now.AddHours(-2):s}}","description":"sleep"}"""));

        context.TimeEntries.Should().ContainSingle(); // the superseded timer is gone, no overlap
        context.TimeEntries.Single().Description.Should().Be("sleep");

        await controller.Dismiss(Single(context).Id);
        context.TimeEntries.Should().ContainSingle(e => e.Description == "dinner");
        context.TimeEntries.Single(e => e.Description == "dinner").EndedAt.Should().BeNull();
    }

    [Fact]
    public async Task Manual_PushesRunningTimerThatStartedInsideTheInterval()
    {
        using var context = CreateContext();
        var controller = new CapturesController(context);
        var day = DateTime.Today; // runaway timer started 01:30, still running
        var runaway = await SeedRunning(context, day.AddMinutes(90), "accidental");

        // "I slept 00:50-06:30" - the exact all-night shape the trim exists for,
        // with the runaway starting INSIDE the interval (review R3).
        var result = await controller.Create(TimeRequest(
            $$"""{"op":"manual","startedAt":"{{day.AddMinutes(50):s}}","endedAt":"{{day.AddMinutes(390):s}}","description":"sleep"}"""));

        result.Should().BeOfType<OkObjectResult>();
        runaway.StartedAt.Should().Be(day.AddMinutes(390)); // pushed past the sleep block
        runaway.EndedAt.Should().BeNull();                  // still running, but no overlap
    }

    [Fact]
    public async Task Stop_EndBeforeStart_Fails_AndLeavesNoStrandedCapture()
    {
        using var context = CreateContext();
        var controller = new CapturesController(context);
        var entry = await SeedRunning(context, DateTime.Now.AddMinutes(-10));

        var result = await controller.Create(TimeRequest(
            $$"""{"op":"stop","endedAt":"{{DateTime.Now.AddMinutes(-30):s}}"}"""));

        result.Should().BeOfType<BadRequestObjectResult>(); // negative duration refused (review R5)
        entry.EndedAt.Should().BeNull();
        context.Captures.Should().BeEmpty(); // autoConfirm is all-or-nothing (review R2)
    }

    [Fact]
    public async Task Stop_AlreadyStoppedEntry_Refuses()
    {
        using var context = CreateContext();
        var controller = new CapturesController(context);
        var start = DateTime.Now.AddHours(-2);
        var entry = new TimeEntry { StartedAt = start, EndedAt = start.AddHours(1), CreatedAt = DateTime.Now };
        context.TimeEntries.Add(entry);
        await context.SaveChangesAsync();

        var result = await controller.Create(TimeRequest($$"""{"op":"stop","entryId":{{entry.Id}}}"""));

        result.Should().BeOfType<BadRequestObjectResult>(); // re-stopping must not overwrite the end
        entry.EndedAt.Should().Be(start.AddHours(1));
    }

    [Fact]
    public async Task AutoConfirm_FailedMaterialize_StrandsNothing_AndRetryConfirmsCleanly()
    {
        using var context = CreateContext();
        var controller = new CapturesController(context);
        var sessionId = await SeedSession(context);

        // Stale projectId (review R2): the write fails - and must vanish entirely,
        // or the session dedupe later reports success for a task that never existed.
        var failed = await controller.Create(new CaptureRequest(
            "task", Payload("""{"title":"Buy gift","projectId":999}"""), sessionId, null, null, null, AutoConfirm: true));
        failed.Should().BeOfType<BadRequestObjectResult>();
        context.Captures.Should().BeEmpty();

        var retry = await controller.Create(new CaptureRequest(
            "task", Payload("""{"title":"Buy gift"}"""), sessionId, null, null, null, AutoConfirm: true));
        retry.Should().BeOfType<OkObjectResult>();
        Single(context).Status.Should().Be("confirmed");
        context.Tasks.Should().ContainSingle(t => t.Title == "Buy gift");
    }

    [Fact]
    public async Task AutoConfirm_DedupeHitOnProposedCard_ConfirmsItInsteadOfFalseSuccess()
    {
        using var context = CreateContext();
        var controller = new CapturesController(context);
        var sessionId = await SeedSession(context);

        // A v4.0-style pending card exists; Sage later logs the same title autonomously.
        await controller.Create(new CaptureRequest(
            "task", Payload("""{"title":"Call the plumber"}"""), sessionId, null, null, null));
        Single(context).Status.Should().Be("proposed");

        var logged = await controller.Create(new CaptureRequest(
            "task", Payload("""{"title":"call the plumber"}"""), sessionId, null, null, null, AutoConfirm: true));

        logged.Should().BeOfType<OkObjectResult>();
        context.Captures.Should().ContainSingle(); // still deduped
        Single(context).Status.Should().Be("confirmed");
        context.Tasks.Should().ContainSingle(t => t.Title == "Call the plumber");
    }
}
