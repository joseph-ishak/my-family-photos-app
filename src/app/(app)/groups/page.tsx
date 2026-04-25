"use client";

/**
 * Groups list page (`/groups`).
 *
 * Lists all groups the authenticated user belongs to, with their role badge and
 * creation date. Provides a **New group** button that expands an inline form
 * for naming and creating a group via `POST /api/groups`.
 *
 * Each group card links to `/groups/[groupId]` for member management.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import EmptyState, { EmptyStateIcon } from "@/app/components/ui/EmptyState";

/** Minimal group summary returned by `GET /api/groups`. */
type GroupSummary = {
  groupId: string;
  name: string;
  role: "owner" | "admin" | "member";
  createdAt: string | null;
};

/** Shape of the `/api/groups` JSON response. */
type ApiGroupsResponse = {
  groups?: GroupSummary[];
};

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

/** Maps a group role enum to its display label. */
function roleLabel(role: GroupSummary["role"]) {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  return "Member";
}

/**
 * Safely parses a JSON response body.
 * Returns `{}` on parse error so callers can use optional-chaining safely.
 */
async function readJsonSafe(res: Response) {
  return (await res.json().catch(() => ({}))) as any;
}

/** Groups list page component. */
export default function GroupsPage() {
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<GroupSummary[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  /** Fetches the current user's groups and updates local state. */
  const refresh = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/groups", { credentials: "include" });
      const d = (await r.json().catch(() => ({}))) as ApiGroupsResponse;
      setGroups(Array.isArray(d?.groups) ? d.groups : []);
    } catch (e) {
      console.error("Failed to load groups", e);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const isEmpty = useMemo(
    () => !loading && groups.length === 0,
    [loading, groups.length]
  );

  const canCreate = useMemo(() => {
    if (creating) return false;
    if (!newName.trim()) return false;
    return true;
  }, [creating, newName]);

  /** Submits the new-group form via `POST /api/groups` and refreshes the list. */
  const createGroup = async () => {
    const name = newName.trim();
    if (!name) return;

    setCreating(true);
    try {
      const r = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      });

      if (!r.ok) {
        const data = await readJsonSafe(r);
        alert(data?.error ? String(data.error) : "Create failed");
        return;
      }

      setNewName("");
      setCreateOpen(false);
      await refresh();
    } catch (e) {
      console.error(e);
      alert("Create failed");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="text-lg font-semibold text-white/90">Groups</div>

        <button
          onClick={() => setCreateOpen(true)}
          className="rounded-xl bg-neutral-50 px-4 py-2 text-sm font-medium text-neutral-900 hover:opacity-90 transition"
        >
          New group
        </button>
      </div>

      {createOpen ? (
        <div className="rounded-2xl border border-white/10 bg-neutral-950/40 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white/90">
                Create group
              </div>
              <div className="mt-1 text-xs text-white/60">
                Create a group so you can share events with specific people.
              </div>
            </div>

            <button
              onClick={() => {
                if (creating) return;
                setCreateOpen(false);
                setNewName("");
              }}
              className="rounded-xl border border-white/10 bg-neutral-950/40 px-3 py-2 text-sm text-white/80 hover:bg-neutral-900/40 transition disabled:opacity-50"
              disabled={creating}
            >
              Close
            </button>
          </div>

          <div className="mt-4 space-y-3">
            <div className="text-sm font-medium text-neutral-200">
              Group name
            </div>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Family"
              className="w-full rounded-2xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm text-neutral-100 outline-none focus:border-neutral-600"
              disabled={creating}
            />

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={createGroup}
                disabled={!canCreate}
                className="rounded-2xl bg-neutral-50 px-6 py-3 text-sm font-medium text-neutral-900 hover:opacity-90 transition disabled:opacity-50"
              >
                {creating ? "Creating" : "Create"}
              </button>

              <button
                onClick={() => {
                  if (creating) return;
                  setCreateOpen(false);
                  setNewName("");
                }}
                disabled={creating}
                className="rounded-2xl border border-neutral-800 bg-neutral-900/40 px-6 py-3 text-sm font-medium text-neutral-200 hover:bg-neutral-900 transition disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isEmpty ? (
        <div className="py-10">
          <EmptyState
            icon={<EmptyStateIcon />}
            title="No groups yet"
            description="Create a group to start sharing events."
            actionLabel="Create group"
            onAction={() => setCreateOpen(true)}
          />
        </div>
      ) : loading ? (
        <div className="py-10 text-center text-sm text-neutral-500">
          Loading groups
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3 lg:gap-4">
          {groups.map((g) => {
            const created = formatDate(g.createdAt);

            return (
              <Link
                key={g.groupId}
                href={`/groups/${encodeURIComponent(g.groupId)}`}
                className="group overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/40 p-4 transition hover:border-white/15 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-white/20"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white/90">
                      {g.name || g.groupId}
                    </div>
                    <div className="mt-1 text-xs text-white/60">
                      {created ? `Created ${created}` : ""}
                    </div>
                  </div>

                  <div className="shrink-0 rounded-xl border border-white/10 bg-neutral-950/60 px-3 py-1 text-[11px] text-white/75">
                    {roleLabel(g.role)}
                  </div>
                </div>

                <div className="mt-3 text-xs text-white/55">
                  Open to manage members and sharing.
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
