using System.Text.Json.Serialization;

namespace Tasklog.Api.Models
{
    // An AREA (v4.1 Stage B, pin 11) - the broad life domain the sidebar groups
    // by: Life, Work, Travel, Switch, Hobbies... Distinct from Client (the part
    // that is owed within a domain): Self and Responsibility both live under
    // Life, and the same client may appear under several areas. Areas are born
    // lazily from use (never a setup screen) and carry a free-text why - the
    // life-level direction now that goals went per-project.
    public class Area
    {
        public int Id { get; set; }

        public required string Name { get; set; }

        // The area's why, free text ("why are you waiting for me").
        public string? Why { get; set; }

        // Sidebar group order. Lower = higher.
        public int Position { get; set; }

        public DateTime CreatedAt { get; set; }

        public DateTime UpdatedAt { get; set; }

        [JsonIgnore]
        public ICollection<Project> Projects { get; set; } = new List<Project>();
    }
}
