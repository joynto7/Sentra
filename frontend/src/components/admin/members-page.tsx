"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  CirclePause,
  CirclePlay,
  MoreHorizontal,
  Search,
  ShieldCheck,
  TriangleAlert,
  UserCog,
  UserPlus,
  UserRoundX,
} from "lucide-react"
import { toast } from "sonner"

import { AdminNav } from "@/components/admin/admin-nav"
import { ChangeRoleDialog } from "@/components/admin/change-role-dialog"
import { InviteDialog } from "@/components/admin/invite-dialog"
import { ReactivateMemberDialog } from "@/components/admin/reactivate-member-dialog"
import { RemoveMemberDialog } from "@/components/admin/remove-member-dialog"
import { RolesDialog } from "@/components/admin/roles-dialog"
import { SuspendMemberDialog } from "@/components/admin/suspend-member-dialog"
import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { useSession } from "@/components/session-provider"
import { FilterSelect } from "@/components/sentra/filter-select"
import { SortHeader, type SortDirection } from "@/components/sentra/sort-header"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useUrlState } from "@/hooks/use-url-state"
import { ApiError } from "@/lib/api"
import {
  type Invitation,
  type Member,
  expiresIn,
  lastSeen,
  listInvitations,
  listMembers,
  resendInvitation,
  revokeInvitation,
} from "@/lib/members"
import { type RoleInfo, loadRoles, useCan } from "@/lib/permissions"
import { initials } from "@/lib/session"

const PAGE_SIZE = 20
type SortKey = "name" | "role" | "last_login"
const SORT_KEYS: SortKey[] = ["name", "role", "last_login"]
// A column's first direction when it is chosen: names A to Z, the latest login first
const FIRST_DIRECTION: Record<SortKey, SortDirection> = { name: "asc", role: "asc", last_login: "desc" }

/** The members in the chosen order; a member who never logged in comes last either way. */
function ordered(members: Member[], sort: SortKey, direction: SortDirection): Member[] {
  const byName = [...members].sort((a, b) => a.name.localeCompare(b.name))
  if (sort === "name") return direction === "asc" ? byName : byName.reverse()
  if (sort === "role") {
    return byName.sort((a, b) => a.role_label.localeCompare(b.role_label) * (direction === "asc" ? 1 : -1))
  }
  const time = (m: Member) => (m.last_login_at ? Date.parse(m.last_login_at) : null)
  const known = byName.filter((m) => time(m) !== null)
  known.sort((a, b) => (time(a)! - time(b)!) * (direction === "asc" ? 1 : -1))
  return [...known, ...byName.filter((m) => time(m) === null)]
}
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" })

/** Two-step verification of a member (FR-1.2): "Off" carries a warning, so it is easy to spot. */
function TwoStep({ on }: { on: boolean }) {
  return on ? (
    <span className="inline-flex items-center gap-1">
      <ShieldCheck className="size-3.5 text-success" aria-hidden="true" />
      On
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 font-medium text-warning">
      <TriangleAlert className="size-3.5" aria-hidden="true" />
      Off
    </span>
  )
}

/** A member's status as icon and text (FR-10.1); a suspension says who, when and why. */
function MemberStatus({ member }: { member: Member }) {
  if (member.status !== "suspended") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <CircleCheck className="size-4 text-success" aria-hidden="true" />
        Active
      </span>
    )
  }
  const by = member.suspended_by ? ` by ${member.suspended_by}` : ""
  const when = member.suspended_at ? ` on ${DAY.format(new Date(member.suspended_at))}` : ""
  const why = member.suspension_reason ? ` Reason: ${member.suspension_reason}` : ""
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex min-h-6 items-center gap-1.5 rounded-sm text-warning underline decoration-dashed underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <CirclePause className="size-4" aria-hidden="true" />
          Suspended
          <span className="sr-only">
            {by}
            {when}.{why}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">
        Suspended{by}
        {when}.{why}
      </TooltipContent>
    </Tooltip>
  )
}

/** Screen 12: the members of the organization and the pending invitations (FR-1.5, FR-1.6), with
 * each member's status (FR-10.1) and two-step verification (FR-1.2). */
export function MembersPage() {
  // When the address changes without the list (the menu's link, Back or Forward), the list starts
  // again from the new address, as if the page had just been opened
  const [opened, setOpened] = useState(0)
  return <MembersFromAddress key={opened} onOutside={() => setOpened((count) => count + 1)} />
}

function MembersFromAddress({ onOutside }: { onOutside: () => void }) {
  usePageCrumbs([{ label: "Members" }])
  // The list starts as its address says: a reload, Back, a link somebody shared. "View members" on
  // Organization Security opens the members without two-step verification (mfa), and the audit log
  // opens one member (q) or the pending invitations (tab).
  const query = useSearchParams()
  const initialMfa = query.get("mfa") === "on" || query.get("mfa") === "off" ? (query.get("mfa") as string) : ""
  const initialSearch = (query.get("q") ?? "").slice(0, 200)
  const initialTab = query.get("tab") === "invitations" ? "invitations" : "members"
  const organization = useSession().organization
  const canManage = useCan("manage_members")
  const [members, setMembers] = useState<Member[] | null>(null)
  const [invitations, setInvitations] = useState<Invitation[] | null>(null)
  const [roles, setRoles] = useState<RoleInfo[]>([])
  const [error, setError] = useState(false)
  const [tab, setTab] = useState(initialTab)
  const [search, setSearch] = useState(initialSearch)
  const [role, setRole] = useState(query.get("role") ?? "")
  const [status, setStatus] = useState(query.get("status") === "suspended" ? "suspended" : query.get("status") === "active" ? "active" : "")
  const [mfa, setMfa] = useState(initialMfa)
  const askedSort = query.get("sort") as SortKey | null
  const [sort, setSort] = useState<SortKey>(askedSort && SORT_KEYS.includes(askedSort) ? askedSort : "name")
  const [direction, setDirection] = useState<SortDirection>(() => {
    const value = query.get("direction")
    return value === "asc" || value === "desc" ? value : FIRST_DIRECTION[sort]
  })
  const [page, setPage] = useState(() => Math.max(1, Number(query.get("page")) || 1))
  // Everything but the search words goes in the address: what people search for stays out of the
  // browser's history, as on the Findings list
  useUrlState(
    { tab, role, status, mfa, sort, direction, page: String(page) },
    { tab: "members", sort: "name", direction: FIRST_DIRECTION[sort], page: "1" },
    onOutside,
  )
  const [inviting, setInviting] = useState(false)
  const [showRoles, setShowRoles] = useState(false)
  const [changing, setChanging] = useState<Member | null>(null)
  const [removing, setRemoving] = useState<Member | null>(null)
  const [suspending, setSuspending] = useState<Member | null>(null)
  const [reactivating, setReactivating] = useState<Member | null>(null)
  const [revoking, setRevoking] = useState<Invitation | null>(null)

  const load = useCallback(() => {
    Promise.all([listMembers(), listInvitations()])
      .then(([m, i]) => {
        setMembers(m)
        setInvitations(i)
        setError(false)
      })
      .catch(() => setError(true))
  }, [])

  useEffect(() => {
    if (canManage) load()
  }, [canManage, load])
  useEffect(() => {
    loadRoles().then(setRoles).catch(() => undefined)
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (members ?? []).filter(
      (m) =>
        (!role || m.role === role) &&
        (!status || m.status === status) &&
        (!mfa || m.mfa_enabled === (mfa === "on")) &&
        (!q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)),
    )
  }, [members, search, role, status, mfa])
  const sorted = useMemo(() => ordered(filtered, sort, direction), [filtered, sort, direction])
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  // An old link to a page beyond the last one shows the last page
  const current = Math.min(page, pages)
  const shown = sorted.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  function sortBy(column: SortKey) {
    if (column === sort) setDirection((now) => (now === "asc" ? "desc" : "asc"))
    else {
      setSort(column)
      setDirection(FIRST_DIRECTION[column])
    }
    setPage(1)
  }
  const sortProps = { sort, direction, onSort: sortBy }
  // Only active administrators count: a suspended one can't administer (FR-10.1).
  const admins = (members ?? []).filter((m) => m.role === "org_admin" && m.status !== "suspended").length

  if (canManage === false) {
    return (
      <EmptyState
        title="Only Organization Administrators manage members"
        description="Ask an Organization Administrator of your organization to invite people or change roles."
      />
    )
  }

  async function resend(invitation: Invitation) {
    try {
      await resendInvitation(invitation.id)
      toast.success(`Invitation sent again to ${invitation.email}`, { description: "The old link no longer works." })
      load()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "The invitation could not be sent. Try again.")
    }
  }

  async function revoke() {
    if (!revoking) return
    try {
      await revokeInvitation(revoking.id)
      toast.success(`Invitation to ${revoking.email} revoked`, { description: "The link stopped working." })
      setRevoking(null)
      load()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "The invitation could not be revoked. Try again.")
    }
  }

  const membersPanel = (
    <section aria-label="Members" className="@container rounded-[10px] border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <label className="relative block w-full sm:w-72">
          <span className="sr-only">Search by name or e-mail</span>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            placeholder="Search by name or e-mail"
            className="h-9 w-full rounded-[7px] border border-input bg-card pr-3 pl-8 text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        </label>
        <FilterSelect
          label="Role"
          value={role}
          onChange={(v) => {
            setRole(v)
            setPage(1)
          }}
          options={roles.map((r) => ({ value: r.role, label: r.label }))}
        />
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
        <FilterSelect
          label="Two-step verification"
          value={mfa}
          onChange={(v) => {
            setMfa(v)
            setPage(1)
          }}
          options={[
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
        />
        <span className="tabular ml-auto text-sm text-muted-foreground" aria-live="polite">
          {members ? `${filtered.length} of ${members.length} members` : ""}
        </span>
      </div>

      {!members && !error && (
        <div className="space-y-2 p-4" role="status" aria-label="Loading members">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {members && filtered.length === 0 && (
        <div className="p-4">
          <EmptyState
            title="No members match"
            description="Change the search or the filters."
            action={
              <Button
                variant="outline"
                className="h-9"
                onClick={() => {
                  setSearch("")
                  setRole("")
                  setStatus("")
                  setMfa("")
                }}
              >
                Clear filters
              </Button>
            }
          />
        </div>
      )}

      {members && filtered.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow>
                  <SortHeader column="name" label="Member" {...sortProps} />
                  <SortHeader column="role" label="Role" className="hidden @md:table-cell" {...sortProps} />
                  <TableHead className="hidden text-xs @lg:table-cell">Status</TableHead>
                  <TableHead className="hidden text-xs @xl:table-cell">Two-step verification</TableHead>
                  <SortHeader column="last_login" label="Last login" className="hidden @2xl:table-cell" {...sortProps} />
                  <TableHead className="w-12 text-xs">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((member) => (
                  <TableRow key={member.membership_id}>
                    <TableCell className="py-2.5">
                      <div className="flex items-center gap-3">
                        <Avatar className="size-8">
                          <AvatarFallback className="text-xs font-medium">{initials(member.name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-[13px] font-medium">
                            {member.name}
                            {member.is_you && (
                              <Badge variant="secondary" className="font-normal">
                                You
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{member.email}</div>
                          <div className="text-xs whitespace-normal text-muted-foreground @md:hidden">
                            {member.role_label} · <MemberStatus member={member} /> · Two-step verification:{" "}
                            <TwoStep on={member.mfa_enabled} /> · Last login: {lastSeen(member.last_login_at)}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-[13px] whitespace-normal @md:table-cell">
                      {member.role_label}
                      <div className="text-xs text-muted-foreground @lg:hidden">
                        <MemberStatus member={member} />
                      </div>
                      <div className="text-xs text-muted-foreground @xl:hidden">
                        Two-step verification: <TwoStep on={member.mfa_enabled} />
                      </div>
                      <div className="text-xs text-muted-foreground @2xl:hidden">Last login: {lastSeen(member.last_login_at)}</div>
                    </TableCell>
                    <TableCell className="hidden text-[13px] @lg:table-cell">
                      <MemberStatus member={member} />
                    </TableCell>
                    <TableCell className="hidden text-[13px] @xl:table-cell">
                      <TwoStep on={member.mfa_enabled} />
                    </TableCell>
                    <TableCell className="tabular hidden text-right text-[13px] @2xl:table-cell">{lastSeen(member.last_login_at)}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Actions for ${member.name}`}>
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setChanging(member)}>
                            <UserCog aria-hidden="true" />
                            Change role
                          </DropdownMenuItem>
                          {!member.is_you && member.status !== "suspended" && (
                            <DropdownMenuItem onSelect={() => setSuspending(member)}>
                              <CirclePause aria-hidden="true" />
                              Suspend
                            </DropdownMenuItem>
                          )}
                          {member.status === "suspended" && (
                            <DropdownMenuItem onSelect={() => setReactivating(member)}>
                              <CirclePlay aria-hidden="true" />
                              Reactivate
                            </DropdownMenuItem>
                          )}
                          {!member.is_you && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(member)}>
                                <UserRoundX aria-hidden="true" />
                                Remove
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <nav aria-label="Pages" className="flex items-center justify-end gap-3 border-t px-4 py-2.5 text-sm">
            <span className="tabular text-muted-foreground">
              Page {current} of {pages}
            </span>
            <Button variant="outline" size="icon" aria-label="Previous page" disabled={current <= 1} onClick={() => setPage(current - 1)}>
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button variant="outline" size="icon" aria-label="Next page" disabled={current >= pages} onClick={() => setPage(current + 1)}>
              <ChevronRight aria-hidden="true" />
            </Button>
          </nav>
        </>
      )}
    </section>
  )

  const invitationsPanel = (
    <section aria-label="Pending invitations" className="@container rounded-[10px] border bg-card">
      {invitations && invitations.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="No pending invitations"
            description="Invitations that haven't been accepted yet appear here."
            action={
              <Button variant="outline" className="h-9" onClick={() => setInviting(true)}>
                Invite member
              </Button>
            }
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead className="text-xs">E-mail</TableHead>
                <TableHead className="hidden text-xs @2xl:table-cell">Role</TableHead>
                <TableHead className="hidden text-xs @3xl:table-cell">Invited by</TableHead>
                <TableHead className="hidden text-xs @2xl:table-cell">Expires</TableHead>
                <TableHead className="text-right text-xs">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(invitations ?? []).map((invitation) => (
                <TableRow key={invitation.id}>
                  <TableCell>
                    <div className="text-[13px] font-medium">{invitation.email}</div>
                    {/* The columns that don't fit, as one line under the address */}
                    <div className="text-xs whitespace-normal text-muted-foreground @3xl:hidden">
                      <span className="@2xl:hidden">
                        {invitation.role_label} ·{" "}
                        {invitation.status === "expired" ? <span className="text-warning">Expired</span> : `Expires ${expiresIn(invitation.expires_at)}`}
                        {invitation.invited_by && " · "}
                      </span>
                      {invitation.invited_by && `Invited by ${invitation.invited_by}`}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-[13px] @2xl:table-cell">{invitation.role_label}</TableCell>
                  <TableCell className="hidden text-[13px] @3xl:table-cell">{invitation.invited_by ?? "–"}</TableCell>
                  <TableCell className="hidden text-[13px] @2xl:table-cell">
                    {invitation.status === "expired" ? (
                      <Badge variant="outline" className="border-warning/60 font-normal text-warning">
                        Expired
                      </Badge>
                    ) : (
                      expiresIn(invitation.expires_at)
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      {invitation.status === "expired" ? (
                        <Button variant="outline" size="sm" className="h-8" onClick={() => resend(invitation)}>
                          Send new invitation
                        </Button>
                      ) : (
                        <>
                          <Button variant="outline" size="sm" className="h-8" onClick={() => resend(invitation)} aria-label={`Resend the invitation to ${invitation.email}`}>
                            Resend
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 text-destructive" onClick={() => setRevoking(invitation)} aria-label={`Revoke the invitation to ${invitation.email}`}>
                            Revoke
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <AdminNav />
      <div className="min-w-0 flex-1">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
            <p className="mt-1 text-sm text-muted-foreground">People in {organization?.name} and what they can do.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="link" className="h-9 gap-1.5 px-0 text-link" onClick={() => setShowRoles(true)}>
              <CircleHelp aria-hidden="true" />
              What can each role do?
            </Button>
            <Button className="h-9 gap-1.5 hover:bg-primary-hover" onClick={() => setInviting(true)}>
              <UserPlus aria-hidden="true" />
              Invite member
            </Button>
          </div>
        </div>

        {error && (
          <Alert variant="destructive" role="alert" className="mb-4">
            <AlertDescription className="flex items-center justify-between gap-4">
              The members could not be loaded.
              <Button variant="outline" size="sm" onClick={load}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <Tabs value={tab} onValueChange={setTab} className="gap-4">
          <TabsList variant="line" aria-label="Members and invitations" className="h-10 w-full justify-start gap-6 border-b px-0">
            <TabsTrigger value="members" className="flex-none gap-2 px-0.5">
              Members
              <span className="tabular rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{members?.length ?? "–"}</span>
            </TabsTrigger>
            <TabsTrigger value="invitations" className="flex-none gap-2 px-0.5">
              Pending invitations
              <span className="tabular rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{invitations?.length ?? "–"}</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="members" className="rounded-[10px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            {membersPanel}
          </TabsContent>
          <TabsContent value="invitations" className="rounded-[10px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            {invitationsPanel}
          </TabsContent>
        </Tabs>
      </div>

      <InviteDialog
        open={inviting}
        onOpenChange={setInviting}
        onInvited={(invitation) => {
          toast.success(`Invitation sent to ${invitation.email}`, { description: "The link works for 7 days." })
          setTab("invitations")
          load()
        }}
      />
      <RolesDialog open={showRoles} onOpenChange={setShowRoles} />
      <ChangeRoleDialog
        member={changing}
        onlyAdmin={changing?.role === "org_admin" && admins === 1}
        onClose={() => setChanging(null)}
        onChanged={(member) => {
          toast.success(`${member.name} is now ${/^[AEIOU]/.test(member.role_label) ? "an" : "a"} ${member.role_label}`, {
            description: "The new role applies from their next request.",
          })
          load()
        }}
      />
      <SuspendMemberDialog
        member={suspending}
        organization={organization?.name ?? "the organization"}
        onClose={() => setSuspending(null)}
        onSuspended={(member) => {
          toast.success(`${member.name} is suspended`, { description: "Their access ended at once. Their role and history stay." })
          load()
        }}
      />
      <ReactivateMemberDialog
        member={reactivating}
        organization={organization?.name ?? "the organization"}
        onClose={() => setReactivating(null)}
        onReactivated={(member) => {
          toast.success(`${member.name} is active again`, { description: `They can open the organization with the role ${member.role_label}.` })
          load()
        }}
      />
      <RemoveMemberDialog
        member={removing}
        organization={organization?.name ?? "the organization"}
        onClose={() => setRemoving(null)}
        onRemoved={(member) => {
          toast.success(`${member.name} was removed`, { description: "Their access ended at once." })
          load()
        }}
      />
      <Dialog open={!!revoking} onOpenChange={(open) => !open && setRevoking(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Revoke the invitation?</DialogTitle>
            <DialogDescription>
              The link sent to {revoking?.email} stops working at once. You can invite them again later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="h-9">
                Keep it
              </Button>
            </DialogClose>
            <Button variant="destructive" className="h-9" onClick={revoke}>
              Revoke invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
