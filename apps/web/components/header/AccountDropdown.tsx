import { SettingsIcon, BillingIcon, UsageIcon, SignOutIcon } from "@/components/icons/icons";

interface AccountDropdownProps {
  open: boolean;
  onClose: () => void;
  onFlashToast: (text: string) => void;
}

const ITEMS = [
  { label: "Account Settings", icon: SettingsIcon, color: "var(--t2)", toast: "Settings coming soon" },
  { label: "Billing & Plan", icon: BillingIcon, color: "var(--t2)", toast: "Billing coming soon" },
  { label: "Usage & Storage", icon: UsageIcon, color: "var(--t2)", toast: "12% of 500 GB used" },
  { label: "Sign out", icon: SignOutIcon, color: "var(--red)", toast: "Signed out" },
];

export default function AccountDropdown({ open, onClose, onFlashToast }: AccountDropdownProps) {
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 48 }} />
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
          zIndex: 49,
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
            AM
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--t1)" }}>Alex M.</div>
            <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 1 }}>Pro · 12% used</div>
          </div>
        </div>
        <div style={{ height: 1, background: "var(--bd)", marginBottom: 4 }} />
        {ITEMS.map((it) => {
          const Icon = it.icon;
          return (
            <button
              key={it.label}
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
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                width: "100%",
                padding: "9px 10px",
                background: "transparent",
                border: 0,
                borderRadius: 2,
                cursor: "pointer",
                fontFamily: "inherit",
                color: it.color,
                fontSize: 13,
              }}
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
