/**
 * Client-side download utilities.
 *
 * `triggerDownload` fetches a presigned URL from `GET /api/download-url` and
 * opens it in a hidden anchor so the browser saves the file to disk. The
 * presigned URL already carries `Content-Disposition: attachment`, which is
 * what forces the download rather than an inline preview — even for cross-origin
 * S3 URLs where the HTML `<a download>` attribute is ignored by browsers.
 *
 * `downloadPhoto` is a convenience wrapper that chooses the best available key:
 *   - `archiveKey` (lossless HEIC original)  — preferred when present
 *   - `s3Key`      (full-resolution JPEG/MP4) — fallback
 *
 * `bulkDownloadPhotos` downloads multiple photos sequentially. A 400 ms gap
 * between each prevents browsers from treating rapid-fire anchor clicks as a
 * pop-up flood and blocking them.
 */

import type { Photo } from "@/types/photo";

/**
 * Fetches a short-lived presigned S3 download URL for `key` and immediately
 * triggers a browser file-save dialog by clicking a hidden anchor.
 *
 * @throws If the `/api/download-url` request fails.
 */
export async function triggerDownload(key: string): Promise<void> {
  const res = await fetch(
    `/api/download-url?${new URLSearchParams({ key })}`,
    { credentials: "include" }
  );

  if (!res.ok) {
    throw new Error(`download-url request failed: ${res.status}`);
  }

  const { url } = (await res.json()) as { url: string };

  const a = document.createElement("a");
  a.href = url;
  // `target="_blank"` ensures we don't navigate away from the page.
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Downloads a single photo. Prefers the lossless HEIC archive (`archiveKey`)
 * when present; falls back to the full-resolution display file (`s3Key`).
 *
 * @throws If neither `archiveKey` nor `s3Key` is available, or if the download
 *   URL request fails.
 */
export async function downloadPhoto(photo: Photo): Promise<void> {
  const key = photo.archiveKey ?? photo.s3Key;
  if (!key) throw new Error("Photo has no downloadable key");
  await triggerDownload(key);
}

/**
 * Downloads multiple photos sequentially, waiting 400 ms between each to avoid
 * browser pop-up blockers treating rapid clicks as a flood.
 *
 * Errors on individual photos are logged but do not abort the remaining
 * downloads — the user gets as many files as possible.
 *
 * @param photos - The photos to download.
 * @param onProgress - Optional callback fired after each download attempt with
 *   the number completed so far and the total count.
 */
export async function bulkDownloadPhotos(
  photos: Photo[],
  onProgress?: (completed: number, total: number) => void
): Promise<void> {
  for (let i = 0; i < photos.length; i++) {
    try {
      await downloadPhoto(photos[i]);
    } catch (err) {
      console.error(`[download] Failed for photo ${photos[i].key}:`, err);
    }

    onProgress?.(i + 1, photos.length);

    // Brief pause between downloads so the browser doesn't block them.
    if (i < photos.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
}
