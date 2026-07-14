"use client";

import { Z } from "@/lib/ui";
import {
  ChevronDownIcon,
  SettingsIcon,
  AddIcon,
  TeamIcon,
  ThemeIcon,
  DesktopIcon,
  SignOutIcon,
} from "@/components/icons/icons";

interface Account {
  initials: string;
  name: string;
  email: string;
}

interface AccountMenuProps {
  account: Account;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onFlashToast: (text: string) => void;
}

const ITEMS = [
  { label: "Settings", icon: SettingsIcon, toast: "Settings coming soon" },
  { label: "Add account", icon: AddIcon, toast: "Multi-account coming soon" },
  { label: "Create team", icon: TeamIcon, toast: "Teams coming soon" },
  { label: "Change theme", icon: ThemeIcon, toast: "Theme switching coming soon" },
  { label: "Get desktop app", icon: DesktopIcon, toast: "Desktop app coming soon" },
] as const;

export default function AccountMenu({ account, open, onToggle, onClose, onFlashToast }: AccountMenuProps) {
  return (
    <div style={{ position: "relative", marginBottom: 14 }}>
      <button
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          width: "100%",
          padding: "6px 8px",
          background: open ? "var(--bg-el)" : "transparent",
          border: 0,
          borderRadius: 2,
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 2,
            background: "var(--bg-el)",
            border: "1px solid var(--bdh)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--t1)",
            fontSize: 10,
            fontWeight: 700,
            flex: "0 0 auto",
          }}
        >
          {account.initials}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12.5, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {account.name}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--tm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {account.email}
          </div>
        </div>
        <span style={{ display: "flex", flex: "0 0 auto", color: "var(--t3)" }}>
          <ChevronDownIcon width={11} height={11} />
        </span>
      </button>

      {open && (
        <>
          <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: Z.menuBackdrop }} />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              width: 220,
              background: "rgba(18,18,18,.97)",
              border: "1px solid var(--bd)",
              borderRadius: 2,
              backdropFilter: "blur(20px)",
              boxShadow: "0 20px 60px rgba(0,0,0,.7)",
              zIndex: Z.menu,
              padding: 6,
            }}
          >
            {ITEMS.map((it) => {
              const Icon = it.icon;
              return (
                <button
                  key={it.label}
                  onClick={() => {
                    onClose();
                    onFlashToast(it.toast);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    width: "100%",
                    padding: "9px 10px",
                    border: 0,
                    borderRadius: 2,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    color: "var(--t2)",
                    fontSize: 13,
                    background: "transparent",
                  }}
                >
                  <Icon />
                  <span>{it.label}</span>
                </button>
              );
            })}
            <div style={{ height: 1, background: "var(--bd)", margin: "4px 0" }} />
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  width: "100%",
                  padding: "9px 10px",
                  border: 0,
                  borderRadius: 2,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  color: "var(--red, #ff5c5c)",
                  fontSize: 13,
                  background: "transparent",
                }}
              >
                <SignOutIcon />
                <span>Log out</span>
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
