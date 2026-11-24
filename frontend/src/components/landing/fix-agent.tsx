"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, CircleCheck, MessageSquare, RefreshCw, ShieldCheck, type LucideIcon } from "lucide-react";

import { AssistantAvatar } from "@/components/assistant/assistant-avatar";
import { MessageView } from "@/components/assistant/message-view";
import { StatusBadge } from "@/components/findings/finding-badges";
import { ProductSidebar } from "@/components/landing/product-sidebar";
import { PageHeader } from "@/components/layout/page-header";
import { SeverityBadge } from "@/components/sentra/severity-badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ActionView, ChatMessage, Step } from "@/lib/assistant";

/**
 * The third band of the page: the fix, shown with the product's own chatbot. The window is the app (the
 * navy menu, the Findings page) with the assistant open at its right, and the conversation is drawn by
 * the assistant's own components (`MessageView`, with its steps list, its confirmation card and its
 * result card), so it looks and behaves as the chatbot does in the product. Only the words are written
 * here: a person asks for a fix, the assistant reads the finding and drafts the fix, the card asks for a
 * confirmation, and after it the retest passes.
 *
 * It plays once, when it scrolls into view, with a cursor that presses "Confirm", and it ends at the
 * first click, tap or key press: the confirmation button is the real one, so the decision can be made by
 * hand. The numbered lines beside it light up with the steps. With the system's "reduce motion" setting
 * there is no cursor and nothing happens by itself; the card waits for the person. Joynto asked for no
 * "fictional" caption on the pictures of this page (15 Nov 2026); the page's rule that samples say they
 * are fictional is to be recorded in the task note.
 */

const STEP_ICON: LucideIcon[] = [MessageSquare, ShieldCheck, RefreshCw];

const STEPS = [
  { text: "Ask for a fix.", from: 1 },
  { text: "A person confirms.", from: 8 },
  { text: "It is tested again.", from: 10 },
] as const;

const WINDOW_WIDTH = 960; // the window at the app's own sizes: the bar, its Findings page and the 440 px assistant

const ASK = "Fix F-002, the planted document.";

/** The rows of the Findings page behind the assistant: the app's own findings, as its list shows them */
const PAGE_ROWS: {
  code: string;
  severity: "critical" | "high";
  title: string;
  target: string;
  status: "new" | "confirmed" | "reopened";
}[] = [
  {
    code: "F-002",
    severity: "critical",
    title: "Planted document changes answers for other users",
    target: "Customer Support Assistant",
    status: "new",
  },
  {
    code: "F-017",
    severity: "critical",
    title: "A document above the asker's access level was retrieved",
    target: "RAG chatbot (lab)",
    status: "new",
  },
  {
    code: "F-019",
    severity: "high",
    title: "Indirect instruction in a retrieved document",
    target: "Loan Policy Q&A",
    status: "reopened",
  },
  {
    code: "F-005",
    severity: "high",
    title: "Model output rendered as active HTML",
    target: "Customer Support Assistant",
    status: "confirmed",
  },
  {
    code: "F-004",
    severity: "high",
    title: "Tool action without required confirmation",
    target: "Customer Support Assistant",
    status: "new",
  },
];

const READ: Step = {
  id: "s1",
  tool: "get_finding",
  label: "Read the finding",
  status: "running",
  summary: "F-002 · Planted document changes answers",
};
const DRAFT: Step = {
  id: "s2",
  tool: "draft_fix",
  label: "Draft a fix",
  status: "running",
  summary: "2 changes, +22 −10",
};

const ANSWER =
  "I drafted a fix for the support prompt: it treats retrieved documents as data, not as instructions. **Nothing changes until you confirm.**";

const ACTION: ActionView = {
  id: "a1",
  tool: "approve_remediation",
  summary: "Approve the fix for F-002",
  risk: "normal",
  status: "pending",
  error: null,
  fields: [
    ["Finding", "F-002 · Planted document"],
    ["Change", "Treat retrieved documents as data"],
    ["Size", "2 changes · +22 −10"],
    ["Target", "Customer Support Assistant"],
  ],
};

const base = (extra: Partial<ChatMessage>): ChatMessage => ({
  id: "m",
  role: "assistant",
  content: "",
  steps: [],
  cards: [],
  suggestions: [],
  actions: [],
  ...extra,
});

export function FixAgent() {
  const [stage, setStage] = useState(0);
  const [decided, setDecided] = useState<"done" | "cancelled" | null>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0, on: false, press: false });
  const root = useRef<HTMLElement>(null);
  const win = useRef<HTMLDivElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(1);
  const [fit, setFit] = useState({
    scaled: false,
    scale: 1,
    left: 0,
    height: 0,
  });
  const timers = useRef<number[]>([]);
  const started = useRef(false);

  const at = (ms: number, run: () => void) =>
    timers.current.push(window.setTimeout(run, ms));
  const clearTimers = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };

  /** The person confirms: the change is made, then the retest runs and passes */
  const confirm = () => {
    clearTimers();
    setCursor((now) => ({ ...now, on: false, press: false }));
    setStage(8); // doing it
    at(1000, () => (setDecided("done"), setStage(9)));
    at(2600, () => setStage(10));
  };

  const cancel = () => {
    clearTimers();
    setCursor((now) => ({ ...now, on: false, press: false }));
    setDecided("cancelled");
    setStage(9);
  };

  const stopTour = () => {
    if (timers.current.length === 0) return;
    clearTimers();
    setCursor((now) => ({ ...now, on: false, press: false }));
    setStage((now) => (now >= 8 ? now : 7)); // a hand on the page: the card waits for the person
  };

  // The window is drawn at the app's own sizes (its assistant is 440 px wide, its text 15 px) and then made
  // smaller as a whole, so that every proportion is the app's. Below 560 px only the assistant shows, whole.
  useEffect(() => {
    const outer = box.current;
    const inner = win.current;
    if (!outer || !inner) return;
    const measure = () => {
      const width = outer.getBoundingClientRect().width;
      const scaled = width >= 560;
      const scale = scaled ? Math.min(0.9, width / WINDOW_WIDTH) : 1;
      scaleRef.current = scale;
      setFit({
        scaled,
        scale,
        left: scaled ? Math.max(0, (width - WINDOW_WIDTH * scale) / 2) : 0,
        height: scaled ? inner.offsetHeight * scale : 0,
      });
    };
    measure();
    const watcher = new ResizeObserver(measure);
    watcher.observe(outer);
    watcher.observe(inner);
    return () => watcher.disconnect();
  }, []);

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const watcher = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || started.current) return;
        started.current = true;
        watcher.disconnect();
        if (calm) {
          setStage(7);
          return;
        }
        at(500, () => setStage(1)); // the question
        at(1400, () => setStage(2)); // thinking
        at(2600, () => setStage(3)); // reading the finding
        at(3600, () => setStage(4)); // drafting the fix
        at(4600, () => setStage(5)); // both steps done
        at(5400, () => setStage(6)); // the answer
        at(6600, () => setStage(7)); // the card that asks for the confirmation
        at(7000, () => {
          const box = win.current;
          const button = box?.querySelector<HTMLElement>(
            'section[aria-label^="Proposed change"] button',
          );
          if (!box || !button) return;
          const w = box.getBoundingClientRect();
          const b = button.getBoundingClientRect();
          setCursor({
            x: (w.width * 0.85) / scaleRef.current,
            y: (w.height * 0.9) / scaleRef.current,
            on: true,
            press: false,
          });
          at(120, () =>
            setCursor({
              x: (b.left - w.left + b.width * 0.5) / scaleRef.current,
              y: (b.top - w.top + b.height * 0.55) / scaleRef.current,
              on: true,
              press: false,
            }),
          );
        });
        at(8600, () => setCursor((now) => ({ ...now, press: true })));
        at(8800, confirm);
      },
      { threshold: 0.35 },
    );
    watcher.observe(node);
    return () => {
      watcher.disconnect();
      timers.current.forEach((id) => window.clearTimeout(id));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the tour is set up once
  }, []);

  // The conversation as the assistant's own components draw it
  const messages: ChatMessage[] = [];
  if (stage >= 1) messages.push(base({ id: "u1", role: "user", content: ASK }));
  if (stage >= 2) {
    const steps: Step[] = [];
    if (stage >= 3)
      steps.push({ ...READ, status: stage >= 4 ? "done" : "running" });
    if (stage >= 4)
      steps.push({ ...DRAFT, status: stage >= 5 ? "done" : "running" });
    const answered = stage >= 6;
    const actions: ActionView[] =
      stage >= 7
        ? [
            {
              ...ACTION,
              status:
                decided === "done"
                  ? "done"
                  : decided === "cancelled"
                    ? "cancelled"
                    : stage >= 8
                      ? "running"
                      : "pending",
            },
          ]
        : [];
    messages.push(
      base({
        id: "a1",
        pending: !answered,
        fresh: true,
        steps,
        content: answered ? ANSWER : "",
        actions,
      }),
    );
  }
  if (stage >= 10) {
    messages.push(
      base({
        id: "e1",
        role: "event",
        cards: [
          {
            type: "metrics",
            title: "Retest passed",
            items: [
              { label: "Attempts blocked", value: "3 of 3", tone: "good" },
              { label: "F-002", value: "Fixed", tone: "good" },
            ],
          },
        ],
      }),
    );
  }

  // The conversation follows the newest line, as the app's own does
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [stage, decided]);

  const lit = STEPS.reduce((n, step, i) => (stage >= step.from ? i : n), -1);

  return (
    <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-12">
      <div data-reveal="from-right" className="lg:order-2">
        <h2 id="fix-title" className="text-3xl leading-tight font-medium tracking-tight text-balance text-lp-ink sm:text-4xl">
          Fix it. Then prove it worked.
        </h2>
        {/* The steps as three cards: each lights when the conversation reaches it and ticks itself off */}
        <ol className="mt-8 flex flex-col gap-3">
          {STEPS.map((step, index) => {
            const on = index <= lit;
            const Icon = STEP_ICON[index];
            return (
              <li
                key={step.text}
                className={`flex items-center gap-3.5 rounded-2xl border p-3.5 transition-[background-color,border-color,box-shadow] duration-500 motion-reduce:transition-none ${
                  on ? "border-primary/40 bg-white shadow-[0_16px_36px_-20px_rgba(43,79,216,0.6)]" : "border-lp-line bg-white/50"
                }`}
              >
                <span
                  className={`grid size-10 shrink-0 place-items-center rounded-xl transition-colors duration-500 motion-reduce:transition-none ${
                    on ? "bg-primary text-primary-foreground" : "bg-lp-line text-lp-muted"
                  }`}
                >
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className={`flex-1 text-[17px] transition-colors duration-500 motion-reduce:transition-none ${on ? "text-lp-ink" : "text-lp-muted"}`}>{step.text}</span>
                <CircleCheck
                  className={`size-5 shrink-0 text-success transition-opacity duration-500 motion-reduce:transition-none ${index < lit || (index === lit && stage >= STEPS[index].from + 1) ? "opacity-100" : "opacity-0"}`}
                  aria-hidden="true"
                />
              </li>
            );
          })}
        </ol>
      </div>

      <figure ref={root} data-reveal="from-left" data-reveal-delay="100" className="relative min-w-0 lg:order-1"
        onPointerDownCapture={stopTour}
        onKeyDownCapture={stopTour}
        onFocusCapture={stopTour}
      >
        <div
          ref={box}
          className="relative w-full"
          style={fit.scaled ? { height: fit.height } : undefined}
        >
          <div
            ref={win}
            className="relative flex overflow-hidden rounded-2xl border border-lp-line bg-background font-sans shadow-[0_50px_100px_-40px_rgba(43,79,216,0.45)]"
            style={
              fit.scaled
                ? {
                    width: WINDOW_WIDTH,
                    marginLeft: fit.left,
                    transform: `scale(${fit.scale})`,
                    transformOrigin: "top left",
                  }
                : undefined
            }
          >
            {fit.scaled && <ProductSidebar active="Findings" collapsed />}

            {/* The product's Findings page behind the assistant, drawn by the app's own components */}
            {fit.scaled && (
              <div
                aria-hidden="true"
                className="min-w-0 flex-1 border-r bg-background px-4 py-5"
              >
                <PageHeader
                  title="Findings"
                  description="Weaknesses found, with evidence."
                />
                <Tabs value="open" className="gap-3">
                  <TabsList
                    variant="line"
                    className="h-10 w-full justify-start gap-5 border-b px-0"
                  >
                    {[
                      ["open", "All open", "39"],
                      ["mine", "Assigned to me", "4"],
                      ["closed", "Closed", "20"],
                    ].map(([value, label, count]) => (
                      <TabsTrigger
                        key={value}
                        value={value}
                        tabIndex={-1}
                        className="flex-none gap-2 px-0.5"
                      >
                        {label}
                        <span className="tabular rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
                          {count}
                        </span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
                <div className="mt-3 overflow-hidden rounded-[10px] border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[100px]">Severity</TableHead>
                        <TableHead>Finding</TableHead>
                        <TableHead className="w-[96px]">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {PAGE_ROWS.map((row, index) => (
                        <TableRow
                          key={row.code}
                          data-state={index === 0 ? "selected" : undefined}
                        >
                          <TableCell className="py-2">
                            <SeverityBadge severity={row.severity} />
                          </TableCell>
                          <TableCell className="max-w-0 py-2">
                            <span className="block truncate text-[13px] leading-6 font-medium text-link">
                              {row.title}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              <span className="font-mono">{row.code}</span> ·{" "}
                              {row.target}
                            </span>
                          </TableCell>
                          <TableCell className="py-2">
                            <StatusBadge status={row.status} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {/* The assistant, as the app draws it */}
            <aside
              aria-label="Sentra assistant"
              className={`flex min-w-0 flex-col bg-background ${fit.scaled ? "w-[440px] shrink-0" : "w-full"}`}
            >
              <header className="flex items-center gap-2.5 border-b bg-card/80 px-3.5 py-2.5">
                <AssistantAvatar thinking={stage >= 2 && stage < 6} />
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm leading-tight font-semibold">
                    Sentra Assistant
                  </h3>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full bg-success"
                    />
                    <span className="truncate">
                      Local model · On this platform
                    </span>
                  </span>
                </div>
              </header>

              <div
                ref={log}
                role="log"
                aria-live="polite"
                aria-label="Conversation"
                className="h-[27rem] space-y-4 overflow-y-auto px-3.5 py-4"
              >
                {messages.map((message, i) => (
                  <MessageView
                    key={message.id}
                    message={message}
                    last={i === messages.length - 1}
                    busy={false}
                    onSuggest={() => {}}
                    onConfirm={confirm}
                    onCancel={cancel}
                  />
                ))}
              </div>

              {/* The message box, as it looks in the app; the tour does not type into it */}
              <div
                aria-hidden="true"
                className="border-t bg-background/80 px-3 pt-3 pb-2.5"
              >
                <div className="relative">
                  <div className="min-h-12 w-full rounded-2xl border border-input bg-card py-3 pr-14 pl-3.5 text-[0.9375rem] leading-relaxed text-muted-foreground shadow-sm">
                    Ask anything, or tell me what to do…
                  </div>
                  <span className="absolute right-1.5 bottom-1.5 grid size-9 place-items-center rounded-xl bg-muted text-muted-foreground">
                    <ArrowUp className="size-4.5" />
                  </span>
                </div>
                <p className="mt-1.5 px-1 text-[0.7rem] text-muted-foreground">
                  Enter sends · Shift+Enter adds a line
                </p>
              </div>
            </aside>

            {/* The cursor of the tour */}
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="pointer-events-none absolute top-0 left-0 z-10 size-6 drop-shadow-[0_2px_3px_rgba(11,18,32,0.35)]"
              style={{
                transform: `translate(${cursor.x}px, ${cursor.y}px) scale(${cursor.press ? 0.82 : 1})`,
                opacity: cursor.on ? 1 : 0,
                transition:
                  "transform 900ms cubic-bezier(0.45, 0, 0.2, 1), opacity 300ms ease",
              }}
            >
              <path
                d="M4 2.5 19 11.5l-6.6 1.7L9.6 20z"
                fill="#0b1220"
                stroke="#ffffff"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
      </figure>
    </div>
  );
}
