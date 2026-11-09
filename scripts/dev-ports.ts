// `npm run dev:ports`: every checkout's test and prod API and web URLs (#157), this one marked.
// It may make this checkout's .dev-ports.json, like any dev command, but never another's.
import { assignedPorts, checkoutPorts, worktrees } from "./checkout-ports.ts";
import { devPortsTable, mainCheckoutPorts } from "./dev-ports-plan.ts";
import { checkoutRoot } from "./processes.ts";

const root = checkoutRoot();
const ports = checkoutPorts();
const rows = worktrees().map((path, index) => ({
  path,
  // git lists the main checkout first, and it never has a file.
  ports: path === root ? ports : index === 0 ? mainCheckoutPorts : assignedPorts(path),
  current: path === root,
}));
console.log(devPortsTable(rows));
