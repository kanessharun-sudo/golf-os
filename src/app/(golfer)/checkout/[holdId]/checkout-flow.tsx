"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Clock, CreditCard, Loader2, ShieldCheck, Smartphone, Star, Trash2, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import {
  completeDemoPaymentAction,
  confirmFreeBookingAction,
  createPaymentOrderAction,
  type CheckoutOrder,
  holdCaddyAction,
  quoteHoldAction,
  releaseHoldAction,
  releaseHoldCaddyAction,
  saveHoldDetailsAction,
} from "@/lib/booking/actions";
import { describePolicy } from "@/lib/booking/cancellation";
import { formatPlayDate } from "@/lib/dates";
import { loadRazorpay, type RazorpaySuccess } from "@/lib/payments/checkout-script";
import { cn, formatPaise, formatTeeTime, HOLE_FORMAT_LABEL } from "@/lib/utils";
import type {
  AvailableCaddy,
  CancellationPolicy,
  CoursePricing,
  CourseTee,
  HoleFormat,
  HoldCaddy,
  HoldQuote,
  IsoDate,
  IsoTime,
  IsoTimestamp,
  RoundMode,
  SlotHoldPlayer,
  SlotHoldStatus,
  Uuid,
} from "@/types/database";

type Step = "players" | "caddies" | "pay";

/** Inlined at build time; "demo" swaps Razorpay for a simulated payment screen. */
const DEMO_PAYMENTS = process.env.NEXT_PUBLIC_PAYMENTS_MODE === "demo";
type PlayerRow = { fullName: string; phone: string; email: string };

type Props = {
  hold: {
    id: Uuid;
    status: SlotHoldStatus;
    expiresAt: IsoTimestamp;
    playDate: IsoDate;
    teeTime: IsoTime;
    startHole: 1 | 10;
    holeFormat: HoleFormat;
    seats: number;
    isPrivate: boolean;
    teeId: Uuid | null;
    mode: RoundMode;
    orderId: string | null;
  };
  course: { slug: string; name: string; pricing: CoursePricing; cancellationPolicy: CancellationPolicy };
  tees: Pick<CourseTee, "id" | "name" | "color_hex" | "total_yards" | "is_default">[];
  savedPlayers: SlotHoldPlayer[];
  heldCaddies: HoldCaddy[];
  availableCaddies: AvailableCaddy[];
  bookerName: string;
};

const STEPS: { id: Step; label: string }[] = [
  { id: "players", label: "Players" },
  { id: "caddies", label: "Caddies" },
  { id: "pay", label: "Pay" },
];

function useCountdown(expiresAt: IsoTimestamp): number {
  const target = useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);
  const [remaining, setRemaining] = useState(() => Math.max(0, target - Date.now()));
  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, target - Date.now()));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [target]);
  return remaining;
}

export function CheckoutFlow(props: Props) {
  const { hold, course, tees, savedPlayers, availableCaddies, bookerName } = props;
  const router = useRouter();
  const remaining = useCountdown(hold.expiresAt);
  const orderLocked = hold.orderId !== null;
  const expired = (hold.status !== "active" || remaining === 0) && !orderLocked;

  const [step, setStep] = useState<Step>(orderLocked ? "pay" : savedPlayers.length > 0 && hold.teeId ? "caddies" : "players");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // --- players ---------------------------------------------------------------
  const initialRows: PlayerRow[] = savedPlayers.length
    ? savedPlayers.map((p) => ({ fullName: p.full_name, phone: p.phone ?? "", email: p.email ?? "" }))
    : Array.from({ length: hold.seats }, (_, i) => ({
        fullName: i === 0 ? bookerName : "",
        phone: "",
        email: "",
      }));
  const [rows, setRows] = useState<PlayerRow[]>(initialRows);
  const [bookerPlays, setBookerPlays] = useState(savedPlayers.length ? savedPlayers.some((p) => p.is_booker) : true);
  const [teeId, setTeeId] = useState<Uuid | null>(hold.teeId ?? tees.find((t) => t.is_default)?.id ?? tees[0]?.id ?? null);
  const [mode, setMode] = useState<RoundMode>(hold.mode);

  // --- caddies ---------------------------------------------------------------
  const [held, setHeld] = useState<HoldCaddy[]>(props.heldCaddies);
  const caddyOptions = useMemo(() => {
    const byId = new Map<Uuid, { id: Uuid; name: string; code: string; grade: string; rating: number | null; rate: number; years: number | null }>();
    for (const c of availableCaddies) {
      byId.set(c.caddy_id, {
        id: c.caddy_id,
        name: c.full_name,
        code: c.caddy_code,
        grade: c.grade_label ?? c.grade,
        rating: c.rating,
        rate: c.rate_paise,
        years: c.years_experience,
      });
    }
    // Caddies this golfer already holds are hidden from get_available_caddies; add them back.
    for (const h of held) {
      if (!byId.has(h.caddy_id)) {
        byId.set(h.caddy_id, { id: h.caddy_id, name: h.full_name, code: h.caddy_code, grade: h.grade, rating: h.rating, rate: h.rate_paise, years: null });
      }
    }
    return [...byId.values()];
  }, [availableCaddies, held]);

  // --- pay -------------------------------------------------------------------
  const [quote, setQuote] = useState<HoldQuote | null>(null);
  const [phase, setPhase] = useState<"idle" | "confirming" | "refunded">("idle");
  const [demoOrder, setDemoOrder] = useState<CheckoutOrder | null>(null);

  const loadQuote = useCallback(async () => {
    setError(null);
    setBusy("quote");
    const result = await quoteHoldAction(hold.id);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setQuote(result.data);
  }, [hold.id]);

  useEffect(() => {
    if (step === "pay" && !quote && !expired) void loadQuote();
  }, [step, quote, expired, loadQuote]);

  // While a captured payment is being confirmed, re-render the server page; it redirects once the booking exists.
  useEffect(() => {
    if (phase !== "confirming") return;
    const timer = window.setInterval(() => router.refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [phase, router]);

  async function savePlayers() {
    setError(null);
    if (!teeId) {
      setError("Choose a tee.");
      return;
    }
    const players = rows.map((r, i) => ({
      seatNumber: i + 1,
      fullName: r.fullName.trim(),
      phone: r.phone.trim(),
      email: r.email.trim(),
      isBooker: bookerPlays && i === 0,
    }));
    if (players.some((p) => !p.fullName)) {
      setError("Every player needs a name.");
      return;
    }
    setBusy("players");
    const result = await saveHoldDetailsAction({ holdId: hold.id, teeId, mode, players });
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setHeld((prev) => prev.filter((h) => h.seat_number <= players.length));
    setQuote(null);
    setStep("caddies");
  }

  async function pickCaddy(seat: number, caddyId: Uuid | "") {
    setError(null);
    setBusy(`caddy-${seat}`);
    const result =
      caddyId === ""
        ? await releaseHoldCaddyAction({ holdId: hold.id, seatNumber: seat })
        : await holdCaddyAction({ holdId: hold.id, caddyId, seatNumber: seat });
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      if (result.code === "caddy_unavailable") router.refresh();
      return;
    }
    setHeld(result.data);
    setQuote(null);
  }

  async function pay() {
    setError(null);
    setBusy("pay");
    if (quote && quote.total_paise === 0) {
      const free = await confirmFreeBookingAction(hold.id);
      if (!free.ok) {
        setBusy(null);
        setError(free.error);
        return;
      }
      router.replace(`/bookings/${free.data.bookingId}?paid=1`);
      return;
    }
    const orderResult = await createPaymentOrderAction(hold.id);
    if (!orderResult.ok) {
      setBusy(null);
      setError(orderResult.error);
      return;
    }
    const order = orderResult.data;
    if (order.mode === "demo") {
      setDemoOrder(order);
      setBusy(null);
      router.refresh();
      return;
    }
    let Razorpay;
    try {
      Razorpay = await loadRazorpay();
    } catch {
      setBusy(null);
      setError("Razorpay could not load. Check your connection or disable any content blocker, then try again.");
      return;
    }

    const checkout = new Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      order_id: order.orderId,
      name: order.courseName,
      description: order.description,
      prefill: order.prefill,
      notes: { hold_id: hold.id },
      theme: { color: "#B05E36" },
      handler: (response) => void confirmPayment(response),
      modal: { ondismiss: () => setBusy(null), confirm_close: true },
    });
    checkout.on("payment.failed", (event) => {
      setError(event.error.description ?? "The payment failed. You have not been charged; try again or use another method.");
    });
    checkout.open();
    // Price is frozen once the order exists; reflect that in the UI.
    router.refresh();
  }

  async function confirmPayment(response: RazorpaySuccess) {
    setBusy("verify");
    setPhase("confirming");
    try {
      const res = await fetch("/api/payments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(response),
      });
      const body = (await res.json()) as { status?: string; bookingId?: string; reason?: string };
      if (body.status === "confirmed" && body.bookingId) {
        router.replace(`/bookings/${body.bookingId}?paid=1`);
        return;
      }
      if (body.status === "refunded") {
        setPhase("refunded");
        setBusy(null);
        return;
      }
      // "pending" or anything unexpected: keep polling; the webhook will settle it.
    } catch {
      // Network loss after paying: the webhook settles; keep polling.
    }
  }

  async function completeDemoPayment() {
    setBusy("verify");
    setError(null);
    const result = await completeDemoPaymentAction(hold.id);
    if (!result.ok) {
      setBusy(null);
      setError(result.error);
      return;
    }
    const outcome = result.data;
    if (outcome.status === "confirmed") {
      router.replace(`/bookings/${outcome.bookingId}?paid=1`);
      return;
    }
    setDemoOrder(null);
    setBusy(null);
    if (outcome.status === "refunded") {
      setPhase("refunded");
      return;
    }
    setError("The booking could not be confirmed. Please start again.");
  }

  async function startOver() {
    setBusy("release");
    await releaseHoldAction(hold.id);
    router.push(`/courses/${course.slug}/book?date=${hold.playDate}&format=${hold.holeFormat}`);
  }

  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  const teeName = tees.find((t) => t.id === teeId)?.name;

  if (phase === "refunded") {
    return (
      <Shell hold={hold} course={course}>
        <Notice tone="info">
          Your payment went through, but those seats were taken while you were paying.{" "}
          {DEMO_PAYMENTS
            ? "The demo payment has been refunded in full."
            : "We have started a full refund to your original payment method; it usually lands in 5–7 working days."}
        </Notice>
        <Link href={`/courses/${course.slug}/book?date=${hold.playDate}&format=${hold.holeFormat}`} className={cn(buttonVariants(), "mt-6")}>
          Pick another tee time
        </Link>
      </Shell>
    );
  }

  if (phase === "confirming") {
    return (
      <Shell hold={hold} course={course}>
        <div className="flex items-center gap-3 rounded-card bg-card p-6 shadow-card">
          <Loader2 className="size-5 animate-spin text-pine" aria-hidden />
          <p className="text-sm text-pine">Payment received. Confirming your tee time… Please keep this page open.</p>
        </div>
      </Shell>
    );
  }

  if (expired) {
    return (
      <Shell hold={hold} course={course}>
        <Notice tone="error">Your hold has run out and the seats were released. Nothing was charged.</Notice>
        <Link href={`/courses/${course.slug}/book?date=${hold.playDate}&format=${hold.holeFormat}`} className={cn(buttonVariants(), "mt-6")}>
          Back to the tee sheet
        </Link>
      </Shell>
    );
  }

  return (
    <Shell
      hold={hold}
      course={course}
      aside={
        !orderLocked ? (
          <div
            className={cn(
              "numerals flex items-center gap-2 rounded-card px-3 py-2 text-sm",
              remaining < 60_000 ? "bg-destructive/10 text-destructive" : "bg-brass-100 text-brass-800",
            )}
            role="timer"
            aria-live={remaining < 60_000 ? "assertive" : "off"}
          >
            <Clock className="size-4" aria-hidden />
            Seats held for {minutes}:{seconds.toString().padStart(2, "0")}
          </div>
        ) : null
      }
    >
      <ol className="mb-8 flex items-center gap-3 text-sm" aria-label="Checkout steps">
        {STEPS.map((s, i) => {
          const index = STEPS.findIndex((x) => x.id === step);
          const done = i < index;
          return (
            <li key={s.id} className="flex items-center gap-3">
              <span
                className={cn(
                  "grid size-7 place-items-center rounded-full border text-xs",
                  s.id === step ? "border-brass bg-brass text-white" : done ? "border-pine bg-pine text-alabaster" : "border-alabaster-400 text-ink-faint",
                )}
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className={cn(s.id === step ? "text-pine" : "text-ink-faint")}>{s.label}</span>
              {i < STEPS.length - 1 ? <span className="h-px w-6 bg-alabaster-400" aria-hidden /> : null}
            </li>
          );
        })}
      </ol>

      {error ? (
        <Notice tone="error" className="mb-6">
          {error}
        </Notice>
      ) : null}

      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
          {step === "players" ? (
            <section className="space-y-8">
              <div className="space-y-4">
                {rows.map((row, i) => (
                  <fieldset key={i} className="rounded-card bg-card p-5 shadow-hairline">
                    <legend className="sr-only">Player {i + 1}</legend>
                    <div className="mb-4 flex items-center justify-between">
                      <p className="text-eyebrow uppercase text-brass-700">Player {i + 1}</p>
                      {i === 0 ? (
                        <label className="flex items-center gap-2 text-sm text-ink-muted">
                          <input
                            type="checkbox"
                            className="size-4 accent-pine"
                            checked={bookerPlays}
                            onChange={(e) => {
                              setBookerPlays(e.target.checked);
                              setRows((r) => r.map((x, j) => (j === 0 ? { ...x, fullName: e.target.checked ? bookerName : "" } : x)));
                            }}
                          />
                          I&apos;m playing
                        </label>
                      ) : hold.isPrivate ? (
                        <button
                          type="button"
                          className="flex items-center gap-1 text-sm text-ink-faint hover:text-destructive"
                          onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                        >
                          <Trash2 className="size-3.5" aria-hidden /> Remove
                        </button>
                      ) : null}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label htmlFor={`name-${i}`}>Full name</Label>
                        <Input
                          id={`name-${i}`}
                          value={row.fullName}
                          maxLength={120}
                          autoComplete={i === 0 && bookerPlays ? "name" : "off"}
                          onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, fullName: e.target.value } : x)))}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`phone-${i}`}>Mobile (optional)</Label>
                        <Input
                          id={`phone-${i}`}
                          type="tel"
                          inputMode="tel"
                          placeholder="98765 43210"
                          value={row.phone}
                          onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`email-${i}`}>Email (optional)</Label>
                        <Input
                          id={`email-${i}`}
                          type="email"
                          inputMode="email"
                          value={row.email}
                          onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))}
                        />
                      </div>
                    </div>
                  </fieldset>
                ))}
                {hold.isPrivate && rows.length < hold.seats ? (
                  <Button variant="outline" onClick={() => setRows((r) => [...r, { fullName: "", phone: "", email: "" }])}>
                    <UserPlus /> Add player
                  </Button>
                ) : null}
                <p className="text-xs text-ink-muted">
                  Club members play free: use the mobile or email the club has on file. Guests pay the guest green fee, paid by you as the booker. Each player sees this booking and can score live once they sign in with the same mobile or email.
                </p>
              </div>

              <div>
                <p className="text-eyebrow uppercase text-ink-muted">Tee</p>
                <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Tee">
                  {tees.map((tee) => (
                    <button
                      key={tee.id}
                      type="button"
                      role="radio"
                      aria-checked={teeId === tee.id}
                      onClick={() => setTeeId(tee.id)}
                      className={cn(
                        "numerals flex items-center gap-2 rounded-card border px-4 py-2.5 text-sm transition-colors",
                        teeId === tee.id ? "border-pine bg-pine-50 text-pine" : "border-alabaster-300 bg-card text-ink-muted hover:border-pine/40",
                      )}
                    >
                      <span aria-hidden className="size-3 rounded-full ring-1 ring-pine/20" style={{ backgroundColor: tee.color_hex ?? "#8C928D" }} />
                      {tee.name}
                      {tee.total_yards ? <span className="text-ink-faint">{tee.total_yards} yds</span> : null}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-eyebrow uppercase text-ink-muted">Round</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Round type">
                  {(
                    [
                      { value: "normal", title: "Social round", note: "Counts towards your handicap." },
                      {
                        value: "tournament",
                        title: "Tournament entry",
                        note: `Adds ${formatPaise(course.pricing.tournament_entry_addon)} per player.`,
                      },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={mode === option.value}
                      onClick={() => setMode(option.value)}
                      className={cn(
                        "rounded-card border p-4 text-left transition-colors",
                        mode === option.value ? "border-pine bg-pine-50" : "border-alabaster-300 bg-card hover:border-pine/40",
                      )}
                    >
                      <span className="block text-sm text-pine">{option.title}</span>
                      <span className="numerals mt-1 block text-xs text-ink-muted">{option.note}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" className="text-sm text-ink-faint hover:text-destructive" onClick={() => void startOver()} disabled={busy !== null}>
                  Release seats and start over
                </button>
                <Button size="lg" onClick={() => void savePlayers()} disabled={busy !== null}>
                  {busy === "players" ? <Loader2 className="animate-spin" /> : null}
                  Continue to caddies
                </Button>
              </div>
            </section>
          ) : null}

          {step === "caddies" ? (
            <section className="space-y-6">
              <p className="text-sm text-ink-muted">
                Optional. Each player can take one caddy for the round; only caddies free for your full{" "}
                {HOLE_FORMAT_LABEL[hold.holeFormat].toLowerCase()} window are listed.
              </p>
              {caddyOptions.length === 0 ? (
                <Notice>No caddies are free for this tee time. You can still book and arrange one at the starter&apos;s hut.</Notice>
              ) : null}
              <ul className="space-y-3">
                {rows.map((row, i) => {
                  const seat = i + 1;
                  const current = held.find((h) => h.seat_number === seat);
                  const takenElsewhere = new Set(held.filter((h) => h.seat_number !== seat).map((h) => h.caddy_id));
                  return (
                    <li key={seat} className="flex flex-col gap-3 rounded-card bg-card p-4 shadow-hairline sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-eyebrow uppercase text-ink-faint">Player {seat}</p>
                        <p className="text-pine">{row.fullName}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          aria-label={`Caddy for ${row.fullName}`}
                          className="numerals h-11 w-full min-w-64 rounded-card border border-input bg-card px-3 text-sm text-ink shadow-hairline focus:border-brass focus:outline-none focus:ring-2 focus:ring-brass/30 sm:w-auto"
                          value={current?.caddy_id ?? ""}
                          disabled={busy !== null || caddyOptions.length === 0}
                          onChange={(e) => void pickCaddy(seat, e.target.value)}
                        >
                          <option value="">No caddy</option>
                          {caddyOptions.map((c) => (
                            <option key={c.id} value={c.id} disabled={takenElsewhere.has(c.id)}>
                              {c.name} · {c.grade}
                              {c.rating !== null ? ` · ★${Number(c.rating).toFixed(1)}` : ""} · {formatPaise(c.rate)}
                            </option>
                          ))}
                        </select>
                        {busy === `caddy-${seat}` ? <Loader2 className="size-4 animate-spin text-ink-faint" aria-hidden /> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {held.length ? (
                <ul className="flex flex-wrap gap-2 text-xs text-ink-muted">
                  {held.map((h) => (
                    <li key={h.assignment_id} className="flex items-center gap-1 rounded-full bg-pine-50 px-3 py-1 text-pine">
                      <Star className="size-3 fill-brass text-brass" aria-hidden /> {h.full_name} for player {h.seat_number}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex items-center justify-between">
                <Button variant="ghost" onClick={() => setStep("players")} disabled={busy !== null}>
                  Back
                </Button>
                <Button size="lg" onClick={() => setStep("pay")} disabled={busy !== null}>
                  Review and pay
                </Button>
              </div>
            </section>
          ) : null}

          {step === "pay" ? (
            <section className="grid gap-8 md:grid-cols-[3fr_2fr]">
              <div className="rounded-card bg-card p-6 shadow-card">
                <p className="text-eyebrow uppercase text-brass-700">Summary</p>
                <dl className="mt-4 space-y-2 text-sm">
                  <Row label="Players" value={rows.map((r) => r.fullName).join(", ")} />
                  <Row label="Tee" value={teeName ?? "—"} />
                  <Row label="Round" value={mode === "tournament" ? "Tournament entry" : "Social round"} />
                  {held.length ? <Row label="Caddies" value={held.map((h) => `${h.full_name} (P${h.seat_number})`).join(", ")} /> : null}
                </dl>
                <div className="rule-brass my-5" />
                {quote ? (
                  <dl className="numerals space-y-2 text-sm">
                    {quote.guests !== undefined && quote.guest_green_fee_paise !== undefined ? (
                      <>
                        <Row label={`Members · ${quote.members ?? 0} × free`} value={formatPaise((quote.members ?? 0) * (quote.member_green_fee_paise ?? 0))} />
                        <Row label={`Guests · ${quote.guests} × ${formatPaise(quote.guest_green_fee_paise)}`} value={formatPaise(quote.guests * quote.guest_green_fee_paise)} />
                      </>
                    ) : (
                      <Row label={`Green fees · ${quote.players} × ${quote.is_weekend ? "weekend" : "weekday"}`} value={formatPaise(quote.green_fee_paise)} />
                    )}
                    {quote.caddy_fee_paise > 0 ? <Row label="Caddy fees" value={formatPaise(quote.caddy_fee_paise)} /> : null}
                    {quote.tournament_addon_paise > 0 ? <Row label="Tournament entry" value={formatPaise(quote.tournament_addon_paise)} /> : null}
                    <Row label={`Convenience fee (${quote.convenience_fee_percent}%)`} value={formatPaise(quote.convenience_fee_paise)} />
                    <div className="flex items-baseline justify-between border-t border-alabaster-300 pt-3">
                      <dt className="text-pine">Total</dt>
                      <dd className="font-mono tracking-tight text-3xl text-pine">{formatPaise(quote.total_paise)}</dd>
                    </div>
                  </dl>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-ink-muted">
                    <Loader2 className="size-4 animate-spin" aria-hidden /> Calculating total…
                  </div>
                )}
              </div>
              <div className="space-y-4">
                <Button variant="brass" size="lg" className="w-full" disabled={!quote || busy !== null} onClick={() => void pay()}>
                  {busy === "pay" ? <Loader2 className="animate-spin" /> : null}
                  {quote ? (quote.total_paise === 0 ? "Confirm booking" : `Pay ${formatPaise(quote.total_paise)}`) : "Pay"}
                </Button>
                <p className="text-xs text-ink-muted">
                  {quote?.total_paise === 0
                    ? "Every player is a club member, so there is nothing to pay."
                    : DEMO_PAYMENTS
                    ? "Demo mode: the payment screen is simulated and no money is taken."
                    : "UPI, cards, netbanking and wallets via Razorpay."}
                </p>
                <ul className="space-y-1 text-xs text-ink-muted">
                  {describePolicy(course.cancellationPolicy).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {!orderLocked ? (
                  <Button variant="ghost" onClick={() => setStep("caddies")} disabled={busy !== null}>
                    Back
                  </Button>
                ) : (
                  <p className="text-xs text-ink-muted">Payment has started, so the details above are locked.</p>
                )}
              </div>
            </section>
          ) : null}
        </motion.div>
      </AnimatePresence>
      <AnimatePresence>
        {demoOrder ? (
          <DemoPaymentSheet
            order={demoOrder}
            busy={busy === "verify"}
            onPay={() => void completeDemoPayment()}
            onClose={() => setDemoOrder(null)}
          />
        ) : null}
      </AnimatePresence>
    </Shell>
  );
}

const DEMO_METHODS = [
  { id: "upi", label: "UPI", detail: "golfer@okaxis", Icon: Smartphone },
  { id: "card", label: "Card", detail: "Visa •••• 4242", Icon: CreditCard },
] as const;

function DemoPaymentSheet({
  order,
  busy,
  onPay,
  onClose,
}: {
  order: CheckoutOrder;
  busy: boolean;
  onPay: () => void;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<(typeof DEMO_METHODS)[number]["id"]>("upi");
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-pine/60 p-4 sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="demo-pay-title"
    >
      <motion.div
        className="w-full max-w-sm rounded-card bg-alabaster p-6 shadow-card"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 24, opacity: 0 }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-eyebrow uppercase text-brass-700">Demo payment</p>
            <h2 id="demo-pay-title" className="mt-1 font-display text-2xl text-pine">
              {order.courseName}
            </h2>
            <p className="text-sm text-ink-muted">{order.description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full p-1 text-ink-muted hover:text-pine disabled:opacity-50"
            aria-label="Close payment screen"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <p className="numerals mt-5 font-mono tracking-tight text-4xl text-pine">{formatPaise(order.amount)}</p>

        <fieldset className="mt-5 space-y-2">
          <legend className="sr-only">Payment method</legend>
          {DEMO_METHODS.map(({ id, label, detail, Icon }) => (
            <label
              key={id}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors",
                method === id ? "border-pine bg-card" : "border-alabaster-300 hover:border-pine/40",
              )}
            >
              <input
                type="radio"
                name="demo-method"
                value={id}
                checked={method === id}
                onChange={() => setMethod(id)}
                className="sr-only"
              />
              <Icon className="size-4 text-pine" aria-hidden />
              <span className="font-medium text-pine">{label}</span>
              <span className="ml-auto text-ink-muted">{detail}</span>
            </label>
          ))}
        </fieldset>

        <Button variant="brass" size="lg" className="mt-6 w-full" disabled={busy} onClick={onPay}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          {busy ? "Confirming…" : `Pay ${formatPaise(order.amount)}`}
        </Button>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-muted">
          <ShieldCheck className="size-3.5" aria-hidden />
          Simulated for demonstration. No money is taken and refunds settle instantly.
        </p>
      </motion.div>
    </motion.div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right text-pine">{value}</dd>
    </div>
  );
}

function Shell({
  hold,
  course,
  aside,
  children,
}: {
  hold: Props["hold"];
  course: Props["course"];
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-4xl px-5 py-10 sm:py-14">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow uppercase text-brass-700">{course.name}</p>
          <h1 className="mt-2 font-display text-display-sm text-pine">
            {formatTeeTime(hold.teeTime)}, {formatPlayDate(hold.playDate, "short")}
          </h1>
          <p className="numerals mt-1 text-sm text-ink-muted">
            {HOLE_FORMAT_LABEL[hold.holeFormat]} from hole {hold.startHole}
            {hold.isPrivate ? ` · Blocked ${hold.seats}-ball` : ` · ${hold.seats} seat${hold.seats > 1 ? "s" : ""}`}
          </p>
        </div>
        {aside}
      </div>
      {children}
    </div>
  );
}
