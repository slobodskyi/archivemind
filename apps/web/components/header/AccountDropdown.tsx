import Link from "next/link";
import { Z } from "@/lib/ui";
import { SettingsIcon, BillingIcon, UsageIcon, SignOutIcon } from "@/components/icons/icons";

interface Account {
  initials: string;
  name: string;
  email: string;
}

interface AccountDropdownProps {
  open: boolean;
  account: Account;
  onClose: () => void;
  onFlashToast: (text: string) => void;
}

/** `href` means the destination exists; the rest still toast. Usage & Storage
 *  became real with migration 20260727000002 — Settings and Billing have no
 *  page yet, and a link to a 404 is worse than an honest "coming soon". */
const ITEMS: {
  label: string;
  icon: typeof SettingsIcon;
  color: string;
  toast: string;
  href?: string;
}[] = [
  { label: "Account Settings", icon: SettingsIcon, color: "var(--t2)", toast: "Settings coming soon" },
  { label: "Billing & Plan", icon: BillingIcon, color: "var(--t2)", toast: "Billing arrives with the first paid plan" },
  { label: "Usage & Storage", icon: UsageIcon, color: "var(--t2)", toast: "", href: "/account/usage" },
  { label: "Sign out", icon: SignOutIcon, color: "var(--red)", toast: "Signed out" },
];

const ITEM_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  width: "100%",
  padding: "9px 10px",
  border: 0,
  borderRadius: 2,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 13,
  textDecoration: "none",
};

export default function AccountDropdown({ open, account, onClose, onFlashToast }: AccountDropdownProps) {
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: Z.menuBackdrop }} />
      <div
        style={{
          position: "absolute",
          top: 58,
          right: 12,
          width: 230,
          background: "rgba(18,18,18,.97)",
          border: "1px solid var(--bd)",
          borderRadius: 2,
          backdropFilter: "blur(20px)",
          boxShadow: "0 20px 60px rgba(0,0,0,.7)",
          zIndex: Z.menu,
          padding: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px 12px" }}>
          <div
            style={{
              width: 32,
              height: 32,
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
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 400, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.name}</div>
            <div style={{ fontSize: 10.5, color: "var(--t2)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={account.email}>{account.email}</div>
          </div>
        </div>
        <div style={{ height: 1, background: "var(--bd)", marginBottom: 4 }} />
        {ITEMS.map((it) => {
          const Icon = it.icon;
          if (it.href) {
            return (
              <Link
                key={it.label}
                href={it.href}
                className="am-mi"
                onClick={onClose}
                style={{ ...ITEM_STYLE, color: it.color }}
              >
                <Icon />
                <span>{it.label}</span>
              </Link>
            );
          }
          return (
            <button
              key={it.label}
              className="am-mi"
              onClick={() => {
                onClose();
                if (it.label === "Sign out") {
                  void fetch("/auth/signout", { method: "POST" }).then(() => {
                    window.location.assign("/login");
                  });
                  return;
                }
                onFlashToast(it.toast);
              }}
              style={{ ...ITEM_STYLE, color: it.color }}
            >
              <Icon />
              <span>{it.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
