import { z } from 'zod';

export interface PostPlatforms {
  instagram: boolean;
  facebook?: {
    enabled: boolean;
    pageId: string;
    pageName?: string;
    pageAccessToken?: string;
  };
}

export interface Post {
  id: string;
  filename: string;
  image_url: string;
  caption: string;
  status: 'QUEUED' | 'SCHEDULED' | 'PUBLISHING' | 'PUBLISHED' | 'ERROR';
  scheduled_at: Date;
  created_at: Date;
  published_at?: Date;
  ig_media_id?: string;
  error_message?: string;
  // Repost fields
  is_repost?: boolean;
  original_post_id?: string; // root original id
  repost_count?: number; // maintained on root original
  // Platforms config (optional; default instagram true)
  platforms?: PostPlatforms;
}

export interface AppState {
  autorun: boolean;
  posts: Post[];
  lastPlanRun: Date | null;
}

// Schedule preview API types
export const SchedulePreviewRequestSchema = z.object({
  count: z.coerce.number().int().min(1).max(365).default(20)
});
export type SchedulePreviewRequest = z.infer<typeof SchedulePreviewRequestSchema>;
export const SchedulePreviewResponseSchema = z.array(z.string());
export type SchedulePreviewResponse = z.infer<typeof SchedulePreviewResponseSchema>;

// History API types
export const HistoryRequestSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  from: z.string().optional(),
  to: z.string().optional(),
});
export type HistoryRequest = z.infer<typeof HistoryRequestSchema>;

export const HistoryItemSchema = z.object({
  id: z.string(),
  filename: z.string(),
  caption: z.string().optional().default(''),
  published_at: z.string(),
  ig_media_id: z.string().optional().default(''),
  thumbnail_url: z.string(),
  is_repost: z.boolean().optional().default(false),
});
export const HistoryResponseSchema = z.object({
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
  items: z.array(HistoryItemSchema),
});
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;

// Keyword store types
export const KeywordCategorySchema = z.enum(['Business','Fitness','Motivation','Location']);
export type KeywordCategory = z.infer<typeof KeywordCategorySchema>;
export const KeywordsGetResponseSchema = z.object({
  categories: z.record(z.array(z.string()))
});
export type KeywordsGetResponse = z.infer<typeof KeywordsGetResponseSchema>;
export const KeywordsMutationRequestSchema = z.object({
  category: z.string().min(1),
  action: z.enum(['add','remove']),
  keyword: z.string().min(1)
});
export type KeywordsMutationRequest = z.infer<typeof KeywordsMutationRequestSchema>;

// Caption generation types
export const CaptionRequestSchema = z.object({
  filename: z.string().min(1),
  mediaType: z.enum(['image','video']),
  keywords: z.array(z.string()).optional().default([])
});
export type CaptionRequest = z.infer<typeof CaptionRequestSchema>;
export const CaptionResponseSchema = z.object({
  caption: z.string(),
  hashtags: z.array(z.string())
});
export type CaptionResponse = z.infer<typeof CaptionResponseSchema>;
