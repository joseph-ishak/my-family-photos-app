/**
 * DynamoDB key builders and constants.
 *
 * All primary key strings in the table are built here. Centralizing them
 * prevents typos that would silently corrupt data (e.g. "EVNT#" instead of
 * "EVENT#").
 */
export const Keys = {
  // Key builders
  event: (id: string) => `EVENT#${id}`,
  user: (id: string) => `USER#${id}`,
  group: (id: string) => `GROUP#${id}`,
  media: (takenAt: string, mediaId: string) => `MEDIA#${takenAt}#${mediaId}`,
  member: (userId: string) => `MEMBER#${userId}`,
  shareGroup: (groupId: string) => `SHARE#GROUP#${groupId}`,

  // Prefix strings used with begins_with in KeyConditionExpression
  prefixes: {
    event: "EVENT#",
    user: "USER#",
    group: "GROUP#",
    media: "MEDIA#",
    member: "MEMBER#",
    shareGroup: "SHARE#GROUP#",
  },

  // Partition key values used for global collections (single-value PKs)
  partitions: {
    events: "EVENT",
    photos: "PHOTO",
    groups: "GROUP",
  },
} as const;
