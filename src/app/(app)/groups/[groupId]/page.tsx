"use client";

/**
 * Group detail page (`/groups/[groupId]`).
 *
 * Shows group metadata (name, created/updated dates, the current user's role)
 * and a members list sorted by role then alphabetically by last name.
 *
 * Owners can:
 * - **Rename** the group via `PUT /api/groups/:groupId`.
 * - **Add members** by searching users with `GET /api/users?query=` and
 *   selecting from the typeahead dropdown, then `POST /api/groups/:groupId/members`.
 * - **Remove members** (except the owner) via `DELETE /api/groups/:groupId/members/:userId`,
 *   confirmed through an inline `ConfirmModal`.
 *
 * Admins can add and remove non-owner members but cannot rename the group.
 *
 * User profile data (names, avatars) is resolved in bulk via
 * `POST /api/users/resolve` after loading the member list.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import EmptyState, { EmptyStateIcon } from "@/app/components/ui/EmptyState";

/** Discriminated union for the three possible group membership roles. */
type GroupRole = "owner" | "admin" | "member";

/** Full group record returned by `GET /api/groups/:groupId`. */
type GroupDetails = {
  groupId: string;
  name: string;
  role: GroupRole;
  createdAt: string | null;
  updatedAt: string | null;
  ownerUserId: string | null;
};

/** A single group member record. */
type GroupMember = {
  userId: string;
  role: GroupRole;
  /** ISO timestamp when the member was added. */
  createdAt: string | null;
};

/** Shape of the `/api/groups/:groupId` JSON response. */
type ApiGroupResponse = {
  group?: GroupDetails;
  members?: GroupMember[];
};

/** Minimal user profile fields used in the member list and typeahead. */
type UserLite = {
  userId: string;
  firstName?: string;
  lastName?: string;
  nickname?: string;
  username?: string;
  avatarUrl?: string | null;
};

/**
 * Safely parses a JSON response body.
 * Returns `{}` on parse error so callers can use optional-chaining safely.
 */
async function readJsonSafe(res: Response) {
  return (await res.json().catch(() => ({}))) as any;
}

/**
 * Formats an ISO date string to a locale-aware short date.
 * Returns `null` for absent or unparseable values.
 */
function formatDate(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString();
}

/** Maps a group role enum to its human-readable display label. */
function roleLabel(role: GroupRole) {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  return "Member";
}

/** Returns `true` if the role grants permission to add or remove members. */
function canManageMembers(role: GroupRole) {
  return role === "owner" || role === "admin";
}

/** Returns `true` if the role grants permission to rename the group. */
function canEditGroup(role: GroupRole) {
  return role === "owner";
}

/**
 * Produces a displayable full name from a `UserLite` object.
 * Falls back through: full name → nickname → username → truncated userId.
 */
function displayName(u?: UserLite | null) {
  const fn = (u?.firstName || "").trim();
  const ln = (u?.lastName || "").trim();
  const full = `${fn} ${ln}`.trim();
  if (full) return full;
  const nick = (u?.nickname || "").trim();
  if (nick) return nick;
  const un = (u?.username || "").trim();
  if (un) return un;
  return (u?.userId || "User").slice(0, 12);
}

/**
 * Returns a secondary display line combining `@username` and `"nickname"`,
 * falling back to the userId when neither is set.
 */
function secondaryLine(u?: UserLite | null, fallbackUserId?: string) {
  const parts: string[] = [];
  const un = (u?.username || "").trim();
  const nick = (u?.nickname || "").trim();
  if (un) parts.push(`@${un}`);
  if (nick) parts.push(`"${nick}"`);
  const line = parts.join(" • ");
  if (line) return line;
  return fallbackUserId ? fallbackUserId : "";
}

/**
 * Generates a two-letter uppercase monogram from a `UserLite` object for
 * use as an avatar placeholder.
 */
function initialsFrom(u?: UserLite | null) {
  const name = displayName(u);
  const parts = name.split(" ").filter(Boolean);
  const a = parts[0]?.[0] ?? "U";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase();
}

/**
 * Generic confirmation dialog. Accepts a title, optional description, and
 * custom confirm/cancel labels. Disables buttons while `loading` is `true`
 * to prevent double-submission.
 */
function ConfirmModal(props: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3">
      <div className="w-[94vw] max-w-md overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950 text-neutral-100 shadow-2xl">
        <div className="px-6 pt-6 pb-4">
          <div className="text-lg font-semibold tracking-tight">
            {props.title}
          </div>
          {props.description ? (
            <div className="mt-2 text-sm text-neutral-400">
              {props.description}
            </div>
          ) : null}
        </div>

        <div className="px-6 pb-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={props.onCancel}
            disabled={props.loading}
            className="rounded-2xl border border-neutral-800 bg-neutral-900/40 px-4 py-2 text-sm font-medium text-neutral-200 hover:bg-neutral-900 transition disabled:opacity-50"
          >
            {props.cancelLabel || "Cancel"}
          </button>

          <button
            type="button"
            onClick={props.onConfirm}
            disabled={props.loading}
            className="rounded-2xl bg-neutral-50 px-4 py-2 text-sm font-medium text-neutral-900 hover:opacity-90 transition disabled:opacity-50"
          >
            {props.loading ? "Working" : props.confirmLabel || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Group detail page — shows group info, member list, and management controls. */
export default function GroupDetailsPage() {
  const params = useParams<{ groupId: string }>();
  const router = useRouter();

  const groupId = decodeURIComponent(String(params?.groupId || ""));

  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<GroupDetails | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [renameOpen, setRenameOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(false);

  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<GroupRole>("member");
  const [adding, setAdding] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [pendingRemoveUserId, setPendingRemoveUserId] = useState<string | null>(
    null
  );

  const [userMap, setUserMap] = useState<Record<string, UserLite>>({});

  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<UserLite[]>([]);
  const [userSearching, setUserSearching] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const myRole = group?.role ?? "member";
  const canManage = canManageMembers(myRole);
  const canRename = group ? canEditGroup(myRole) : false;

  const created = formatDate(group?.createdAt);
  const updated = formatDate(group?.updatedAt);

  const memberIds = useMemo(
    () => new Set(members.map((m) => m.userId)),
    [members]
  );

  const sortedMembers = useMemo(() => {
    const order: Record<GroupRole, number> = { owner: 0, admin: 1, member: 2 };

    const getSortKey = (m: GroupMember) => {
      const u = userMap[m.userId];
      const ln = (u?.lastName || "").trim().toLowerCase();
      const fn = (u?.firstName || "").trim().toLowerCase();
      const un = (u?.username || "").trim().toLowerCase();
      const dn = displayName(u).toLowerCase();
      return `${ln}|${fn}|${un}|${dn}|${m.userId}`;
    };

    return [...members].sort((a, b) => {
      const ra = order[a.role] ?? 9;
      const rb = order[b.role] ?? 9;
      if (ra !== rb) return ra - rb;
      return getSortKey(a).localeCompare(getSortKey(b));
    });
  }, [members, userMap]);

  const canSubmitRename = useMemo(() => {
    if (!canRename) return false;
    if (renaming) return false;
    const name = newName.trim();
    if (!name) return false;
    if ((group?.name ?? "").trim() === name) return false;
    return true;
  }, [canRename, renaming, newName, group?.name]);

  const canSubmitAdd = useMemo(() => {
    if (!canManage) return false;
    if (adding) return false;
    const uid = addUserId.trim();
    if (!uid) return false;
    if (memberIds.has(uid)) return false;
    return true;
  }, [canManage, adding, addUserId, memberIds]);

  /**
   * Resolves an array of user IDs to `UserLite` objects by calling
   * `POST /api/users/resolve`. Updates `userMap` with the results.
   * Fails silently — missing user profiles degrade to initials-only avatars.
   */
  const resolveMembers = async (ids: string[]) => {
    if (!ids.length) {
      setUserMap({});
      return;
    }

    try {
      const rr = await fetch("/api/users/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userIds: ids }),
      });

      if (!rr.ok) return;

      const rd = await rr.json().catch(() => null);
      const map: Record<string, UserLite> = {};
      for (const u of rd?.users ?? []) {
        if (u?.userId) map[String(u.userId)] = u;
      }

      setUserMap(map);
    } catch {
      // ignore
    }
  };

  /**
   * Fetches the group details and member list from the API, then resolves
   * member user profiles. Sets `error` if the request fails or returns 4xx/5xx.
   */
  const refresh = async () => {
    setLoading(true);
    setError(null);

    try {
      const r = await fetch(`/api/groups/${encodeURIComponent(groupId)}`, {
        credentials: "include",
        cache: "no-store",
      });

      if (!r.ok) {
        const d = await readJsonSafe(r);
        setGroup(null);
        setMembers([]);
        setUserMap({});
        setError(d?.error ? String(d.error) : "Failed to load group");
        return;
      }

      const d = (await r.json().catch(() => ({}))) as ApiGroupResponse;
      const nextGroup = d?.group ?? null;
      const nextMembers = Array.isArray(d?.members) ? d.members : [];

      setGroup(nextGroup);
      setMembers(nextMembers);

      const ids = nextMembers.map((m) => m.userId).filter(Boolean);
      await resolveMembers(ids);
    } catch (e) {
      console.error("Failed to load group", e);
      setGroup(null);
      setMembers([]);
      setUserMap({});
      setError("Failed to load group");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!groupId) return;
    refresh();
  }, [groupId]);

  useEffect(() => {
    if (!canManage) return;

    const q = userQuery.trim();
    if (!q) {
      setUserResults([]);
      setPickerOpen(false);
      return;
    }

    let cancelled = false;
    const t = setTimeout(async () => {
      setUserSearching(true);
      try {
        const r = await fetch(
          `/api/users?query=${encodeURIComponent(q)}&limit=10`,
          { credentials: "include", cache: "no-store" }
        );

        if (!r.ok) return;

        const d = await r.json().catch(() => null);
        if (cancelled) return;

        const users: UserLite[] = Array.isArray(d?.users) ? d.users : [];
        const filtered = users.filter((u) => !memberIds.has(u.userId));
        setUserResults(filtered);
        setPickerOpen(true);
      } finally {
        if (!cancelled) setUserSearching(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [userQuery, canManage, memberIds]);

  /** Submits the rename form via `PUT /api/groups/:groupId` and refreshes. */
  const doRename = async () => {
    const name = newName.trim();
    if (!name) return;

    setRenaming(true);
    try {
      const r = await fetch(`/api/groups/${encodeURIComponent(groupId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      });

      if (!r.ok) {
        const d = await readJsonSafe(r);
        alert(d?.error ? String(d.error) : "Rename failed");
        return;
      }

      setRenameOpen(false);
      setNewName("");
      await refresh();
    } catch (e) {
      console.error(e);
      alert("Rename failed");
    } finally {
      setRenaming(false);
    }
  };

  /**
   * Submits the add-member form via `POST /api/groups/:groupId/members`.
   * Clears the user search inputs and refreshes the member list on success.
   */
  const doAddMember = async () => {
    const userId = addUserId.trim();
    if (!userId) return;

    setAdding(true);
    try {
      const r = await fetch(
        `/api/groups/${encodeURIComponent(groupId)}/members`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ userId, role: addRole }),
        }
      );

      if (!r.ok) {
        const d = await readJsonSafe(r);
        alert(d?.error ? String(d.error) : "Add member failed");
        return;
      }

      setAddUserId("");
      setAddRole("member");
      setUserQuery("");
      setUserResults([]);
      setPickerOpen(false);
      await refresh();
    } catch (e) {
      console.error(e);
      alert("Add member failed");
    } finally {
      setAdding(false);
    }
  };

  /** Opens the confirmation dialog before removing a member. */
  const openRemoveConfirm = (userId: string) => {
    setPendingRemoveUserId(userId);
    setConfirmOpen(true);
  };

  /**
   * Removes the pending member via `DELETE /api/groups/:groupId/members/:userId`,
   * then closes the confirmation dialog and refreshes the list.
   */
  const doRemoveMember = async () => {
    const userId = pendingRemoveUserId;
    if (!userId) return;

    setConfirmLoading(true);
    try {
      const r = await fetch(
        `/api/groups/${encodeURIComponent(
          groupId
        )}/members/${encodeURIComponent(userId)}`,
        {
          method: "DELETE",
          credentials: "include",
        }
      );

      if (!r.ok) {
        const d = await readJsonSafe(r);
        alert(d?.error ? String(d.error) : "Remove failed");
        return;
      }

      setConfirmOpen(false);
      setPendingRemoveUserId(null);
      await refresh();
    } catch (e) {
      console.error(e);
      alert("Remove failed");
    } finally {
      setConfirmLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="py-10 text-center text-sm text-neutral-500">
        Loading group
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="py-10">
        <EmptyState
          icon={<EmptyStateIcon />}
          title="Group not available"
          description={error || "This group could not be loaded."}
          actionLabel="Back to groups"
          onAction={() => router.push("/groups")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 lg:space-y-6">
      <ConfirmModal
        open={confirmOpen}
        title="Remove member"
        description="This will remove the member from the group and revoke access to shared events."
        confirmLabel="Remove"
        cancelLabel="Cancel"
        loading={confirmLoading}
        onCancel={() => {
          if (confirmLoading) return;
          setConfirmOpen(false);
          setPendingRemoveUserId(null);
        }}
        onConfirm={doRemoveMember}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg font-semibold text-white/90 truncate">
            {group.name}
          </div>
          <div className="mt-1 text-xs text-white/60">
            {created ? `Created ${created}` : ""}
            {updated ? `${created ? " • " : ""}Updated ${updated}` : ""}
            <span className="ml-2 rounded-xl border border-white/10 bg-neutral-950/60 px-2 py-0.5 text-[11px] text-white/75">
              {roleLabel(group.role)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canRename ? (
            <button
              onClick={() => {
                setNewName(group.name);
                setRenameOpen(true);
              }}
              className="rounded-xl border border-white/10 bg-neutral-950/40 px-3 py-2 text-sm text-white/80 hover:bg-neutral-900/40 transition"
            >
              Rename
            </button>
          ) : null}

          <button
            onClick={() => router.push("/groups")}
            className="rounded-xl bg-neutral-50 px-4 py-2 text-sm font-medium text-neutral-900 hover:opacity-90 transition"
          >
            Back
          </button>
        </div>
      </div>

      {renameOpen ? (
        <div className="rounded-2xl border border-white/10 bg-neutral-950/40 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white/90">
                Rename group
              </div>
              <div className="mt-1 text-xs text-white/60">
                Only the owner can rename the group.
              </div>
            </div>

            <button
              onClick={() => {
                if (renaming) return;
                setRenameOpen(false);
                setNewName("");
              }}
              disabled={renaming}
              className="rounded-xl border border-white/10 bg-neutral-950/40 px-3 py-2 text-sm text-white/80 hover:bg-neutral-900/40 transition disabled:opacity-50"
            >
              Close
            </button>
          </div>

          <div className="mt-4 space-y-3">
            <div className="text-sm font-medium text-neutral-200">Name</div>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full rounded-2xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm text-neutral-100 outline-none focus:border-neutral-600"
              disabled={renaming}
            />

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={doRename}
                disabled={!canSubmitRename}
                className="rounded-2xl bg-neutral-50 px-6 py-3 text-sm font-medium text-neutral-900 hover:opacity-90 transition disabled:opacity-50"
              >
                {renaming ? "Saving" : "Save"}
              </button>

              <button
                onClick={() => {
                  if (renaming) return;
                  setRenameOpen(false);
                  setNewName("");
                }}
                disabled={renaming}
                className="rounded-2xl border border-neutral-800 bg-neutral-900/40 px-6 py-3 text-sm font-medium text-neutral-200 hover:bg-neutral-900 transition disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {canManage ? (
        <div className="rounded-2xl border border-white/10 bg-neutral-950/40 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white/90">
                Add member
              </div>
              <div className="mt-1 text-xs text-white/60">
                Search by name nickname username or user id.
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
            <div className="space-y-2 relative">
              <div className="text-sm font-medium text-neutral-200">User</div>
              <input
                value={userQuery}
                onChange={(e) => {
                  setUserQuery(e.target.value);
                  setError(null);
                }}
                onFocus={() => {
                  if (userResults.length) setPickerOpen(true);
                }}
                onBlur={() => {
                  setTimeout(() => setPickerOpen(false), 150);
                }}
                placeholder="Start typing a name"
                className="w-full rounded-2xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm text-neutral-100 outline-none focus:border-neutral-600"
                disabled={adding}
              />

              {pickerOpen ? (
                <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 shadow-xl">
                  <div className="px-3 py-2 text-[11px] text-white/60 border-b border-white/10">
                    {userSearching
                      ? "Searching"
                      : userResults.length
                      ? "Select a person"
                      : "No matches"}
                  </div>

                  <div className="max-h-72 overflow-auto">
                    {userResults.map((u) => (
                      <button
                        key={u.userId}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setAddUserId(u.userId);
                          setUserQuery(displayName(u));
                          setPickerOpen(false);
                        }}
                        className="w-full text-left px-3 py-3 hover:bg-neutral-900/60 transition flex items-center gap-3"
                      >
                        <div className="w-9 h-9 rounded-full overflow-hidden bg-neutral-800/40 border border-neutral-800 flex items-center justify-center shrink-0">
                          {u.avatarUrl ? (
                            <img
                              src={u.avatarUrl}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-xs text-neutral-200">
                              {initialsFrom(u)}
                            </span>
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="text-sm text-white/90 truncate">
                            {displayName(u)}
                          </div>
                          <div className="text-[11px] text-white/60 truncate">
                            {secondaryLine(u, u.userId)}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {addUserId ? (
                <div className="mt-2 text-[11px] text-white/60">
                  Selected user id{" "}
                  <span className="text-white/80">{addUserId}</span>
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium text-neutral-200">Role</div>
              <select
                value={addRole}
                onChange={(e) => setAddRole(e.target.value as GroupRole)}
                disabled={adding}
                className="w-full rounded-2xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm text-neutral-100 outline-none focus:border-neutral-600"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <button
              onClick={doAddMember}
              disabled={!canSubmitAdd}
              className="rounded-2xl bg-neutral-50 px-6 py-3 text-sm font-medium text-neutral-900 hover:opacity-90 transition disabled:opacity-50"
            >
              {adding ? "Adding" : "Add"}
            </button>
          </div>

          {!addUserId ? (
            <div className="mt-3 text-xs text-white/50">
              Tip: pick someone from the dropdown.
            </div>
          ) : memberIds.has(addUserId) ? (
            <div className="mt-3 text-xs text-amber-200/80">
              That person is already in this group.
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-2xl border border-white/10 bg-neutral-950/40 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-white/90">Members</div>
          <div className="text-xs text-white/60">
            {sortedMembers.length} total
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {sortedMembers.map((m) => {
            const createdAt = formatDate(m.createdAt);
            const isOwner = m.role === "owner";
            const canRemove =
              canManage && !isOwner && m.userId !== group.ownerUserId;

            const u = userMap[m.userId];

            return (
              <div
                key={m.userId}
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-neutral-950/60 px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-neutral-800/40 border border-neutral-800 flex items-center justify-center shrink-0">
                    {u?.avatarUrl ? (
                      <img
                        src={u.avatarUrl}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-xs text-neutral-200">
                        {initialsFrom(u)}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="truncate text-sm text-white/90">
                      {displayName(u)}
                    </div>
                    <div className="mt-1 text-[11px] text-white/60 truncate">
                      {secondaryLine(u, m.userId)}
                      {" • "}
                      {roleLabel(m.role)}
                      {createdAt ? ` • Added ${createdAt}` : ""}
                    </div>
                  </div>
                </div>

                {canRemove ? (
                  <button
                    onClick={() => openRemoveConfirm(m.userId)}
                    className="shrink-0 rounded-xl border border-white/10 bg-neutral-950/40 px-3 py-2 text-sm text-white/80 hover:bg-neutral-900/40 transition"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
