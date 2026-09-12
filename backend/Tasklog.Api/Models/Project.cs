namespace Tasklog.Api.Models
{
    public class Project
    {
        public int Id { get; set; }
        public required string Name { get; set; }
        public DateTime CreatedAt { get; set; }

        // Optional display color, a "#RRGGBB" hex string (#77). Null = no color (a neutral
        // default is used). Drives the time-tracking timeline block colors and a sidebar dot.
        public string? Color { get; set; }

        // The client (life area) this project is grouped under (#86). Null = Ungrouped.
        // SET-NULL on client delete, so a project outlives its client. The nav is serialized
        // (Client.Projects is [JsonIgnore], so there is no cycle) to give the sidebar the
        // client name/color alongside the project.
        public int? ClientId { get; set; }
        public Client? Client { get; set; }

        // Manual sort order within the sidebar (#86). Lower = higher in the list. Assigned
        // on create (max+1) and rewritten by the reorder endpoint - mirrors Subtask.Position.
        public int Position { get; set; }

        // v4.1 Stage B (#92, pin 2): a project is active or on hold - on hold keeps
        // a full (quieter) home with a Revive action, never deleted. String over
        // enum (the registry rule).
        public string Status { get; set; } = "active";

        // The AREA this project lives in (pin 11: Area != Client - area is the
        // broad domain, client is the part that is owed within it; the same client
        // can appear under different areas, e.g. Hobbies + Life both under Self).
        // Null = the ungrouped "Projects" bucket. SET NULL on area delete.
        public int? AreaId { get; set; }
        public Area? Area { get; set; }

        // The project home's two prose fields (pin 6): About is ONE line - it
        // exists for the homely feeling of opening a place; Now is ONE focus.
        public string? About { get; set; }
        public string? NowText { get; set; }

        // NOW is append-only (pin 13): when NowText changes, the old one archives
        // here as a dated chapter - JSON array of { at, text }, newest last.
        public string NowHistoryJson { get; set; } = "[]";

        // Navigation property - tasks that belong to this project.
        public ICollection<TaskModel> Tasks { get; set; } = new List<TaskModel>();
    }
}
