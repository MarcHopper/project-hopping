// Seed the hop grid with Marc's real projects. Idempotent: upsert by id only
// touches name + path, so re-running NEVER clobbers tallies, status, or any
// reordering/archiving you've done in the app. All projects are editable in-app.
//
//   npm run seed

import { upsertProject } from "../lib/db";

interface Seed {
  id: string;
  name: string;
  path: string; // "" = no local repo (still tracked; just won't auto-map agents)
}

const SEED: Seed[] = [
  { id: "unmapped", name: "Unmapped", path: "" }, // fallback for unknown folders; never delete
  { id: "sellichat", name: "SelliChat", path: "" },
  { id: "vme-tools", name: "VME / vme-tools", path: "/Users/hop/Documents/vme-tools" },
  { id: "dezlin", name: "DezLin", path: "" },
  { id: "dezlin-listing-tool", name: "DezLin Listing Tool", path: "/Users/hop/dezlin-listing-tool" },
  { id: "everymos", name: "EveryMOS", path: "" },
  { id: "marchopper-site", name: "marchopper.com", path: "/Users/hop/marchopper-site" },
  { id: "job-tracker", name: "Job Tracker", path: "/Users/hop/job-tracker" },
  { id: "lawyer-outreach", name: "Lawyer Outreach", path: "/Users/hop/lawyer-outreach" },
  { id: "aishas-notebook", name: "Aisha's Notebook", path: "/Users/hop/aishas-notebook-showcase" },
  { id: "lets-talk-freely", name: "Secret Squirrel", path: "/Users/hop/lets-talk-freely" },
  { id: "project-hopping", name: "Hopping (this tool)", path: "/Users/hop/project-hopping" },
];

let n = 0;
for (const s of SEED) {
  upsertProject({ id: s.id, name: s.name, path: s.path, sort_order: n++ });
}
console.log(`Seeded ${SEED.length} projects.`);
