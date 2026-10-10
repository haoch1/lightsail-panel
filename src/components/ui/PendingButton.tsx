import type { ButtonHTMLAttributes, ReactNode } from "react";

/** Keep both labels in the layout so submitting never moves adjacent controls. */
export function PendingButton({
  busy,
  pendingLabel,
  children,
  className = "button primary",
  disabled,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  busy: boolean;
  pendingLabel: string;
  children: ReactNode;
}) {
  return (
    <button
      {...props}
      className={className + " pending-button"}
      disabled={busy || disabled}
      aria-busy={busy}
    >
      <span className="pending-button-label">
        <span aria-hidden={busy} className={busy ? "" : "active"}>
          {children}
        </span>
        <span aria-hidden={!busy} className={busy ? "active" : ""}>
          {pendingLabel}
        </span>
      </span>
    </button>
  );
}
