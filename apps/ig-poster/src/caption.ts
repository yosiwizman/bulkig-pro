import path from 'path';
import { pickDefaultKeywords } from './keywords';

export type MediaType = 'image'|'video';

function ensureHashtag(s: string): string { return s.startsWith('#') ? s : ('#' + s.replace(/^#+/,'')); }

function clamp(len: number, min: number, max: number) { return Math.max(min, Math.min(max, len)); }

// Improved hashtag generation: 10-15 tags with variations and related terms
function generateHashtags(keywords: string[]): string[] {
  const tags = new Set<string>();
  const baseKeywords = (keywords || []).filter(Boolean);
  for (const kw of baseKeywords) {
    const words = String(kw).toLowerCase().split(/\s+/).filter(Boolean);
    // Add base hashtag and variations for each word and combined
    const combined = words.join('');
    if (combined) {
      tags.add(`#${combined}`);
      tags.add(`#${combined}life`);
      tags.add(`#${combined}love`);
      tags.add(`#${combined}daily`);
    }
    for (const w of words) {
      const clean = w.replace(/[^a-z0-9]/g, '');
      if (!clean) continue;
      tags.add(`#${clean}`);
      tags.add(`#${clean}life`);
      tags.add(`#${clean}daily`);
    }
    // Removed brand/location anchors to keep captions generic
  }
  // Pad with defaults up to 15
  const defaults = ['#instagood','#photooftheday','#love','#beautiful','#happy','#cute','#instadaily','#followme','#picoftheday','#instalike'];
  for (const d of defaults) { if (tags.size >= 15) break; tags.add(d); }
  return Array.from(tags).slice(0, 15);
}

// Filter out unwanted filename patterns from captions
function filterFilenameWords(words: string[]): string[] {
  return words.filter(word => {
    const w = word.toLowerCase();
    // Skip common file prefixes
    if (/^(vid|img|image|photo|pic|screenshot)$/i.test(w)) return false;
    // Skip WhatsApp patterns (WA followed by numbers)
    if (/^wa\d+$/i.test(w)) return false;
    // Skip pure numbers and date-like patterns
    if (/^\d+$/.test(w) && w.length >= 4) return false;
    // Skip very short words (1-2 chars) that are likely noise
    if (w.length <= 2) return false;
    return true;
  });
}

export function generateSmartCaption(filename: string, mediaType: MediaType, selectedKeywords?: string[]): { caption: string; hashtags: string[] } {
  const base = path.basename(filename, path.extname(filename)).replace(/[\._-]+/g, ' ').trim();
  const rawWords = base.split(/\s+/).filter(Boolean);
  const nouns = filterFilenameWords(rawWords).slice(0, 6);

  const tone = mediaType === 'video'
    ? [
        'Feel the flow in every rep',
        'Move with intention and energy',
        'Breathe, align, and power up your core',
      ]
    : [
        'Strong posture, calm mind',
        'Precision and control in every line',
        'Find balance and length through mindful movement',
      ];
  const hook = tone[Math.floor(Math.random() * tone.length)];

  const seed = (selectedKeywords && selectedKeywords.length ? selectedKeywords : pickDefaultKeywords(8));
  let hashtags = generateHashtags(seed);

  const core = `Your brand — ${hook}.`;
  const detail = nouns.length ? ` Today we focus on ${nouns.join(', ')}.` : '';
  const cta = mediaType === 'video'
    ? ' Press play and flow with us.'
    : ' Save this for your next studio session.';

  let caption = `${core}${detail}${cta}`.replace(/\s+/g, ' ').trim();
  // Target 150-300 chars: if short, add a supportive line
  if (caption.length < 150) {
    const filler = ' Strength, flexibility, and mindful control come together—your body will thank you.';
    caption = `${caption} ${filler}`.trim();
  }
  if (caption.length > 300) caption = caption.slice(0, 300).trim();

  // Compose final with hashtags on new line
  const hashLine = hashtags.join(' ');
  const final = `${caption}\n${hashLine}`;
  return { caption: final, hashtags };
}

export function generateBatchCaptions(count: number, style: 'short' | 'medium' | 'long', keywords?: string[], urlContent?: string): { caption: string; hashtags: string[] }[] {
  const results: { caption: string; hashtags: string[] }[] = [];
  
  const baseHooks = {
    short: [
      'New post!',
      'Quick tip.',
      'Behind the scenes.',
      'Today’s highlight.',
      'Fresh inspiration.'
    ],
    medium: [
      'Sharing a quick update.',
      'Here’s something new.',
      'Tips and insights for you.',
      'Behind the scenes today.',
      'What do you think?',
      'Let’s make something great.'
    ],
    long: [
      'Here’s a deeper dive into today’s topic.',
      'Thoughts, ideas, and a few takeaways.',
      'Exploring something new with you.',
      'A story worth sharing for your audience.',
      'Let’s connect and create together.'
    ]
  };
  
  const ctaOptions = {
    short: [' Join us!', ' Try it today.', ' Learn more.'],
    medium: [' Save this for later.', ' Ready to dive in?', ' Experience the difference.'],
    long: [' Ready to learn more?', ' Let’s get started.', ' Join our community.']
  };
  
  const hooks = baseHooks[style];
  const ctas = ctaOptions[style];
  
  const desiredMinTags = 10;
  const desiredMaxTags = 15;

  for (let i = 0; i < count; i++) {
    const hook = hooks[Math.floor(Math.random() * hooks.length)];
    const cta = ctas[Math.floor(Math.random() * ctas.length)];
    
    const seed = (keywords && keywords.length ? keywords : pickDefaultKeywords(8));
    let hashtags = generateHashtags(seed);
    // Keep hashtags brand-agnostic (no hardcoded anchors)

    // If urlContent is present, enrich tags with common terms
    if (urlContent) {
      try {
        const words = String(urlContent)
          .toLowerCase()
          .replace(/[^a-z0-9\s#]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length >= 4 && !/^(with|this|that|from|into|your|their|have|been|will|were|which|about|when|what|here|there|they|them|ours|ourselves|yours|you|and|the|for|are|was|has|had|but|not|than|then|into|over|upon|also)$/.test(w));
        const freq: Record<string, number> = {};
        for (const w of words) freq[w] = (freq[w]||0)+1;
        const top = Object.keys(freq).sort((a,b)=> freq[b]-freq[a]).slice(0, 10);
        hashtags = [...hashtags, ...top.map(ensureHashtag)];
      } catch {}
    }
    
    // Add some variation to hashtags
    if (Math.random() > 0.5) {
      hashtags = [...hashtags, ...pickDefaultKeywords(2).map(ensureHashtag)];
    }
    
    // Dedup and normalize hashtags
    const seen = new Set<string>();
    hashtags = hashtags.filter(h => { const k = h.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });

    // Ensure between 10-15 tags by padding with defaults
    if (hashtags.length < desiredMinTags) {
      const pad = pickDefaultKeywords(desiredMinTags - hashtags.length).map(ensureHashtag);
      for (const h of pad) { const k = h.toLowerCase(); if (!seen.has(k)) { hashtags.push(h); seen.add(k); } }
    }
    if (hashtags.length > desiredMaxTags) hashtags = hashtags.slice(0, desiredMaxTags);
    
    let caption = '';
    
    switch (style) {
      case 'short':
        caption = `${hook}${cta}`.trim();
        break;
      case 'medium':
        caption = `${hook}${cta} Sharing ideas and inspiration.`.trim();
        break;
      case 'long':
        caption = `${hook} ${cta} Let’s create something great together.`.trim();
        break;
    }
    
    // Apply length constraints
    if (style === 'short' && caption.length > 100) {
      caption = caption.slice(0, 97) + '...';
    } else if (style === 'medium' && caption.length > 200) {
      caption = caption.slice(0, 197) + '...';
    } else if (style === 'long' && caption.length > 300) {
      caption = caption.slice(0, 297) + '...';
    }
    
    // Compose final with hashtags
    const hashLine = hashtags.join(' ');
    const final = `${caption}\n${hashLine}`;
    
    results.push({ caption: final, hashtags });
  }
  
  return results;
}
