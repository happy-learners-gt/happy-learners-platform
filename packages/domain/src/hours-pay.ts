import type { CompensationPeriod, Contract, ContractEngagement, ContractTerms } from "@happy-learners/contracts";

/**
 * HRS-03 (AP-08, decided by the owner on 03-nov-2026): what a person's contract in force says about the hours of a
 * report. An amount for the hours registered only makes sense for a contract paid by the hour that is neither
 * employment (salaried), volunteer (ad honorem) nor professional services paid under their own agreement: that one is
 * shown to the person too. Administration also sees a reference for the rest: the same product for other hourly
 * contracts, classes × rate for per-class ones, and what a fixed monthly amount comes to per effective hour when the
 * report covers one whole month. Amounts are whole cents, never floating point; this is a reference, not payroll.
 */
export type HoursPay =
  | { kind: "hourly"; payable: boolean; cents: number; rateCents: number; currency: string; minutes: number }
  | { kind: "per-session"; cents: number; rateCents: number; currency: string; classes: number }
  | { kind: "fixed"; amountCents: number; currency: string; period: CompensationPeriod; perHourCents: number | null }
  | { kind: "none"; minutes: number }
  | { kind: "no-contract" };

const unpaidByHours: readonly ContractEngagement[] = ["employment", "volunteer", "services"];
/** Whether the hours registered turn into an amount the person sees: hourly pay outside salaried, volunteer and services contracts. */
export function hoursPayable(contract: Pick<Contract, "engagement" | "terms">): boolean {
  return contract.terms.compensation.kind === "hourly" && !unpaidByHours.includes(contract.engagement);
}

/** «12.5» → 1250. Contract amounts are validated as up to 9 digits and 2 decimals. */
export function amountCents(amount: string | undefined): number | null {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(amount || "");
  return match ? Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0")) : null;
}

/** The contract in force of a person: in force or ending, the latest started. */
export function personContract<T extends Pick<Contract, "userId" | "phase" | "startDate">>(contracts: T[], userId: string): T | null {
  return contracts.filter(item => item.userId === userId && (item.phase === "in-force" || item.phase === "ending")).sort((a, b) => b.startDate.localeCompare(a.startDate))[0] || null;
}

/** `wholeMonth`: the report covers exactly one calendar month, so a monthly amount can be read per effective hour. */
export function hoursPay(contract: Pick<Contract, "engagement" | "terms"> | null, worked: { minutes: number; classes: number }, wholeMonth: boolean): HoursPay {
  if (!contract) return { kind: "no-contract" };
  const pay: ContractTerms["compensation"] = contract.terms.compensation, cents = amountCents(pay.amount), currency = pay.currency || "";
  if (pay.kind === "none" || cents === null || !currency) return { kind: "none", minutes: worked.minutes };
  if (pay.kind === "hourly") return { kind: "hourly", payable: hoursPayable(contract), cents: Math.round(cents * worked.minutes / 60), rateCents: cents, currency, minutes: worked.minutes };
  if (pay.kind === "per-session") return { kind: "per-session", cents: cents * worked.classes, rateCents: cents, currency, classes: worked.classes };
  const period = pay.period || "month";
  return { kind: "fixed", amountCents: cents, currency, period, perHourCents: wholeMonth && period === "month" && worked.minutes > 0 ? Math.round(cents * 60 / worked.minutes) : null };
}

/** «GTQ 1,250.00»: an amount in cents in the contract's currency. */
export function formatCents(cents: number, currency: string, locale = "es") {
  return new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "code" }).format(cents / 100);
}
