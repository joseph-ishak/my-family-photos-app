"use client";

import type { Photo } from "../../../types/photo";
import PhotoCard from "./PhotoCard";

type Props = {
  photos: Photo[];
  userSub?: string;
  selectedKeys: string[];
  onSelectChange: (key: string, checked: boolean) => void;
  onOpen: (photo: Photo) => void;
  onDelete: (key: string) => void | Promise<void>;
  onUpdate: (photo: Photo) => void;
};

/**
 * Responsive masonry-style grid of `PhotoCard` components.
 *
 * Renders 1 column on mobile up to 4 columns on large screens. Delegates all
 * interaction (selection, open, delete, edit) to the parent via callbacks so
 * this component stays purely presentational.
 *
 * `canEdit` is derived here by comparing `photo.ownerUserId` to `userSub` —
 * actions are shown only for photos the viewer owns.
 */
export default function PhotoGrid({
  photos,
  userSub,
  selectedKeys,
  onSelectChange,
  onOpen,
  onDelete,
  onUpdate,
}: Props) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4">
      {photos.map((photo) => {
        const canEdit = !!userSub && photo.ownerUserId === userSub;
        const isSelected = selectedKeys.includes(photo.key);

        return (
          <PhotoCard
            key={photo.key}
            photo={photo}
            canEdit={canEdit}
            isSelected={isSelected}
            onToggleSelect={(checked) => onSelectChange(photo.key, checked)}
            onOpen={() => onOpen(photo)}
            onDelete={async () => {
              await onDelete(photo.key);
            }}
            onUpdate={() => onUpdate(photo)}
          />
        );
      })}
    </div>
  );
}
