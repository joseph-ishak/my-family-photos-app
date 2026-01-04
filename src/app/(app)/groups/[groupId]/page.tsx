"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import EmptyState, { EmptyStateIcon } from "@/app/components/ui/EmptyState";

type GroupRole = "owner" | "admin" | "member";

type GroupDetails = {
  groupId: string;
  name: string;
  role: GroupRole;
  createdAt: string | null;
  updatedAt: string | null;
  ownerUserId: string | null;
};

type GroupMember = {
  userId: string;
  role: GroupRole;
  createdAt: string | null;
};

type ApiGroupResponse = {
  group?: GroupDetails;
  members?: GroupMember[];
};

async function readJsonSafe(res: Response) {
  return (await res.json().catch(() => ({}))) as any;
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString();
}

function roleLabel(role: GroupRole) {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  return "Member";
}

function canManageMembers(role: GroupRole) {
  return role === "owner" || role === "admin";
}

function canEditGroup(role: GroupRole) {
  return role === "owner";
}

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

  const refresh = async () => {
    setLoading(true);
    setError(null);

    try {
      const r = await fetch(`/api/groups/${encodeURIComponent(groupId)}`, {
        credentials: "include",
      });

      if (!r.ok) {
        const d = await readJsonSafe(r);
        setGroup(null);
        setMembers([]);
        setError(d?.error ? String(d.error) : "Failed to load group");
        return;
      }

      const d = (await r.json().catch(() => ({}))) as ApiGroupResponse;
      setGroup(d?.group ?? null);
      setMembers(Array.isArray(d?.members) ? d.members : []);
    } catch (e) {
      console.error("Failed to load group", e);
      setGroup(null);
      setMembers([]);
      setError("Failed to load group");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!groupId) return;
    refresh();
  }, [groupId]);

  const myRole = group?.role ?? "member";

  const sortedMembers = useMemo(() => {
    const order: Record<GroupRole, number> = { owner: 0, admin: 1, member: 2 };
    return [...members].sort((a, b) => {
      const ra = order[a.role] ?? 9;
      const rb = order[b.role] ?? 9;
      if (ra !== rb) return ra - rb;
      return a.userId.localeCompare(b.userId);
    });
  }, [members]);

  const canManage = canManageMembers(myRole);
  const canRename = group ? canEditGroup(myRole) : false;

  const created = formatDate(group?.createdAt);
  const updated = formatDate(group?.updatedAt);

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
    if (!addUserId.trim()) return false;
    return true;
  }, [canManage, adding, addUserId]);

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
      await refresh();
    } catch (e) {
      console.error(e);
      alert("Add member failed");
    } finally {
      setAdding(false);
    }
  };

  const openRemoveConfirm = (userId: string) => {
    setPendingRemoveUserId(userId);
    setConfirmOpen(true);
  };

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
                Add by user id for now. Later we can add email invites.
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
            <div className="space-y-2">
              <div className="text-sm font-medium text-neutral-200">
                User id
              </div>
              <input
                value={addUserId}
                onChange={(e) => setAddUserId(e.target.value)}
                placeholder="Cognito sub"
                className="w-full rounded-2xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm text-neutral-100 outline-none focus:border-neutral-600"
                disabled={adding}
              />
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

            return (
              <div
                key={m.userId}
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-neutral-950/60 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-white/90">
                    {m.userId}
                  </div>
                  <div className="mt-1 text-[11px] text-white/60">
                    {roleLabel(m.role)}
                    {createdAt ? ` • Added ${createdAt}` : ""}
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
