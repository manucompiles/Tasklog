// Route: /projects - the Projects tab (v4.1 Stage B, #92).
// A Server Component shell; ProjectsClient owns all state (selection, areas,
// goals, the composer). The design record is docs/ideas/mockups/
// projects-tab-mockup.html (pins 1-13) and design-principles-v4.md.
import ProjectsClient from "@/components/projects/ProjectsClient";

export default function ProjectsPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <ProjectsClient />
    </div>
  );
}
