using Microsoft.EntityFrameworkCore;
using Tasklog.Api.Models;

namespace Tasklog.Api.Data
{
    public class TasklogDbContext : DbContext
    {
        public TasklogDbContext(DbContextOptions<TasklogDbContext> options) : base(options) { }

        public DbSet<TaskModel> Tasks => Set<TaskModel>();
        public DbSet<Project> Projects => Set<Project>();
        public DbSet<Client> Clients => Set<Client>();
        public DbSet<Label> Labels => Set<Label>();
        public DbSet<TaskComment> Comments => Set<TaskComment>();
        public DbSet<CheckIn> CheckIns => Set<CheckIn>();
        public DbSet<TimeEntry> TimeEntries => Set<TimeEntry>();
        public DbSet<Subtask> Subtasks => Set<Subtask>();
        public DbSet<JournalTemplate> JournalTemplates => Set<JournalTemplate>();
        public DbSet<JournalEntry> JournalEntries => Set<JournalEntry>();
        public DbSet<MoodCheckin> MoodCheckins => Set<MoodCheckin>();
        public DbSet<CompanionSession> CompanionSessions => Set<CompanionSession>();
        public DbSet<Capture> Captures => Set<Capture>();
        public DbSet<Embedding> Embeddings => Set<Embedding>();
        public DbSet<Note> Notes => Set<Note>();
        public DbSet<Expense> Expenses => Set<Expense>();
        public DbSet<ProfileNote> ProfileNotes => Set<ProfileNote>();
        public DbSet<Area> Areas => Set<Area>();
        public DbSet<Goal> Goals => Set<Goal>();
        public DbSet<Person> Persons => Set<Person>();

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            // Configure the implicit many-to-many join table between tasks and labels.
            // EF Core creates a "LabelTaskModel" join table automatically from these nav properties.
            modelBuilder.Entity<TaskModel>()
                .HasMany(t => t.Labels)
                .WithMany(l => l.Tasks);

            // Priority defaults to 4 (P4 = none) at the DB level. This is what existing
            // rows migrate to - without it, EF would use the CLR default of 0, which is
            // outside the valid 1-4 range. New rows still set 4 via the model initializer.
            modelBuilder.Entity<TaskModel>()
                .Property(t => t.Priority)
                .HasDefaultValue(4);

            // A task's comments are deleted with the task (cascade via the FK).
            modelBuilder.Entity<TaskComment>()
                .HasOne(c => c.Task)
                .WithMany(t => t.Comments)
                .HasForeignKey(c => c.TaskId)
                .OnDelete(DeleteBehavior.Cascade);

            // A task's habit check-ins cascade-delete with the task. The unique index on
            // (TaskId, CheckInDate) enforces one check-in per habit per day, so "done today"
            // is idempotent at the database level.
            modelBuilder.Entity<CheckIn>()
                .HasOne(c => c.Task)
                .WithMany(t => t.CheckIns)
                .HasForeignKey(c => c.TaskId)
                .OnDelete(DeleteBehavior.Cascade);
            modelBuilder.Entity<CheckIn>()
                .HasIndex(c => new { c.TaskId, c.CheckInDate })
                .IsUnique();

            // Projects are grouped under an optional Client (#86). Deleting a client
            // SET-NULLs its projects' ClientId (Ungrouped) rather than cascading, so no
            // projects/tasks are lost with the client. Index ClientId for the grouped sidebar.
            modelBuilder.Entity<Project>()
                .HasOne(p => p.Client)
                .WithMany(c => c.Projects)
                .HasForeignKey(p => p.ClientId)
                .OnDelete(DeleteBehavior.SetNull);
            modelBuilder.Entity<Project>().HasIndex(p => p.ClientId);

            // Time-tracking intervals (#77) are decoupled from tasks in #86: an entry can be
            // task-free and carries its own project. Deleting the linked task or project
            // SET-NULLs the link (the entry survives as logged history) rather than cascading.
            // Index on EndedAt makes "find the running timer" (EndedAt == null) cheap; indexes
            // on TaskId and ProjectId speed the per-task/per-project totals + the timeline scan.
            modelBuilder.Entity<TimeEntry>()
                .HasOne(e => e.Task)
                .WithMany(t => t.TimeEntries)
                .HasForeignKey(e => e.TaskId)
                .OnDelete(DeleteBehavior.SetNull);
            modelBuilder.Entity<TimeEntry>()
                .HasOne(e => e.Project)
                .WithMany()
                .HasForeignKey(e => e.ProjectId)
                .OnDelete(DeleteBehavior.SetNull);
            modelBuilder.Entity<TimeEntry>().HasIndex(e => e.EndedAt);
            modelBuilder.Entity<TimeEntry>().HasIndex(e => e.TaskId);
            modelBuilder.Entity<TimeEntry>().HasIndex(e => e.ProjectId);

            // A task's subtasks cascade-delete with the task (#78). Index on TaskId speeds
            // the per-task load (GetById) and the list's subtask-count/projection queries.
            modelBuilder.Entity<Subtask>()
                .HasOne(s => s.Task)
                .WithMany(t => t.Subtasks)
                .HasForeignKey(s => s.TaskId)
                .OnDelete(DeleteBehavior.Cascade);
            modelBuilder.Entity<Subtask>().HasIndex(s => s.TaskId);

            // Journal (#79). Templates are code-defined and upserted by Key at startup,
            // so Key must be unique. One entry per template per date is a DB guarantee -
            // the API upserts against this index instead of ever creating a duplicate note.
            // Entries cascade-delete with their template.
            modelBuilder.Entity<JournalTemplate>()
                .HasIndex(t => t.Key)
                .IsUnique();
            modelBuilder.Entity<JournalEntry>()
                .HasOne(e => e.Template)
                .WithMany()
                .HasForeignKey(e => e.TemplateId)
                .OnDelete(DeleteBehavior.Cascade);
            modelBuilder.Entity<JournalEntry>()
                .HasIndex(e => new { e.TemplateId, e.EntryDate })
                .IsUnique();

            // Mood check-ins are queried by day; index the timestamp for the date-range scan.
            modelBuilder.Entity<MoodCheckin>().HasIndex(m => m.CheckinAt);

            // Companion (#87). One conversation per calendar day is a DB guarantee (the
            // JournalEntry precedent) - the API get-or-creates today's session against
            // this index instead of ever opening a duplicate thread.
            modelBuilder.Entity<CompanionSession>()
                .HasIndex(s => s.SessionDate)
                .IsUnique();

            // Captures (#87) reference the session they were proposed in. Deleting a
            // session SET-NULLs its captures rather than cascading: a confirmed capture
            // is an audit record that outlives its source (the #86 keep-history rule).
            // Status is indexed for the "pending cards" filter; SessionId for the
            // per-session card list.
            modelBuilder.Entity<Capture>()
                .HasOne(c => c.Session)
                .WithMany(s => s.Captures)
                .HasForeignKey(c => c.SessionId)
                .OnDelete(DeleteBehavior.SetNull);
            modelBuilder.Entity<Capture>().HasIndex(c => c.SessionId);
            modelBuilder.Entity<Capture>().HasIndex(c => c.Status);

            // Notes (v4.1): the markdown entity of the type system. Kind is filtered on
            // every typed view (memories, wishes...); OriginDate joins a note to its
            // journal day.
            modelBuilder.Entity<Note>().HasIndex(n => n.Kind);
            modelBuilder.Entity<Note>().HasIndex(n => n.OriginDate);

            // Expenses (v4.1): day-matched into the journal (OccurredOn scan) and rolled
            // up per project. Deleting a project keeps its money history (the #86
            // keep-history rule) - the FK just goes null.
            modelBuilder.Entity<Expense>()
                .HasOne(x => x.Project)
                .WithMany()
                .HasForeignKey(x => x.ProjectId)
                .OnDelete(DeleteBehavior.SetNull);
            modelBuilder.Entity<Expense>().HasIndex(x => x.OccurredOn);
            modelBuilder.Entity<Expense>().HasIndex(x => x.ProjectId);

            // Areas (v4.1 Stage B, pin 11): the sidebar's grouping domain. Deleting an
            // area ungroups its projects (SET NULL) - never deletes them.
            modelBuilder.Entity<Project>()
                .HasOne(p => p.Area)
                .WithMany(a => a.Projects)
                .HasForeignKey(p => p.AreaId)
                .OnDelete(DeleteBehavior.SetNull);
            modelBuilder.Entity<Project>().HasIndex(p => p.AreaId);
            modelBuilder.Entity<Project>().Property(p => p.Status).HasDefaultValue("active");

            // Goals cascade with their project (a goal has no life without its home).
            modelBuilder.Entity<Goal>()
                .HasOne(g => g.Project)
                .WithMany()
                .HasForeignKey(g => g.ProjectId)
                .OnDelete(DeleteBehavior.Cascade);
            modelBuilder.Entity<Goal>().HasIndex(g => g.ProjectId);

            // Profile notes: the active set loads into every Sage conversation.
            modelBuilder.Entity<ProfileNote>().HasIndex(n => n.Active);

            // Embeddings (#87): one vector per entity per model. The unique composite key
            // makes embed-on-write an upsert, and a model swap writes new rows instead of
            // corrupting old ones (vectors across models are not comparable).
            modelBuilder.Entity<Embedding>()
                .HasIndex(e => new { e.EntityType, e.EntityId, e.Model })
                .IsUnique();
        }
    }
}
