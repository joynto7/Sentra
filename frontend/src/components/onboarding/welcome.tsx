"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Plus, X } from "lucide-react";

import {
  type Can,
  GOALS,
  STEP_LABEL,
  type StepId,
  defaultTask,
  destination,
  resumeAt,
  stepsFor,
  tasksFor,
} from "@/components/onboarding/model";
import {
  Collapse,
  DoneMark,
  DrawnCheck,
  Reveal,
} from "@/components/onboarding/motion";
import { SentraLogo } from "@/components/layout/sentra-logo";
import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { invite } from "@/lib/members";
import {
  type OnboardingAnswers,
  completeOnboarding,
  getOnboarding,
  saveOnboarding,
  skipOnboarding,
} from "@/lib/onboarding";
import { type RoleInfo, loadRoles, useCan } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const HINT: Record<string, string> = {
  register_target: "Name, address, then an ownership check.",
  lab: "A target made for practice. Nothing real is touched.",
  campaign: "Pick a target and what to test.",
  review: "Campaigns and fixes waiting for a decision.",
  invite: "By e-mail, with a role each.",
};

type Row = {
  id: number;
  email: string;
  role: string;
  error?: string;
  sent?: boolean;
};

/** A choice shown as a card: a real radio button underneath, so it works with the keyboard and a screen reader. */
function Choice({
  name,
  value,
  checked,
  onChange,
  children,
  index = 0,
  hint,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
  index?: number;
  hint?: string;
}) {
  return (
    <label
      style={{ "--i": index + 1 } as React.CSSProperties}
      className={cn(
        "welcome-rise block cursor-pointer rounded-[10px] border bg-card px-4 py-3.5 text-[15px] transition-colors motion-reduce:transition-none",
        "hover:border-primary/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
        checked && "border-primary bg-primary/5",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <span className="flex items-center justify-between gap-3">
        <span className="font-medium">{children}</span>
        <span
          aria-hidden="true"
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full border",
            checked
              ? "welcome-pop border-primary bg-primary text-primary-foreground"
              : "border-border-strong",
          )}
        >
          {checked && <DrawnCheck size={12} />}
        </span>
      </span>
      {hint && (
        <Collapse open={checked}>
          <span className="block pt-1.5 text-[13px] font-normal text-muted-foreground">
            {hint}
          </span>
        </Collapse>
      )}
    </label>
  );
}

/**
 * The first-run setup, shown once after the first log in to an organization: a few questions, one at
 * a time, and a first task to start with. Every step can be left (Skip), nothing is asked that the
 * product does not use right away, and the rest is asked later, one question at a time, on the
 * dashboard. The server keeps the step reached, so a refresh or a return carries on where it stopped.
 */
export function Welcome() {
  const router = useRouter();
  const session = useSession();
  const manageTargets = useCan("manage_targets");
  const lab = useCan("use_security_lab");
  const campaigns = useCan("manage_campaigns");
  const approve = useCan("approve_campaign_scope");
  const members = useCan("manage_members");
  const loadedCan = [manageTargets, lab, campaigns, approve, members].every(
    (one) => one !== undefined,
  );
  const can: Can = {
    manageTargets: !!manageTargets,
    lab: !!lab,
    campaigns: !!campaigns,
    approve: !!approve,
    members: !!members,
  };
  const steps = stepsFor(can);
  const tasks = tasksFor(can);

  const [saved, setSaved] = useState<{
    step: number;
    answers: OnboardingAnswers;
  } | null>(null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<OnboardingAnswers>({});
  const [rows, setRows] = useState<Row[]>([{ id: 0, email: "", role: "" }]);
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [dir, setDir] = useState<"forward" | "back">("forward");
  const [leaving, setLeaving] = useState<number[]>([]);
  const [problem, setProblem] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const started = useRef(false);
  const nextId = useRef(1);

  useEffect(() => {
    const controller = new AbortController();
    getOnboarding(controller.signal)
      .then((found) => {
        if (found.done) {
          router.replace("/dashboard");
          return;
        }
        setSaved({ step: found.step, answers: found.answers });
      })
      .catch(() => !controller.signal.aborted && router.replace("/dashboard"));
    loadRoles()
      .then(setRoles)
      .catch(() => undefined);
    return () => controller.abort();
  }, [router]);

  // Open where the person stopped, once the role's steps are known
  useEffect(() => {
    if (!saved || !loadedCan || started.current) return;
    started.current = true;
    setAnswers(saved.answers);
    setStep(resumeAt(saved.step, steps));
  }, [saved, loadedCan, steps]);

  // The keyboard and a screen reader follow the step
  useEffect(() => {
    if (started.current) heading.current?.focus();
  }, [step]);

  const invitable = roles.filter((role) => role.role !== "platform_admin");
  const current: StepId | undefined = steps[step];
  const taskChoice = answers.first_task ?? defaultTask(answers.goal, tasks);
  const first = session.name.split(" ")[0];
  const typed = rows.filter((row) => row.email.trim());

  async function leave(path: string, finish: () => Promise<unknown>) {
    setBusy(true);
    setProblem("");
    try {
      await finish();
      router.replace(path);
    } catch {
      setProblem("That did not save. Try again.");
      setBusy(false);
    }
  }

  function go(to: number) {
    setDir(to < step ? "back" : "forward");
    setStep(to);
  }

  async function next() {
    if (!current || busy) return;
    setProblem("");
    setBusy(true);
    try {
      const to = step + 1;
      let chosen = answers;
      if (current === "task") chosen = { ...answers, first_task: taskChoice };
      if (current === "team" && typed.length) {
        const sent = await Promise.all(
          rows.map(async (row) => {
            if (!row.email.trim() || row.sent) return row;
            if (!ADDRESS.test(row.email.trim()))
              return { ...row, error: "Check this address." };
            try {
              await invite(
                row.email.trim(),
                row.role || invitable[0]?.role || "security_analyst",
              );
              return { ...row, sent: true, error: undefined };
            } catch (error) {
              return {
                ...row,
                error: error instanceof ApiError ? error.message : "Not sent.",
              };
            }
          }),
        );
        setRows(sent);
        if (sent.some((row) => row.error)) {
          setBusy(false);
          return;
        }
      }
      const saving = await saveOnboarding({ step: to, answers: chosen });
      setAnswers(saving.answers);
      go(to);
    } catch {
      setProblem("That did not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!saved || !loadedCan || !current) {
    return (
      <div
        className="grid min-h-screen place-items-center bg-background"
        role="status"
        aria-label="Loading"
      >
        <Skeleton className="h-40 w-full max-w-xl" />
      </div>
    );
  }

  const last = current === "done";
  const taskLabel = tasks.find((task) => task.id === answers.first_task)?.label;

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="hidden flex-col border-r bg-card px-8 py-8 lg:flex">
        <span className="flex items-center gap-2.5">
          <SentraLogo />
          <span className="text-[17px] font-semibold tracking-tight">
            Sentra
          </span>
        </span>
        <p className="mt-10 truncate text-sm text-muted-foreground">
          {session.organization?.name}
        </p>
        <ol className="mt-3 space-y-1" aria-label="Steps">
          {steps.map((id, index) => {
            const doneStep = index < step;
            const here = index === step;
            return (
              <li key={id}>
                <button
                  type="button"
                  disabled={!doneStep || busy}
                  onClick={() => go(index)}
                  aria-current={here ? "step" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    here
                      ? "font-semibold text-foreground"
                      : doneStep
                        ? "text-foreground hover:bg-muted"
                        : "text-muted-foreground",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs",
                      doneStep
                        ? "border-success bg-success text-white"
                        : here
                          ? "border-primary text-primary"
                          : "border-border",
                    )}
                  >
                    {doneStep ? <DrawnCheck size={14} /> : index + 1}
                  </span>
                  {STEP_LABEL[id]}
                  <span className="sr-only">
                    {doneStep ? ", done" : here ? ", now" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-col">
        <header className="flex items-center justify-between gap-3 px-6 py-5">
          <span
            className="text-sm text-muted-foreground lg:invisible"
            aria-live="polite"
          >
            {step + 1} / {steps.length}
          </span>
          {!last && (
            <Button
              type="button"
              variant="ghost"
              className="h-9 text-muted-foreground"
              disabled={busy}
              onClick={() => void leave("/dashboard", skipOnboarding)}
            >
              Skip setup
            </Button>
          )}
        </header>

        <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 pb-10">
          <div key={current} data-dir={dir} className="welcome-step">
            {current === "goal" && (
              <section aria-labelledby="step-title">
                <p
                  className="welcome-rise mb-2 text-sm text-muted-foreground"
                  style={{ "--i": 0 } as React.CSSProperties}
                >
                  Welcome, {first}
                </p>
                <h1
                  id="step-title"
                  ref={heading}
                  tabIndex={-1}
                  className="welcome-rise text-2xl font-semibold tracking-tight outline-none"
                  style={{ "--i": 0 } as React.CSSProperties}
                >
                  What do you want to do?
                </h1>
                <div
                  role="radiogroup"
                  aria-labelledby="step-title"
                  className="mt-6 space-y-2.5"
                >
                  {GOALS.map((goal, i) => (
                    <Choice
                      key={goal.id}
                      index={i}
                      name="goal"
                      value={goal.id}
                      checked={answers.goal === goal.id}
                      onChange={() =>
                        setAnswers((now) => ({ ...now, goal: goal.id }))
                      }
                    >
                      {goal.label}
                    </Choice>
                  ))}
                </div>
              </section>
            )}

            {current === "task" && (
              <section aria-labelledby="step-title">
                <h1
                  id="step-title"
                  ref={heading}
                  tabIndex={-1}
                  className="welcome-rise text-2xl font-semibold tracking-tight outline-none"
                  style={{ "--i": 0 } as React.CSSProperties}
                >
                  Where do you start?
                </h1>
                <div
                  role="radiogroup"
                  aria-labelledby="step-title"
                  className="mt-6 space-y-2.5"
                >
                  {tasks.map((task, i) => (
                    <Choice
                      key={task.id}
                      index={i}
                      hint={HINT[task.id]}
                      name="task"
                      value={task.id}
                      checked={taskChoice === task.id}
                      onChange={() =>
                        setAnswers((now) => ({ ...now, first_task: task.id }))
                      }
                    >
                      {task.label}
                    </Choice>
                  ))}
                </div>
              </section>
            )}

            {current === "team" && (
              <section aria-labelledby="step-title">
                <h1
                  id="step-title"
                  ref={heading}
                  tabIndex={-1}
                  className="welcome-rise text-2xl font-semibold tracking-tight outline-none"
                  style={{ "--i": 0 } as React.CSSProperties}
                >
                  Invite your team
                </h1>
                <ul className="mt-6 space-y-3">
                  {rows.map((row, index) => (
                    <li key={row.id}>
                      <Reveal leaving={leaving.includes(row.id)}>
                        <div className="grid gap-2 pb-3 sm:grid-cols-[minmax(0,1fr)_190px_auto]">
                          <div>
                            <Label
                              htmlFor={`invite-${index}`}
                              className="sr-only"
                            >
                              E-mail address {index + 1}
                            </Label>
                            <Input
                              id={`invite-${index}`}
                              type="email"
                              autoComplete="off"
                              placeholder="name@company.com"
                              value={row.email}
                              disabled={row.sent}
                              aria-invalid={row.error ? true : undefined}
                              aria-describedby={
                                row.error ? `invite-${index}-error` : undefined
                              }
                              onChange={(event) =>
                                setRows((now) =>
                                  now.map((one, i) =>
                                    i === index
                                      ? {
                                          ...one,
                                          email: event.target.value,
                                          error: undefined,
                                        }
                                      : one,
                                  ),
                                )
                              }
                              className="h-10"
                            />
                            {row.error && (
                              <p
                                id={`invite-${index}-error`}
                                role="alert"
                                className="mt-1 text-[13px] text-destructive"
                              >
                                {row.error}
                              </p>
                            )}
                            {row.sent && (
                              <p className="mt-1 text-[13px] text-muted-foreground">
                                Sent
                              </p>
                            )}
                          </div>
                          <div>
                            <Label
                              htmlFor={`role-${index}`}
                              className="sr-only"
                            >
                              Role {index + 1}
                            </Label>
                            <Select
                              value={row.role || invitable[0]?.role || ""}
                              onValueChange={(value) =>
                                setRows((now) =>
                                  now.map((one, i) =>
                                    i === index ? { ...one, role: value } : one,
                                  ),
                                )
                              }
                              disabled={row.sent}
                            >
                              <SelectTrigger
                                id={`role-${index}`}
                                className="h-10 w-full data-[size=default]:h-10"
                              >
                                <SelectValue placeholder="Role" />
                              </SelectTrigger>
                              <SelectContent>
                                {invitable.map((role) => (
                                  <SelectItem key={role.role} value={role.role}>
                                    {role.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          {rows.length > 1 && !row.sent && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-10"
                              aria-label={`Remove e-mail address ${index + 1}`}
                              onClick={() => {
                                setLeaving((now) => [...now, row.id]);
                                setTimeout(() => {
                                  setRows((now) =>
                                    now.filter((one) => one.id !== row.id),
                                  );
                                  setLeaving((now) =>
                                    now.filter((id) => id !== row.id),
                                  );
                                }, 280);
                              }}
                            >
                              <X aria-hidden="true" />
                            </Button>
                          )}
                        </div>
                      </Reveal>
                    </li>
                  ))}
                </ul>
                {rows.length < 5 && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="mt-2 h-9 px-1 text-link"
                    onClick={() =>
                      setRows((now) => [
                        ...now,
                        { id: nextId.current++, email: "", role: "" },
                      ])
                    }
                  >
                    <Plus aria-hidden="true" />
                    Add another
                  </Button>
                )}
              </section>
            )}

            {current === "done" && (
              <section aria-labelledby="step-title">
                <DoneMark />
                <h1
                  id="step-title"
                  ref={heading}
                  tabIndex={-1}
                  className="welcome-rise text-2xl font-semibold tracking-tight outline-none"
                  style={{ "--i": 3 } as React.CSSProperties}
                >
                  You&apos;re set
                </h1>
                {taskLabel && answers.first_task !== "explore" && (
                  <p
                    className="welcome-rise mt-2 text-muted-foreground"
                    style={{ "--i": 4 } as React.CSSProperties}
                  >
                    Next: {taskLabel}
                  </p>
                )}
              </section>
            )}
          </div>

          {problem && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {problem}
            </p>
          )}
        </main>

        <footer className="flex items-center justify-between gap-3 border-t px-6 py-4">
          {step > 0 && !last ? (
            <Button
              type="button"
              variant="ghost"
              className="h-10"
              disabled={busy}
              onClick={() => go(step - 1)}
            >
              <ArrowLeft aria-hidden="true" />
              Back
            </Button>
          ) : (
            <span />
          )}
          {last ? (
            <span className="flex flex-wrap items-center justify-end gap-2">
              {answers.first_task && answers.first_task !== "explore" && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10"
                  disabled={busy}
                  onClick={() => void leave("/dashboard", completeOnboarding)}
                >
                  Dashboard
                </Button>
              )}
              <Button
                type="button"
                className="h-10 hover:bg-primary-hover"
                disabled={busy}
                onClick={() =>
                  void leave(
                    destination(answers.first_task, tasks),
                    completeOnboarding,
                  )
                }
              >
                {answers.first_task && answers.first_task !== "explore"
                  ? "Continue"
                  : "Open dashboard"}
                <ArrowRight aria-hidden="true" />
              </Button>
            </span>
          ) : (
            <Button
              type="button"
              className="h-10 hover:bg-primary-hover"
              disabled={busy || (current === "goal" && !answers.goal)}
              onClick={() => void next()}
            >
              {current === "team" && !typed.length
                ? "Skip"
                : current === "team"
                  ? "Send"
                  : "Next"}
              <ArrowRight aria-hidden="true" />
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}
