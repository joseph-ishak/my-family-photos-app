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
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 lg:grid-cols-5 lg:gap-4 xl:grid-cols-6">
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
