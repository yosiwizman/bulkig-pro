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

export async function generateBatchCaptions(count: number, style: 'short' | 'medium' | 'long', keywords?: string[], urlContent?: string): Promise<{ caption: string; hashtags: string[] }[]> {
  const results: { caption: string; hashtags: string[] }[] = [];
  
  // Try to use AI for the first few captions if available
  if (process.env.OPENAI_API_KEY && count > 0) {
    try {
      const aiCaption = await import('./ai-caption');
      const aiCount = Math.min(3, count); // Generate up to 3 AI captions
      
      for (let i = 0; i < aiCount; i++) {
        const tones = ['professional', 'casual', 'fun', 'inspirational', 'urgent'] as const;
        const tone = tones[i % tones.length];
        
        const aiResult = await aiCaption.generateAICaption({
          content: urlContent,
          style: style === 'short' ? 'short' : style === 'long' ? 'long' : 'medium',
          tone,
          keywords,
          includeEmojis: true,
          includeCTA: true
        });
        
        if (aiResult) {
          results.push({
            caption: aiResult.caption,
            hashtags: aiResult.hashtags
          });
        }
      }
    } catch (error) {
      console.warn('[CAPTION] AI generation failed, using templates:', error);
    }
  }
  
  // Fill the rest with template-based captions
  const remaining = count - results.length;
  if (remaining <= 0) return results;
  
  // Much more varied hooks based on content categories
  const baseHooks = {
    short: [
      'Experience the difference',
      'New arrivals just dropped',
      'Transform your routine',
      'Discover what\'s possible',
      'Quality meets innovation',
      'Your journey starts here',
      'Elevate your game',
      'Redefine excellence',
      'Built for performance',
      'Designed with purpose'
    ],
    medium: [
      'We\'re excited to share something special with you',
      'Take your practice to the next level',
      'Discover the perfect blend of form and function',
      'Innovation meets tradition in our latest creation',
      'Crafted with care for those who demand excellence',
      'Every detail matters when you\'re building something great',
      'Join thousands who have transformed their journey',
      'See why professionals choose us for their success',
      'Where quality and performance come together',
      'Experience the gold standard in the industry'
    ],
    long: [
      'We\'ve spent months perfecting every detail to bring you something truly special',
      'From concept to creation, discover the story behind our latest innovation',
      'Join us as we redefine what\'s possible in modern fitness and wellness',
      'Years of expertise and passion come together in this remarkable offering',
      'Discover why leading professionals trust us with their most important work',
      'Innovation isn\'t just about what\'s new, it\'s about what truly makes a difference',
      'Every great journey begins with a single step - let us guide yours',
      'Behind every exceptional product is a story of dedication and craft',
      'Transform not just your routine, but your entire approach to excellence',
      'When passion meets precision, extraordinary things happen'
    ]
  };
  
  // More varied CTAs
  const ctaOptions = {
    short: [
      ' Shop now!',
      ' Link in bio.',
      ' DM for info.',
      ' Limited time.',
      ' Don\'t miss out.',
      ' Available today.',
      ' Get yours.',
      ' Learn more.',
      ' Swipe up.',
      ' Tag a friend.'
    ],
    medium: [
      ' Visit our website to explore more.',
      ' Send us a message to get started.',
      ' Click the link in our bio for details.',
      ' Share this with someone who needs it.',
      ' Save this post for future reference.',
      ' Drop a comment with your thoughts.',
      ' Join our community of achievers.',
      ' Experience the difference yourself.',
      ' Let us know what you think below.',
      ' Ready to take the next step?'
    ],
    long: [
      ' Visit our website to discover the full collection and find your perfect match.',
      ' Send us a message today and let\'s discuss how we can help you achieve your goals.',
      ' Click the link in our bio to explore our complete range of solutions.',
      ' Share this with your community and help spread the inspiration.',
      ' Comment below with your experience and join the conversation.',
      ' Book a consultation with our experts and see the difference firsthand.',
      ' Follow our journey for more updates, tips, and exclusive content.',
      ' Join thousands of satisfied customers who have transformed their lives.',
      ' Tag someone who would love this and spread the positive energy.',
      ' Subscribe to our newsletter for exclusive offers and expert insights.'
    ]
  };
  
  // Additional content variations
  const middleContent = {
    short: [
      '',
      ' Premium quality.',
      ' Limited edition.',
      ' Best seller.',
      ' Customer favorite.',
      ' Award winning.',
      ' Handcrafted excellence.',
      ' Sustainably made.',
      ' Innovation defined.',
      ' Performance driven.'
    ],
    medium: [
      ' Designed for those who refuse to compromise.',
      ' Where innovation meets everyday excellence.',
      ' Trusted by professionals worldwide.',
      ' Crafted with precision and care.',
      ' Setting new standards in the industry.',
      ' Your success is our mission.',
      ' Quality you can see and feel.',
      ' Making the impossible possible.',
      ' Built to exceed expectations.',
      ' Transforming visions into reality.'
    ],
    long: [
      ' Our team of experts has carefully crafted each element to ensure maximum impact and lasting results.',
      ' Drawing from years of research and customer feedback, we\'ve created something truly revolutionary.',
      ' This isn\'t just a product - it\'s a commitment to excellence and a promise of transformation.',
      ' We believe in empowering our community with tools and knowledge that make a real difference.',
      ' Every aspect has been thoughtfully designed to enhance your experience and exceed expectations.',
      ' Join a growing movement of individuals who refuse to settle for anything less than extraordinary.',
      ' Our commitment to quality and innovation has made us the trusted choice for discerning customers.',
      ' Experience the perfect balance of form, function, and forward-thinking design.',
      ' This is more than a purchase - it\'s an investment in your future success and well-being.',
      ' Discover why industry leaders consistently choose us as their partner in excellence.'
    ]
  };
  
  const hooks = baseHooks[style];
  const ctas = ctaOptions[style];
  const middles = middleContent[style];
  
  const desiredMinTags = 8;
  const desiredMaxTags = 12;

  for (let i = 0; i < remaining; i++) {
    // Use different hooks/ctas for each caption to ensure uniqueness
    const hookIndex = i % hooks.length;
    const ctaIndex = i % ctas.length;
    const middleIndex = i % middles.length;
    
    const hook = hooks[hookIndex];
    const cta = ctas[ctaIndex];
    const middle = middles[middleIndex];
    
    // Vary the seed keywords to create different hashtag combinations
    const seedVariation = i % 3; // Create 3 different hashtag patterns
    const baseSeed = (keywords && keywords.length ? keywords : pickDefaultKeywords(5));
    const extraSeed = pickDefaultKeywords(3 + seedVariation);
    const seed = [...baseSeed, ...extraSeed];
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
    
    // Create unique captions by varying the structure
    const variation = i % 4;
    
    switch (style) {
      case 'short':
        if (variation === 0) caption = `${hook}. ${middle}${cta}`.trim();
        else if (variation === 1) caption = `${middle} ${hook}.${cta}`.trim();
        else if (variation === 2) caption = `${hook}!${cta}`.trim();
        else caption = `${hook}. ${middle.trim() ? middle : 'Amazing.'}${cta}`.trim();
        break;
      case 'medium':
        if (variation === 0) caption = `${hook}. ${middle}${cta}`.trim();
        else if (variation === 1) caption = `${hook}! ${middle} ${cta}`.trim();
        else if (variation === 2) caption = `${middle} ${hook}. ${cta}`.trim();
        else caption = `${hook}. ${middle ? middle + '.' : ''} ${cta}`.trim();
        break;
      case 'long':
        if (variation === 0) caption = `${hook}. ${middle} ${cta}`.trim();
        else if (variation === 1) caption = `${hook}! \n\n${middle} \n\n${cta}`.trim();
        else if (variation === 2) caption = `${middle} \n\n${hook}. ${cta}`.trim();
        else caption = `${hook}. \n\n${middle} \n\n${cta}`.trim();
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
