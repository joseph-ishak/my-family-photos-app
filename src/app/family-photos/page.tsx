"use client";

import { useState } from "react";
import PhotoUploadModal from "../components/PhotoUploadModal";
import PhotoLightbox from "../components/PhotoLightbox";

import GalleryHeader from "../components/family-photos/GalleryHeader";
import FiltersBar from "../components/family-photos/FiltersBar";
import BulkActionsBar from "../components/family-photos/BulkActionsBar";
import PhotoGrid from "../components/family-photos/PhotoGrid";

import { useAuthUser } from "../../hooks/useAuthUser";
import { usePhotosFeed } from "../../hooks/usePhotoFeed";

export default function FamilyPhotosPage() {
  const { loading, user } = useAuthUser();
  const [modalOpen, setModalOpen] = useState(false);

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
  } = usePhotosFeed({ pageSize: 20 });

  if (loading)
    return <p className="p-4 text-center">Checking authentication...</p>;

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-6">
      <GalleryHeader onUploadClick={() => setModalOpen(true)} />

      <PhotoUploadModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onUploadSuccess={handleUploadSuccess}
        existingEvents={existingEvents}
        user={user}
      />

      <PhotoLightbox
        photo={expandedPhoto}
        onClose={() => setExpandedPhoto(null)}
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
        onDeleteSelected={bulkDelete}
      />

      <PhotoGrid
        photos={filteredPhotos}
        userSub={user?.sub}
        selectedKeys={selectedKeys}
        onSelectChange={(key, checked) => {
          if (!setSelectedKeys) return;
          setSelectedKeys((prev: string[] = []) =>
            checked ? [...prev, key] : prev.filter((k) => k !== key)
          );
        }}
        onOpen={setExpandedPhoto}
        onDelete={(key) => {
          console.log("FamilyPhotosPage onDelete received key", key);
          deletePhoto(key);
        }}
      />

      <div ref={loaderRef} className="h-10" />

      {!hasMore && (
        <p className="text-center text-gray-500 mt-4">No more photos.</p>
      )}
    </div>
  );
}
