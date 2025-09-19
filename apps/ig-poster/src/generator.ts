import path from 'path';
import { generateSmartCaption } from './caption';
import { pickDefaultKeywords } from './keywords';

export function generateCaption(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mediaType = (ext === '.mp4' || ext === '.mov' || ext === '.avi' || ext === '.webm') ? 'video' : 'image';
  const selected = pickDefaultKeywords(8);
  const { caption } = generateSmartCaption(filename, mediaType, selected);
  return caption;
}
