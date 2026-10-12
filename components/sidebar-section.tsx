/** The one header style every rail section uses, so Views and Classes line up. */
export function SidebarSectionHeader({
  label,
  children,
}: {
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-7 items-center justify-between pl-2.5 pr-1">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">{label}</p>
      {children && <div className="flex items-center gap-1">{children}</div>}
    </div>
  );
}
