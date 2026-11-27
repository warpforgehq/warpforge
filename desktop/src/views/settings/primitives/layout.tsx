import { Info } from "lucide-react";

import { cn } from "@/lib/utils";
import type { SettingsPage as SettingsPageId } from "@/store/ui";

import { SETTINGS_PAGES } from "../nav";

/**
 * The title block of a settings page: name, one-line description, actions.
 * @param page Which page this is; title and description come from the nav.
 * @param actions Buttons on the right, such as "Restore defaults".
 */
export function SettingsHeader({
  page,
  actions,
}: {
  page: SettingsPageId;
  actions?: React.ReactNode;
}) {
  const meta = SETTINGS_PAGES.find((item) => item.id === page);
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[1.25rem] font-medium tracking-tight text-foreground">{meta?.label}</h1>
        <p className="mt-1 text-[0.8125rem] text-muted-foreground">{meta?.description}</p>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2 pt-0.5">{actions}</div>}
    </header>
  );
}

/**
 * A settings page: its header, then its sections.
 * @param page Which page this is.
 * @param actions Header actions on the right.
 * @param children The page's `SettingsSection`s.
 */
export function SettingsPage({
  page,
  actions,
  children,
}: {
  page: SettingsPageId;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <SettingsHeader page={page} actions={actions} />
      {children}
    </div>
  );
}

/**
 * The hairline surface that groups rows; rows are divided, not boxed.
 * @param className Extra classes, e.g. padding for non-row content.
 * @param children Rows, notes or free content.
 */
export function SettingsCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "divide-y divide-rule overflow-hidden rounded-xl border border-border bg-foreground/[0.02]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A labelled group of settings on a card.
 * @param id Deep-link target for the settings search.
 * @param title Sentence-case label above the card.
 * @param actions Small controls aligned right of the label.
 * @param padded Pad the card, for content that is not a list of rows.
 * @param children The card's content.
 */
export function SettingsSection({
  id,
  title,
  actions,
  padded,
  children,
}: {
  id?: string;
  title: string;
  actions?: React.ReactNode;
  padded?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section id={id} tabIndex={id ? -1 : undefined} className="mt-6 rounded-xl">
      <div className="mb-2 flex min-h-6 items-center justify-between gap-2 px-1">
        <h2 className="text-[0.75rem] font-medium text-muted-foreground">{title}</h2>
        {actions}
      </div>
      <SettingsCard className={padded ? "p-3.5" : undefined}>{children}</SettingsCard>
    </section>
  );
}

/**
 * One setting: title over description on the left, control on the right.
 *
 * Long explanations go in `hint`, behind the info icon, so a row stays a
 * line or two and the page stays scannable.
 * @param id Deep-link target for the settings search.
 * @param icon Leading visual, such as a logo.
 * @param title What the setting is.
 * @param meta Muted inline detail after the title (version, badge).
 * @param description One sentence on what the control does.
 * @param hint Longer help, shown on hover of the info icon.
 * @param control The control, vertically centred on the right.
 * @param resetAction Inline reset button beside the title.
 */
export function SettingsRow({
  id,
  icon,
  title,
  meta,
  description,
  hint,
  control,
  resetAction,
}: {
  id?: string;
  icon?: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  description?: React.ReactNode;
  hint?: string;
  control?: React.ReactNode;
  resetAction?: React.ReactNode;
}) {
  return (
    <div
      id={id}
      tabIndex={id ? -1 : undefined}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-3"
    >
      <div className="flex min-w-[12rem] flex-1 items-start gap-2.5">
        {icon && <span className="mt-0.5 flex shrink-0 items-center">{icon}</span>}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <h3 className="min-w-0 break-words text-[0.8125rem] font-medium text-foreground">
              {title}
            </h3>
            {meta}
            {resetAction}
          </div>
          {(description || hint) && (
            <div className="mt-0.5 max-w-[60ch] break-words text-[0.75rem] leading-relaxed text-muted-foreground">
              {description}
              {hint && (
                <span
                  role="img"
                  aria-label={hint}
                  title={hint}
                  className="ml-1 inline-flex shrink-0 cursor-help align-[-0.125em] text-muted-foreground/60"
                >
                  <Info className="size-3" aria-hidden />
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      {control && <div className="ml-auto flex max-w-full items-center gap-2">{control}</div>}
    </div>
  );
}

/**
 * Muted badge for a state next to a row title.
 * @param tone `warn` for states that need attention, `muted` otherwise.
 * @param children Badge text.
 */
export function SettingsBadge({
  tone = "muted",
  children,
}: {
  tone?: "warn" | "muted";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 text-[0.6875rem] font-medium leading-[1.125rem]",
        tone === "warn" ? "bg-warn/10 text-warn" : "bg-foreground/[0.06] text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/**
 * Read-only facts at the foot of a card: counts, detected state.
 * @param items Label, value and optional tooltip for each fact.
 */
export function StatusStrip({
  items,
}: {
  items: { label: string; value: React.ReactNode; title?: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-3.5 py-2.5">
      {items.map((item) => (
        <span
          key={item.label}
          className="flex items-center gap-1.5 text-[0.75rem]"
          title={item.title}
        >
          <span className="text-muted-foreground/70">{item.label}</span>
          <span className="tabular-nums text-foreground/80">{item.value}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * A sentence at the foot of a card, tying its rows together.
 * @param children The note.
 */
export function SettingsNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3.5 py-2.5 text-[0.75rem] leading-relaxed text-muted-foreground/80">
      {children}
    </p>
  );
}
