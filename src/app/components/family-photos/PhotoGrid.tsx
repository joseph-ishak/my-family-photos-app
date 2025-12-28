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
};

export default function PhotoGrid({
  photos,
  userSub,
  selectedKeys,
  onSelectChange,
  onOpen,
  onDelete,
}: Props) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
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
              console.log("PhotoCard onDelete fired for", photo.key);
              await onDelete(photo.key);
            }}
            onUpdate={() => alert("Update or crop not implemented yet")}
          />
        );
      })}
    </div>
  );
}
