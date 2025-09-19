import path from 'path';
import { pickDefaultKeywords } from './keywords';

export type MediaType = 'image'|'video';

function ensureHashtag(s: string): string { return s.startsWith('#') ? s : ('#' + s.replace(/^#+/,'')); }

function clamp(len: number, min: number, max: number) { return Math.max(min, Math.min(max, len)); }

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

  let hashtags = (selectedKeywords && selectedKeywords.length ? selectedKeywords : pickDefaultKeywords(8))
    .map(ensureHashtag);
  // Dedup and trim to ~10-12 tags max
  const seen = new Set<string>();
  hashtags = hashtags.filter(h => { const k = h.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 12);

  const core = `Live Pilates USA · Miami — ${hook}.`;
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
      'Pilates power!',
      'Find your flow.',
      'Core strength.',
      'Mind-body connection.',
      'Pilates precision.'
    ],
    medium: [
      'Feel the flow in every rep.',
      'Strong posture, calm mind.',
      'Move with intention and energy.',
      'Precision and control in every line.',
      'Breathe, align, and power up your core.',
      'Find balance and length through mindful movement.'
    ],
    long: [
      'Experience the transformative power of Pilates with every mindful movement.',
      'Discover strength, flexibility, and balance through precision-based training.',
      'Connect with your core and unlock your body\'s potential through focused movement.',
      'Build lasting strength and stability with time-tested Pilates principles.',
      'Transform your body and mind through the art of controlled movement.'
    ]
  };
  
  const ctaOptions = {
    short: [' Join us!', ' Try it today.', ' Book now.'],
    medium: [' Save this for your next session.', ' Ready to transform?', ' Experience the difference.'],
    long: [' Ready to experience the Live Pilates USA difference?', ' Book your session and feel the transformation.', ' Join our community of movement enthusiasts.']
  };
  
  const hooks = baseHooks[style];
  const ctas = ctaOptions[style];
  
  const desiredMinTags = 10;
  const desiredMaxTags = 15;

  for (let i = 0; i < count; i++) {
    const hook = hooks[Math.floor(Math.random() * hooks.length)];
    const cta = ctas[Math.floor(Math.random() * ctas.length)];
    
    let hashtags = (keywords && keywords.length ? keywords : pickDefaultKeywords(8))
      .map(ensureHashtag);
    // Always include brand/location anchors
    hashtags = [...hashtags, '#LivePilatesUSA', '#Miami', '#Florida'];

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
        caption = `Live Pilates USA · ${hook}${cta}`.trim();
        break;
      case 'medium':
        caption = `Live Pilates USA · Miami — ${hook}${cta} Strength, flexibility, and mindful control.`.trim();
        break;
      case 'long':
        caption = `Live Pilates USA · Miami — ${hook} Our expertly designed programs blend traditional techniques with modern innovation to deliver results that go beyond the studio.${cta}`.trim();
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
