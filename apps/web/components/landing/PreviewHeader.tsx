import {
  ChevronDownIcon,
  ShareIcon,
  ViewCanvasIcon,
  ViewTimelineIcon,
  ViewMapIcon,
  ViewSenseIcon,
} from "@/components/icons/icons";
import styles from "./landing.module.css";

/** A non-interactive replica of the workspace header (components/header/
 *  AppHeader + ViewTabs + WorkspaceToggle) for the landing previews — the home
 *  crumb, the project pill, the Workspace toggle, the three sorting tabs, and
 *  the zoom / share / avatar cluster — so each preview reads as the real app
 *  window. `active` lights the control for the view on screen; the header
 *  collapses its lower-priority pieces on narrow previews via container queries. */

export type PreviewView = "canvas" | "timeline" | "map" | "topic";

const TABS: { key: PreviewView; label: string; Icon: typeof ViewTimelineIcon }[] = [
  { key: "timeline", label: "Timeline", Icon: ViewTimelineIcon },
  { key: "map", label: "Map", Icon: ViewMapIcon },
  { key: "topic", label: "Topic", Icon: ViewSenseIcon },
];

export default function PreviewHeader({ active, project = "My archive" }: { active: PreviewView; project?: string }) {
  return (
    <div className={styles.phBar} aria-hidden="true">
      <div className={styles.phGroup}>
        <span className={styles.phIconBtn}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 10.5 12 3l9 7.5" />
            <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
          </svg>
        </span>
        <span className={styles.phProject}>
          <span className={styles.phDots}>
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i} />
            ))}
          </span>
          <span className={styles.phProjectName}>{project}</span>
          <ChevronDownIcon width={10} height={10} stroke="var(--t3)" />
        </span>
        <span className={`${styles.phWorkspace}${active === "canvas" ? ` ${styles.phWorkspaceOn}` : ""}`}>
          <ViewCanvasIcon width={12} height={12} />
          <span className={styles.phWsLabel}>Workspace</span>
        </span>
      </div>

      <div className={styles.phTabs}>
        {TABS.map(({ key, label, Icon }) => (
          <span key={key} className={`${styles.phTab}${active === key ? ` ${styles.phTabOn}` : ""}`}>
            <Icon width={12} height={12} />
            <span className={styles.phTabLabel}>{label}</span>
          </span>
        ))}
      </div>

      <div className={styles.phGroup}>
        <span className={styles.phZoom}>
          75%
          <ChevronDownIcon width={9} height={9} stroke="currentColor" />
        </span>
        <span className={styles.phShare}>
          <ShareIcon width={12} height={12} />
          <span className={styles.phShareLabel}>Share</span>
        </span>
        <span className={styles.phAvatar}>AM</span>
      </div>
    </div>
  );
}
