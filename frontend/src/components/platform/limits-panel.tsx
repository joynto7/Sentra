"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";

import { FormField } from "@/components/auth/form-field";
import { PasswordInput } from "@/components/auth/password-input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ApiError, fieldErrors } from "@/lib/api";
import { confirmPassword } from "@/lib/mfa";
import {
  type OrganizationUsage,
  type UsageOverview,
  amount,
  against,
  limitOf,
  setLimits,
} from "@/lib/usage-limits";

/**
 * Screen 61, "Edit limits" side panel: the monthly limits of one organization (UC-10.6 steps 2-4).
 * A limit at or below this month's usage is allowed, but only after Sentra has said what it means
 * and the administrator has confirmed it (2a1).
 */
export function LimitsPanel({
  organization,
  overview,
  onClose,
  onSaved,
}: {
  organization: OrganizationUsage | null;
  overview: UsageOverview;
  onClose: () => void;
  onSaved: (organization: OrganizationUsage) => void;
}) {
  return (
    <Sheet open={!!organization} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-[520px]">
        {organization && (
          /* The form starts from the organization's own limits, so it is mounted per organization
             instead of copying them into state afterwards. */
          <LimitsForm
            key={organization.id}
            organization={organization}
            overview={overview}
            onClose={onClose}
            onSaved={onSaved}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function LimitsForm({
  organization,
  overview,
  onClose,
  onSaved,
}: {
  organization: OrganizationUsage;
  overview: UsageOverview;
  onClose: () => void;
  onSaved: (organization: OrganizationUsage) => void;
}) {
  const [campaigns, setCampaigns] = useState(
    String(Number(limitOf(organization, "campaign_runs").limit)),
  );
  const [attempts, setAttempts] = useState(
    String(Number(limitOf(organization, "attempts").limit)),
  );
  const [cost, setCost] = useState(
    Number(limitOf(organization, "llm_cost").limit).toFixed(2),
  );
  const [warn, setWarn] = useState(String(organization.warn_percent));
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [consequence, setConsequence] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save(confirmedConsequence: boolean) {
    const found: Record<string, string> = {};
    for (const [field, value] of [
      ["campaign_runs", campaigns],
      ["attempts", attempts],
      ["llm_cost_usd", cost],
    ] as const) {
      if (
        !value.trim() ||
        Number(value) < 0 ||
        !Number.isFinite(Number(value))
      ) {
        found[field] = "Enter a number of 0 or more.";
      }
    }
    if (Number(warn) < 50 || Number(warn) > 99)
      found.warn_percent = "Warn at 50 to 99 per cent.";
    if (!password) found.password = "Enter your password to confirm.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setPending(true);
    try {
      await confirmPassword(password); // NFR-3.5, right before the limits change
      onSaved(
        await setLimits(organization.id, {
          campaign_runs: Number(campaigns),
          attempts: Number(attempts),
          llm_cost_usd: Number(cost).toFixed(2),
          warn_percent: Number(warn),
          confirmed: confirmedConsequence,
        }),
      );
      onClose();
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "below_this_months_usage"
      ) {
        setConsequence(error.message); // 2a1: it is allowed, once it has been read
        setErrors({});
      } else {
        const fields = fieldErrors(error);
        setErrors(
          Object.keys(fields).length
            ? fields
            : {
                form:
                  error instanceof ApiError
                    ? error.message
                    : "Something went wrong. Try again.",
              },
        );
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save(!!consequence);
      }}
      className="flex min-h-full flex-col"
    >
      <SheetHeader className="border-b px-6 py-4 pr-12">
        <SheetTitle className="text-base font-semibold">Edit limits</SheetTitle>
        <SheetDescription>
          {organization.name}&apos;s monthly limits. They apply from the next
          campaign run and the next attempt.
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-5 px-6 py-5">
        {errors.form && (
          <Alert variant="destructive" role="alert">
            <TriangleAlert aria-hidden="true" />
            <AlertDescription>{errors.form}</AlertDescription>
          </Alert>
        )}

        <dl className="grid grid-cols-3 gap-3 rounded-[10px] border p-3 text-sm">
          {organization.limits.map((limit) => (
            <div key={limit.kind}>
              <dt className="text-xs text-muted-foreground">This month</dt>
              <dd className="tabular">{against(limit)}</dd>
              <dd className="text-xs text-muted-foreground capitalize">
                {limit.label}
              </dd>
            </div>
          ))}
        </dl>

        <FormField
          id="limit-campaigns"
          label="Campaigns per month"
          error={errors.campaign_runs}
        >
          <Input
            id="limit-campaigns"
            type="number"
            min={0}
            inputMode="numeric"
            value={campaigns}
            onChange={(event) => setCampaigns(event.target.value)}
            aria-invalid={!!errors.campaign_runs || undefined}
            aria-describedby={
              errors.campaign_runs ? "limit-campaigns-error" : undefined
            }
            className="tabular h-9"
          />
          <p className="text-xs text-muted-foreground">
            Platform default:{" "}
            {amount("campaign_runs", overview.defaults.campaign_runs)}
          </p>
        </FormField>

        <FormField
          id="limit-attempts"
          label="Attempts per month"
          error={errors.attempts}
        >
          <Input
            id="limit-attempts"
            type="number"
            min={0}
            inputMode="numeric"
            value={attempts}
            onChange={(event) => setAttempts(event.target.value)}
            aria-invalid={!!errors.attempts || undefined}
            aria-describedby={
              errors.attempts ? "limit-attempts-error" : undefined
            }
            className="tabular h-9"
          />
          <p className="text-xs text-muted-foreground">
            Platform default: {amount("attempts", overview.defaults.attempts)}
          </p>
        </FormField>

        <FormField
          id="limit-cost"
          label="LLM cost per month (USD)"
          error={errors.llm_cost_usd}
        >
          <Input
            id="limit-cost"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={cost}
            onChange={(event) => setCost(event.target.value)}
            aria-invalid={!!errors.llm_cost_usd || undefined}
            aria-describedby={
              errors.llm_cost_usd ? "limit-cost-error" : undefined
            }
            className="tabular h-9"
          />
          <p className="text-xs text-muted-foreground">
            Platform default: {amount("llm_cost", overview.defaults.llm_cost)}
          </p>
        </FormField>

        <FormField
          id="limit-warn"
          label="Warn at (% of a limit)"
          error={errors.warn_percent}
        >
          <Input
            id="limit-warn"
            type="number"
            min={50}
            max={99}
            inputMode="numeric"
            value={warn}
            onChange={(event) => setWarn(event.target.value)}
            aria-invalid={!!errors.warn_percent || undefined}
            aria-describedby={
              errors.warn_percent ? "limit-warn-error" : undefined
            }
            className="tabular h-9 sm:w-28"
          />
          <p className="text-xs text-muted-foreground">{overview.warn_at}</p>
        </FormField>

        <FormField
          id="limit-password"
          label="Confirm with your password"
          error={errors.password}
          announce
        >
          <PasswordInput
            id="limit-password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            invalid={!!errors.password}
          />
        </FormField>

        {consequence && (
          <Alert role="alert">
            <TriangleAlert aria-hidden="true" />
            <AlertDescription>{consequence}</AlertDescription>
          </Alert>
        )}
      </div>

      <SheetFooter className="gap-2 border-t px-6 py-4 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : consequence ? "Confirm" : "Save limits"}
        </Button>
      </SheetFooter>
    </form>
  );
}
