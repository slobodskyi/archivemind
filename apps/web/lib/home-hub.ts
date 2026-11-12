/** The homepage hub's create chrome: which of its pieces are on screen.
 *
 *  An empty hub has exactly ONE call to action — the dashed "Create your first
 *  project" card in the grid's first cell. With projects there is no idle
 *  ghost card beside them (a dead cell for every user who already has some);
 *  the header's "+ New project" opens the same form in that same first cell.
 *  Either way the name form has one home: the Projects grid's first cell. The
 *  Recents header button switches to Projects and opens it there, since
 *  Recents is a history list, not where projects are made.
 *
 *  Pure, so the rules are unit-tested (`home-hub.test.ts`); `HomeClient` only
 *  wires them. */

export type HubView = "projects" | "recents" | "archived" | "trash" | "usage";

export interface HubCreateChrome {
  /** The header's "+ New project" button. */
  headerButton: boolean;
  /** The dashed card in the Projects grid's first cell — idle on the empty
   *  hub, the name form whenever `creating`. */
  newCard: boolean;
  /** The card reads "Create your first project" rather than "New project". */
  firstProject: boolean;
  /** The grey line under the grid: none, the search miss, or the view's own. */
  emptyLine: "none" | "search" | "view";
  /** The drop-to-upload refusal on the hub (no project is open here). */
  uploadMessage: string;
}

export function hubCreateChrome(i: {
  view: HubView;
  /** Active (not archived, not trashed) projects — the hub's real count. */
  activeCount: number;
  query: string;
  creating: boolean;
  /** Cards the grid draws for this view after the search. */
  visibleCount: number;
}): HubCreateChrome {
  const searching = i.query.trim() !== "";
  const headerButton =
    (i.view === "projects" && i.activeCount > 0 && !i.creating) || i.view === "recents";
  // An open form survives a search typed mid-create; an idle ghost does not.
  const newCard =
    i.view === "projects" && (i.activeCount === 0 || i.creating) && (!searching || i.creating);
  const emptyLine: HubCreateChrome["emptyLine"] =
    i.view === "usage" || i.view === "trash" || i.visibleCount > 0 || newCard
      ? "none"
      : searching
        ? "search"
        : "view";
  return {
    headerButton,
    newCard,
    firstProject: i.activeCount === 0,
    emptyLine,
    uploadMessage: i.activeCount === 0 ? "CREATE A PROJECT TO UPLOAD" : "OPEN A PROJECT TO UPLOAD",
  };
}
