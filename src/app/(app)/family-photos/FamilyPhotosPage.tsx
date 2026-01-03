"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import PhotoUploadModal from "@/app/components/PhotoUploadModal";
import PhotoLightbox from "@/app/components/PhotoLightbox";

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

    selectedKeys = [],
    setSelectedKeys,

    expandedPhoto,
    setExpandedPhoto,

    eventFilter,
    setEventFilter,

    dateFilter,
    setDateFilter,

    clearFilters,

    filteredPhotos = [],

    hasMore,
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

      <PhotoLightbox
        photo={expandedPhoto}
        onClose={() => setExpandedPhoto(null)}
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
        onEventChange={setEventFilter}
        onDateChange={setDateFilter}
        onClear={clearFilters}
      />

      <BulkActionsBar
        selectedCount={selectedKeys.length}
        totalCount={filteredPhotos.length}
        onSelectAll={() => setSelectedKeys(filteredPhotos.map((p) => p.key))}
        onClearSelection={() => setSelectedKeys([])}
        onDeleteSelected={bulkDelete}
      />

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
              You have reached the end.
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
