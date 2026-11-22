import { cn } from "@/lib/utils";

/**
 * Full-bleed photo banner used on the golfer, booking and caddie screens.
 * The stock images are AI-generated, so they carry a small label; a golfer's own photo does not.
 */
export function PhotoHero({
  image,
  aiImage = true,
  children,
  aside,
  className,
}: {
  image: string;
  aiImage?: boolean;
  children: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("relative isolate overflow-hidden bg-pine-900 text-alabaster", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image} alt="" className="absolute inset-0 -z-20 size-full object-cover" />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(7,26,18,0.82)_0%,rgba(7,26,18,0.55)_55%,rgba(7,26,18,0.15)_100%)]" />
      <div className={cn("mx-auto grid max-w-5xl gap-8 px-5 py-12 sm:py-16", aside && "md:grid-cols-[1fr_20rem] md:items-center")}>
        <div>{children}</div>
        {aside ? <div>{aside}</div> : null}
      </div>
      {aiImage ? <span className="absolute bottom-2 right-3 text-[0.65rem] text-alabaster/60">AI-generated image</span> : null}
    </section>
  );
}

export function HeroTitle({ children, mono = false }: { children: React.ReactNode; mono?: boolean }) {
  // Times use JetBrains Mono; names and words use the display serif (CLAUDE.md).
  const face = mono ? "numerals font-mono font-medium tracking-tight" : "font-display font-medium tracking-[-0.02em]";
  return <h1 className={`${face} text-4xl text-alabaster sm:text-6xl`}>{children}</h1>;
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="font-sans text-2xl font-bold tracking-tight text-ink">{children}</h2>
      {action}
    </div>
  );
}

/** A two-state chip: "Golfer checked in 6:42 AM" or "Golfer not checked in". */
export function CheckChip({ label, at, timeZone = "Asia/Kolkata", dark = false }: { label: string; at: string | null; timeZone?: string; dark?: boolean }) {
  const time = at ? new Intl.DateTimeFormat("en-IN", { timeStyle: "short", timeZone }).format(new Date(at)) : null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        at ? "bg-pine-50 text-pine-700" : dark ? "bg-alabaster/10 text-alabaster/70" : "bg-alabaster-200 text-ink-muted",
      )}
    >
      <span className={cn("size-1.5 rounded-full", at ? "bg-pine-600" : "bg-ink-faint")} />
      {label} {time ? `checked in ${time}` : "not checked in"}
    </span>
  );
}
