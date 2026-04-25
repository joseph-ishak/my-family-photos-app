// src/app/components/family-photos/PhotoEditorModal.tsx
"use client";

/**
 * Full-screen modal for cropping and rotating a photo before saving.
 *
 * Uses `react-easy-crop` for the crop/zoom/rotate UI and `getCroppedBlob`
 * from `lib/image-edit.ts` to render the cropped region to a Blob that is
 * passed to `onSave`. The modal resets its state on every open so stale crop
 * coordinates from a previous edit do not carry over.
 *
 * `canEdit` must be `true` for the Save button to be enabled — the parent
 * should only pass `true` when the viewer is the owner of the photo.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Cropper from "react-easy-crop";
import { getCroppedBlob } from "../../../lib/image-edit";

type CropPixels = { x: number; y: number; width: number; height: number };

type Props = {
  open: boolean;
  photoUrl: string;
  canEdit: boolean;
  onClose: () => void;
  onSave: (blob: Blob) => Promise<void>;
};

export default function PhotoEditorModal({
  open,
  photoUrl,
  canEdit,
  onClose,
  onSave,
}: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [cropPixels, setCropPixels] = useState<CropPixels | null>(null);
  const [saving, setSaving] = useState(false);

  const disabled = !canEdit || saving;

  const onCropComplete = useCallback((_a: any, b: CropPixels) => {
    setCropPixels(b);
  }, []);

  useEffect(() => {
    if (!open) return;
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setCropPixels(null);
    setSaving(false);
  }, [open]);

  const safeUrl = useMemo(() => photoUrl || "", [photoUrl]);

  if (!open) return null;

  /**
   * Renders the current crop region to a JPEG Blob, then calls `onSave` and
   * closes the modal on success. Guards against double-submit with `saving`.
   */
  async function handleSave() {
    if (!cropPixels) return;

    try {
      setSaving(true);

      const blob = await getCroppedBlob({
        imageSrc: safeUrl,
        cropPixels,
        rotation,
        mimeType: "image/jpeg",
        quality: 0.92,
      });

      await onSave(blob);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[92vw] max-w-3xl rounded-lg bg-white p-4">
        <div className="text-lg font-semibold mb-3">Update photo</div>

        <div className="relative h-[60vh] w-full bg-black overflow-hidden rounded">
          <Cropper
            image={safeUrl}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={4 / 3}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onRotationChange={setRotation}
            onCropComplete={onCropComplete}
          />
        </div>

        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-24 text-sm text-gray-700">Zoom</div>
            <input
              className="w-full"
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              disabled={disabled}
            />
          </div>

          <div className="flex items-center gap-3">
            <div className="w-24 text-sm text-gray-700">Rotate</div>
            <input
              className="w-full"
              type="range"
              min={0}
              max={360}
              step={1}
              value={rotation}
              onChange={(e) => setRotation(Number(e.target.value))}
              disabled={disabled}
            />
          </div>

          {!canEdit && (
            <p className="text-sm text-red-600">
              You can only update photos you uploaded
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              className="rounded border px-3 py-2"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>

            <button
              className="rounded bg-black px-3 py-2 text-white"
              onClick={handleSave}
              disabled={disabled}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
