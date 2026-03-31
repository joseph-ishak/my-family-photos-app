export type Photo = {
  key: string;
  url: string;
  eventId?: string;
  takenAt?: string;
  ownerUserId?: string;
  ownerNickname?: string | null;
  pk?: string;
  sk?: string;
  s3Key?: string;
  mimeType?: string;
  mediaType?: "photo" | "video";
  thumbnailKey?: string;
  thumbnailUrl?: string;
};
