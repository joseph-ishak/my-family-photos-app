"use client";
// src/app/%28app%29/family-photos/FamilyPhotosPage.tsx
import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import PhotoUploadModal from "@/app/components/PhotoUploadModal";
import PhotoSlideshow from "@/app/components/PhotoSlideshow";

import GalleryHeader from "@/app/components/family-photos/GalleryHeader";
import FiltersBar from "@/app/components/family-photos/FiltersBar";
import BulkActionsBar from "@/app/components/family-photos/BulkActionsBar";
import PhotoGrid from "@/app/components/family-photos/PhotoGrid";
import PhotoEditorModal from "@/app/components/family-photos/PhotoEditorModal";
import EmptyState, { EmptyStateIcon } from "@/app/components/ui/EmptyState";
import { useAuthUser } from "../../../hooks/useAuthUser";
import { usePhotosFeed } from "../../../hooks/usePhotoFeed";

import type { Photo } from "../../../hooks/usePhotoFeed";

type Props = {
  initialEventFilter?: string;
  hideHeader?: boolean;
};

export default function FamilyPhotosPage(props: Props) {
  return (
    <Suspense fallback={<FamilyPhotosSkeleton />}>
      <FamilyPhotosInner {...props} />
    </Suspense>
  );
}

function FamilyPhotosSkeleton() {
  return (
    <div className="min-h-[60vh] grid place-items-center">
      <p className="text-sm text-neutral-500">Loading…</p>
    </div>
  );
}

function FamilyPhotosInner({ initialEventFilter, hideHeader }: Props) {
  const { loading, user } = useAuthUser();

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const uploadParam = searchParams.get("upload") === "1";

  const [modalOpen, setModalOpen] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPhoto, setEditingPhoto] = useState<Photo | null>(null);

  const {
    existingEvents = [],
    totalForCurrentEvent,

    selectedKeys = [],
    setSelectedKeys,

    expandedPhoto,
    setExpandedPhoto,

    eventFilter,
    setEventFilter,

    dateFilter,
    setDateFilter,

    mediaFilter,
    setMediaFilter,

    clearFilters,

    filteredPhotos = [],

    hasMore,
    loadMore,
    loaderRef,

    deletePhoto,
    bulkDelete,

    handleUploadSuccess,

    saveEditedPhoto,
  } = usePhotosFeed({ pageSize: 20, initialEventFilter });

  useEffect(() => {
    if (uploadParam) setModalOpen(true);
  }, [uploadParam]);

  if (loading) {
    return (
      <div className="min-h-[60vh] grid place-items-center">
        <p className="text-sm text-neutral-500">Checking authentication…</p>
      </div>
    );
  }

  const canEditEditing =
    !!editingPhoto && !!user?.sub && editingPhoto.ownerUserId === user.sub;

  const isEmpty = filteredPhotos.length === 0;

  return (
    <div className="space-y-4 lg:space-y-6">
      {!hideHeader ? (
        <GalleryHeader onUploadClick={() => setModalOpen(true)} />
      ) : null}

      <PhotoUploadModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          if (uploadParam) router.replace(pathname);
        }}
        onUploadSuccess={handleUploadSuccess}
        existingEvents={existingEvents}
        user={user}
        lockedEventId={initialEventFilter}
      />

      <PhotoSlideshow
        photos={filteredPhotos}
        openPhoto={expandedPhoto}
        onClose={() => setExpandedPhoto(null)}
        loadMore={loadMore}
        hasMore={hasMore}
      />

      <PhotoEditorModal
        open={editorOpen}
        photoUrl={editingPhoto?.url || ""}
        canEdit={canEditEditing}
        onClose={() => {
          setEditorOpen(false);
          setEditingPhoto(null);
        }}
        onSave={async (blob) => {
          if (!editingPhoto) return;
          await saveEditedPhoto(editingPhoto, blob);
        }}
      />

      <FiltersBar
        existingEvents={existingEvents}
        eventFilter={eventFilter}
        dateFilter={dateFilter}
        mediaFilter={mediaFilter}
        onEventChange={setEventFilter}
        onDateChange={setDateFilter}
        onMediaChange={setMediaFilter}
        onClear={clearFilters}
      />

      <BulkActionsBar
        selectedCount={selectedKeys.length}
        totalCount={filteredPhotos.length}
        onSelectAll={() => setSelectedKeys(filteredPhotos.map((p) => p.key))}
        onClearSelection={() => setSelectedKeys([])}
        onDeleteSelected={bulkDelete}
      />

      {!isEmpty && (
        <div className="flex items-center justify-between">
          {/* Loaded / total counter — only shown when viewing a specific event */}
          {totalForCurrentEvent !== null ? (
            <span className="text-xs text-neutral-500 tabular-nums">
              {filteredPhotos.length === totalForCurrentEvent ? (
                <>All <span className="text-neutral-300">{totalForCurrentEvent}</span> loaded</>
              ) : (
                <><span className="text-neutral-300">{filteredPhotos.length}</span> of <span className="text-neutral-300">{totalForCurrentEvent}</span> loaded</>
              )}
            </span>
          ) : (
            <span />
          )}

          <button
            onClick={() => setExpandedPhoto(filteredPhotos[0])}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white/60 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition"
          >
            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            Start slideshow
          </button>
        </div>
      )}

      {isEmpty ? (
        <div className="py-10">
          <EmptyState
            icon={<EmptyStateIcon />}
            title={eventFilter || dateFilter ? "No matches" : "No photos yet"}
            description={
              eventFilter || dateFilter
                ? "Try adjusting or clearing your filters."
                : "Upload photos to start building your family archive."
            }
            actionLabel={
              eventFilter || dateFilter ? "Clear filters" : "Upload photos"
            }
            onAction={
              eventFilter || dateFilter
                ? clearFilters
                : () => setModalOpen(true)
            }
          />
        </div>
      ) : (
        <>
          <PhotoGrid
            photos={filteredPhotos}
            userSub={user?.sub}
            selectedKeys={selectedKeys}
            onSelectChange={(key, checked) => {
              setSelectedKeys((prev: string[] = []) =>
                checked ? [...prev, key] : prev.filter((k) => k !== key)
              );
            }}
            onOpen={setExpandedPhoto}
            onDelete={(key) => {
              deletePhoto(key);
            }}
            onUpdate={(photo) => {
              setEditingPhoto(photo);
              setEditorOpen(true);
            }}
          />

          <div ref={loaderRef} className="h-10" />

          {!hasMore ? (
            <div className="py-10 text-center text-sm text-neutral-500">
              {totalForCurrentEvent !== null
                ? `All ${totalForCurrentEvent} items loaded.`
                : "You have reached the end."}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
