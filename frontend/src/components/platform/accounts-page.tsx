"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { ChevronLeft, ChevronRight, CircleCheck, CirclePause, Search, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { EmptyState } from "@/components/layout/empty-state"
import { AccountPanel } from "@/components/platform/account-panel"
import { useSession } from "@/components/session-provider"
import { FilterSelect } from "@/components/sentra/filter-select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { lastSeen } from "@/lib/members"
import { ACCOUNTS_PAGE_SIZE, type Account, type AccountPage, listAccounts } from "@/lib/platform"
import { initials } from "@/lib/session"
import { cn } from "@/lib/utils"

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" })

function TwoStep({ on }: { on: boolean }) {
  return on ? (
    <span>On</span>
  ) : (
    <span className="inline-flex items-center gap-1 font-medium text-warning">
      <TriangleAlert className="size-3.5" aria-hidden="true" />
      Off
    </span>
  )
}

/** "7 Oct", with a warning when the newest login came from an address the account hadn't used
 * in the 30 days before (there is no location database, so it says "new address"). */
function LastLogin({ account }: { account: Account }) {
  return (
    <span>
      {lastSeen(account.last_login_at)}
      {account.last_login_new_address && (
        <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-warning">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          from a new address
        </span>
      )}
    </span>
  )
}

function Status({ account }: { account: Account }) {
  if (account.status === "active") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <CircleCheck className="size-4 text-success" aria-hidden="true" />
        Active
      </span>
    )
  }
  const when = account.suspended_at ? ` on ${DAY.format(new Date(account.suspended_at))}` : ""
  const why = account.suspension_reason ? ` Reason: ${account.suspension_reason}` : ""
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex min-h-6 items-center gap-1.5 rounded-sm text-warning underline decoration-dashed underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <CirclePause className="size-4" aria-hidden="true" />
          Suspended
          <span className="sr-only">
            {when}.{why}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">
        Suspended in every organization{when}.{why}
      </TooltipContent>
    </Tooltip>
  )
}

function Organizations({ account }: { account: Account }) {
  if (!account.organizations.length) return <span className="text-muted-foreground">None</span>
  return (
    <span>
      <span className="tabular font-medium">{account.organizations.length}</span>{" "}
      <span className="text-muted-foreground">({account.organizations.map((o) => o.name).join(", ")})</span>
    </span>
  )
}

/** Screen 64: every Sentra account, for security and support (UC-10.2, 1a). Only account data is
 * shown, never an organization's content (NFR-3.3). */
export function AccountsPage({ initialSearch }: { initialSearch: string }) {
  const pathname = usePathname()
  const me = useSession()
  const [search, setSearch] = useState(initialSearch)
  const [applied, setApplied] = useState(initialSearch)
  const [status, setStatus] = useState("")
  const [page, setPage] = useState(1)
  // The answer is kept with the request it belongs to (see the audit log page).
  const [answer, setAnswer] = useState<{ key: string; page: AccountPage } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)
  const [panel, setPanel] = useState<Account | null>(null)

  const key = JSON.stringify([applied, status, page, reloads])
  useEffect(() => {
    let current = true
    listAccounts(applied, status, page)
      .then((found) => current && setAnswer({ key, page: found }))
      .catch(() => current && setFailed(key))
    return () => {
      current = false
    }
  }, [applied, status, page, key])

  const data = answer?.page ?? null
  const error = failed === key
  const loading = !!answer && answer.key !== key && !error
  const load = () => {
    setFailed(null)
    setReloads((n) => n + 1)
  }
  useEffect(() => {
    const value = search.trim()
    if (value === applied) return
    const timer = setTimeout(() => {
      setApplied(value)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search, applied])
  useEffect(() => {
    const query = applied ? `?q=${encodeURIComponent(applied)}` : ""
    window.history.replaceState(window.history.state, "", `${pathname}${query}`)
  }, [pathname, applied])

  const pages = data ? Math.max(1, Math.ceil(data.total / ACCOUNTS_PAGE_SIZE)) : 1

  return (
    <div className="min-w-0">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every Sentra account, for security and support. Organization content is never shown.
        </p>
      </div>

      {error && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <AlertDescription className="flex items-center justify-between gap-4">
            The accounts could not be loaded.
            <Button variant="outline" size="sm" onClick={load}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <section aria-label="Accounts" className="@container rounded-[10px] border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <label className="relative block w-full sm:w-72">
            <span className="sr-only">Search by name or e-mail</span>
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={search}
              maxLength={200}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or e-mail"
              className="h-9 w-full rounded-[7px] border border-input bg-card pr-3 pl-8 text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
          </label>
          <FilterSelect
            label="Status"
            value={status}
            onChange={(v) => {
              setStatus(v)
              setPage(1)
            }}
            options={[
              { value: "active", label: "Active" },
              { value: "suspended", label: "Suspended" },
            ]}
          />
          <span className="tabular ml-auto text-sm text-muted-foreground" aria-live="polite">
            {data ? `${data.total.toLocaleString("en-GB")} ${data.total === 1 ? "account" : "accounts"}` : ""}
          </span>
        </div>

        {!data && !error && (
          <div className="space-y-2 p-4" role="status" aria-label="Loading accounts">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        )}

        {data && data.items.length === 0 && (
          <div className="p-4">
            <EmptyState
              title="No accounts match"
              description="Change the search or the status filter."
              action={
                <Button
                  variant="outline"
                  className="h-9"
                  onClick={() => {
                    setSearch("")
                    setApplied("")
                    setStatus("")
                    setPage(1)
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          </div>
        )}

        {data && data.items.length > 0 && (
          <div aria-busy={loading} className={cn("transition-opacity", loading && "opacity-60")}>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted">
                  <TableRow>
                    <TableHead className="text-xs">Account</TableHead>
                    <TableHead className="hidden text-xs @3xl:table-cell">Organizations</TableHead>
                    <TableHead className="hidden text-xs @2xl:table-cell">Two-step verification</TableHead>
                    <TableHead className="hidden text-xs @xl:table-cell">Last login</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-right text-xs">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((account) => {
                    const mine = account.id === me.id
                    return (
                      <TableRow key={account.id}>
                        <TableCell className="py-2.5">
                          <div className="flex items-center gap-3">
                            <Avatar className="size-8">
                              <AvatarFallback className="text-xs font-medium">{initials(account.name)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
                                {account.name}
                                {mine && (
                                  <Badge variant="secondary" className="font-normal">
                                    You
                                  </Badge>
                                )}
                                {account.platform_admin && (
                                  <Badge variant="outline" className="font-normal">
                                    Platform Administrator
                                  </Badge>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground">{account.email}</div>
                              {/* The columns that don't fit, under the account */}
                              <div className="text-xs whitespace-normal text-muted-foreground @3xl:hidden">
                                Organizations: <Organizations account={account} />
                                <span className="@2xl:hidden">
                                  {" "}
                                  · Two-step verification: <TwoStep on={account.mfa_enabled} />
                                </span>
                                <span className="@xl:hidden">
                                  {" "}
                                  · Last login: <LastLogin account={account} />
                                </span>
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden text-[13px] whitespace-normal @3xl:table-cell">
                          <Organizations account={account} />
                        </TableCell>
                        <TableCell className="hidden text-[13px] @2xl:table-cell">
                          <TwoStep on={account.mfa_enabled} />
                        </TableCell>
                        <TableCell className="tabular hidden text-[13px] @xl:table-cell">
                          <LastLogin account={account} />
                        </TableCell>
                        <TableCell className="text-[13px]">
                          <Status account={account} />
                        </TableCell>
                        <TableCell className="text-right">
                          {!mine &&
                            (account.status === "active" ? (
                              <Button variant="outline" size="sm" className="h-8" onClick={() => setPanel(account)} aria-label={`Suspend the account of ${account.name}`}>
                                Suspend
                              </Button>
                            ) : (
                              <Button variant="outline" size="sm" className="h-8" onClick={() => setPanel(account)} aria-label={`Reactivate the account of ${account.name}`}>
                                Reactivate
                              </Button>
                            ))}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <nav aria-label="Pages" className="flex items-center justify-end gap-3 border-t px-4 py-2.5 text-sm">
              <span className="tabular text-muted-foreground">
                Page {page} of {pages}
              </span>
              <Button variant="outline" size="icon" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button variant="outline" size="icon" aria-label="Next page" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight aria-hidden="true" />
              </Button>
            </nav>
          </div>
        )}
      </section>

      <AccountPanel
        account={panel}
        onClose={() => setPanel(null)}
        onDone={(account, action) => {
          if (action === "suspended") {
            toast.success(`${account.name}'s account is suspended`, {
              description: `Logged out of ${account.organizations.length === 1 ? "1 organization" : `${account.organizations.length} organizations`} at once.`,
            })
          } else {
            toast.success(`${account.name}'s account is active again`, { description: "They can log in again." })
          }
          load()
        }}
      />
    </div>
  )
}
