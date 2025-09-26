import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

interface AnalyzedContent {
  title: string;
  description: string;
  keywords: string[];
  products: string[];
  services: string[];
  features: string[];
  benefits: string[];
  callToAction: string;
  brand: string;
  industry: string;
  tone: string;
  mainText: string;
  imageAlt: string[];
  prices: string[];
}

interface CaptionRequest {
  url?: string;
  content?: string;
  style?: 'short' | 'medium' | 'long' | 'story';
  tone?: 'professional' | 'casual' | 'fun' | 'inspirational' | 'urgent';
  includeEmojis?: boolean;
  includeCTA?: boolean;
  keywords?: string[];
  brandName?: string;
  productName?: string;
  igUsername?: string; // Instagram account to mimic style from
}

interface GeneratedCaption {
  caption: string;
  hashtags: string[];
  characterCount: number;
  style: string;
}

// Enhanced URL content analysis
export async function analyzeUrlContent(url: string): Promise<AnalyzedContent> {
  const result: AnalyzedContent = {
    title: '',
    description: '',
    keywords: [],
    products: [],
    services: [],
    features: [],
    benefits: [],
    callToAction: '',
    brand: '',
    industry: '',
    tone: 'professional',
    mainText: '',
    imageAlt: [],
    prices: []
  };

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove scripts and styles
    $('script, style, noscript').remove();

    // Extract metadata
    result.title = $('title').text() || $('h1').first().text() || '';
    result.description = $('meta[name="description"]').attr('content') || 
                        $('meta[property="og:description"]').attr('content') || '';
    
    const keywordsStr = $('meta[name="keywords"]').attr('content') || '';
    result.keywords = keywordsStr.split(',').map(k => k.trim()).filter(Boolean);

    // Extract Open Graph data
    const ogTitle = $('meta[property="og:title"]').attr('content');
    const ogSiteName = $('meta[property="og:site_name"]').attr('content');
    if (ogSiteName) result.brand = ogSiteName;

    // Extract product schema data
    const productSchema = $('script[type="application/ld+json"]').text();
    if (productSchema) {
      try {
        const schema = JSON.parse(productSchema);
        if (schema['@type'] === 'Product' || schema.product) {
          const product = schema.product || schema;
          if (product.name) result.products.push(product.name);
          if (product.description) result.mainText = product.description;
          if (product.offers?.price) result.prices.push(`${product.offers.priceCurrency || '$'}${product.offers.price}`);
        }
      } catch {}
    }

    // Extract headings for features/services
    $('h2, h3').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length < 100) {
        // Categorize based on content
        const lower = text.toLowerCase();
        if (lower.includes('feature') || lower.includes('benefit')) {
          result.features.push(text);
        } else if (lower.includes('service') || lower.includes('solution')) {
          result.services.push(text);
        }
      }
    });

    // Extract product names from specific patterns
    $('.product-name, .product-title, [class*="product-name"], [class*="product-title"]').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length < 100 && !result.products.includes(text)) {
        result.products.push(text);
      }
    });

    // Extract features from lists
    $('ul li, .feature-list li, .benefits li').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length < 100) {
        if (text.toLowerCase().includes('free') || text.includes('✓') || text.includes('✔')) {
          result.benefits.push(text.replace(/[✓✔]/g, '').trim());
        } else {
          result.features.push(text);
        }
      }
    });

    // Extract CTAs
    $('button, .cta, .btn-primary, [class*="cta"], [class*="call-to-action"]').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length < 50) {
        const lower = text.toLowerCase();
        if (lower.includes('buy') || lower.includes('shop') || lower.includes('order') || 
            lower.includes('get') || lower.includes('start') || lower.includes('learn')) {
          result.callToAction = text;
          return false; // Break after first CTA
        }
      }
    });

    // Extract image alt texts for context
    $('img[alt]').each((_, el) => {
      const alt = $(el).attr('alt');
      if (alt && alt.length > 5 && alt.length < 100) {
        result.imageAlt.push(alt);
      }
    });

    // Extract main text content
    const paragraphs: string[] = [];
    $('p, .description, .content, article').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 50 && text.length < 500) {
        paragraphs.push(text);
      }
    });
    result.mainText = paragraphs.slice(0, 3).join(' ').slice(0, 1000);

    // Extract prices
    const pricePatterns = /\$[\d,]+\.?\d*|\d+\.?\d*\s*(?:USD|EUR|GBP)|(?:USD|EUR|GBP)\s*\d+\.?\d*/gi;
    const bodyText = $('body').text();
    const priceMatches = bodyText.match(pricePatterns);
    if (priceMatches) {
      result.prices.push(...priceMatches.slice(0, 5));
    }

    // Determine industry based on keywords
    const allText = `${result.title} ${result.description} ${result.keywords.join(' ')} ${result.mainText}`.toLowerCase();
    if (allText.includes('fashion') || allText.includes('clothing') || allText.includes('apparel')) {
      result.industry = 'fashion';
    } else if (allText.includes('fitness') || allText.includes('gym') || allText.includes('workout') || allText.includes('pilates')) {
      result.industry = 'fitness';
    } else if (allText.includes('beauty') || allText.includes('cosmetic') || allText.includes('skincare')) {
      result.industry = 'beauty';
    } else if (allText.includes('tech') || allText.includes('software') || allText.includes('app')) {
      result.industry = 'technology';
    } else if (allText.includes('food') || allText.includes('restaurant') || allText.includes('recipe')) {
      result.industry = 'food';
    } else if (allText.includes('travel') || allText.includes('hotel') || allText.includes('vacation')) {
      result.industry = 'travel';
    } else {
      result.industry = 'general';
    }

    // Determine tone
    if (allText.includes('exclusive') || allText.includes('luxury') || allText.includes('premium')) {
      result.tone = 'professional';
    } else if (allText.includes('fun') || allText.includes('exciting') || allText.includes('awesome')) {
      result.tone = 'fun';
    } else if (allText.includes('inspire') || allText.includes('transform') || allText.includes('journey')) {
      result.tone = 'inspirational';
    } else if (allText.includes('limited') || allText.includes('hurry') || allText.includes('now')) {
      result.tone = 'urgent';
    } else {
      result.tone = 'casual';
    }

    // Clean up duplicates
    result.products = [...new Set(result.products)].slice(0, 10);
    result.services = [...new Set(result.services)].slice(0, 10);
    result.features = [...new Set(result.features)].slice(0, 15);
    result.benefits = [...new Set(result.benefits)].slice(0, 10);
    result.imageAlt = [...new Set(result.imageAlt)].slice(0, 10);

  } catch (error) {
    console.error('[AI-CAPTION] Error analyzing URL:', error);
  }

  return result;
}

// Generate caption using OpenAI GPT
export async function generateAICaption(
  request: CaptionRequest,
  apiKey?: string
): Promise<GeneratedCaption | null> {
  const openaiKey = apiKey || process.env.OPENAI_API_KEY;
  
  if (!openaiKey) {
    console.warn('[AI-CAPTION] No OpenAI API key configured');
    return null;
  }

  try {
    // Analyze URL if provided
    let analyzedContent: AnalyzedContent | null = null;
    if (request.url) {
      analyzedContent = await analyzeUrlContent(request.url);
    }

    // Analyze Instagram account style if provided
    let igStyle: any = null;
    if (request.igUsername) {
      try {
        const { getOrAnalyzeProfile } = await import('./ig-style-analyzer');
        const profileAnalysis = await getOrAnalyzeProfile(request.igUsername);
        if (profileAnalysis) {
          igStyle = profileAnalysis.style;
          console.log(`[AI-CAPTION] Using style from @${request.igUsername}:`, {
            tone: igStyle.tone,
            length: igStyle.captionLength,
            emojiUsage: igStyle.emojiUsage,
            hashtagCount: igStyle.hashtagCount
          });
        }
      } catch (error) {
        console.warn('[AI-CAPTION] Failed to analyze IG style:', error);
      }
    }

    // Build context for GPT
    const context = buildContextFromAnalysis(analyzedContent, request, igStyle);
    
    // Create prompt for GPT
    const prompt = createCaptionPrompt(context, request, igStyle);

    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert social media content creator specializing in Instagram captions. Create engaging, conversion-focused captions that drive engagement and sales. Always include relevant emojis and hashtags.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.8,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[AI-CAPTION] OpenAI API error:', error);
      return null;
    }

    const data = await response.json();
    const generatedText = data.choices[0]?.message?.content || '';

    // Parse caption and hashtags
    const lines = generatedText.split('\n');
    let caption = '';
    const hashtags: string[] = [];

    for (const line of lines) {
      if (line.includes('#')) {
        // Extract hashtags from this line
        const tags = line.match(/#\w+/g) || [];
        hashtags.push(...tags);
        // Add the line to caption without hashtags for cleaner text
        caption += line.replace(/#\w+/g, '').trim() + '\n';
      } else {
        caption += line + '\n';
      }
    }

    // Clean up caption
    caption = caption.trim();
    
    // Ensure we have enough hashtags
    const uniqueHashtags = [...new Set(hashtags)];
    if (uniqueHashtags.length < 10 && analyzedContent) {
      // Add more hashtags based on analysis
      const additionalTags = generateHashtagsFromContent(analyzedContent, request);
      uniqueHashtags.push(...additionalTags);
    }

    return {
      caption: caption + '\n\n' + uniqueHashtags.slice(0, 30).join(' '),
      hashtags: uniqueHashtags.slice(0, 30),
      characterCount: caption.length,
      style: request.style || 'medium'
    };

  } catch (error) {
    console.error('[AI-CAPTION] Error generating caption:', error);
    return null;
  }
}

function buildContextFromAnalysis(
  analyzed: AnalyzedContent | null,
  request: CaptionRequest,
  igStyle?: any
): string {
  const parts: string[] = [];

  if (request.brandName) {
    parts.push(`Brand: ${request.brandName}`);
  } else if (analyzed?.brand) {
    parts.push(`Brand: ${analyzed.brand}`);
  }

  if (request.productName) {
    parts.push(`Product: ${request.productName}`);
  } else if (analyzed?.products.length) {
    parts.push(`Products: ${analyzed.products.slice(0, 3).join(', ')}`);
  }

  if (analyzed?.features.length) {
    parts.push(`Key Features: ${analyzed.features.slice(0, 5).join(', ')}`);
  }

  if (analyzed?.benefits.length) {
    parts.push(`Benefits: ${analyzed.benefits.slice(0, 3).join(', ')}`);
  }

  if (analyzed?.prices.length) {
    parts.push(`Price: ${analyzed.prices[0]}`);
  }

  if (analyzed?.callToAction) {
    parts.push(`CTA: ${analyzed.callToAction}`);
  }

  if (analyzed?.industry) {
    parts.push(`Industry: ${analyzed.industry}`);
  }

  if (request.keywords?.length) {
    parts.push(`Keywords: ${request.keywords.join(', ')}`);
  } else if (analyzed?.keywords.length) {
    parts.push(`Keywords: ${analyzed.keywords.slice(0, 5).join(', ')}`);
  }

  if (analyzed?.mainText) {
    parts.push(`Description: ${analyzed.mainText.slice(0, 200)}`);
  }

  // Add Instagram style context
  if (igStyle) {
    parts.push(`\nInstagram Style Reference:`);
    parts.push(`Caption Length: ${igStyle.captionLength}`);
    parts.push(`Tone: ${igStyle.tone}`);
    parts.push(`Emoji Usage: ${igStyle.emojiUsage}`);
    parts.push(`Hashtag Count: ${igStyle.hashtagCount}`);
    parts.push(`Hashtag Placement: ${igStyle.hashtagPlacement}`);
    if (igStyle.commonWords?.length) {
      parts.push(`Common Words: ${igStyle.commonWords.slice(0, 10).join(', ')}`);
    }
    if (igStyle.ctaStyle?.length) {
      parts.push(`CTA Style: ${igStyle.ctaStyle.slice(0, 3).join(', ')}`);
    }
    if (igStyle.postingPatterns) {
      const patterns = [];
      if (igStyle.postingPatterns.questionUsage) patterns.push('uses questions');
      if (igStyle.postingPatterns.storyTelling) patterns.push('tells stories');
      if (igStyle.postingPatterns.listFormat) patterns.push('uses lists');
      if (patterns.length) parts.push(`Patterns: ${patterns.join(', ')}`);
    }
  }

  return parts.join('\n');
}

function createCaptionPrompt(context: string, request: CaptionRequest, igStyle?: any): string {
  // Use IG style if available, otherwise use request values
  const style = igStyle?.captionLength || request.style || 'medium';
  const tone = igStyle?.tone || request.tone || 'casual';
  const includeEmojis = igStyle ? igStyle.emojiUsage !== 'none' : request.includeEmojis !== false;
  const includeCTA = igStyle ? igStyle.ctaStyle?.length > 0 : request.includeCTA !== false;

  let lengthGuide = '';
  let styleGuide = '';

  switch (style) {
    case 'short':
      lengthGuide = '50-100 characters';
      styleGuide = 'very concise and punchy';
      break;
    case 'medium':
      lengthGuide = '150-300 characters';
      styleGuide = 'balanced and engaging';
      break;
    case 'long':
      lengthGuide = '400-600 characters';
      styleGuide = 'detailed and storytelling';
      break;
    case 'story':
      lengthGuide = '300-500 characters';
      styleGuide = 'narrative and immersive';
      break;
  }

  let toneGuide = '';
  switch (tone) {
    case 'professional':
      toneGuide = 'professional, authoritative, and trustworthy';
      break;
    case 'casual':
      toneGuide = 'friendly, approachable, and conversational';
      break;
    case 'fun':
      toneGuide = 'playful, energetic, and entertaining';
      break;
    case 'inspirational':
      toneGuide = 'motivating, uplifting, and empowering';
      break;
    case 'urgent':
      toneGuide = 'urgent, time-sensitive, and action-driven';
      break;
  }

  let styleInstructions = '';
  if (igStyle) {
    styleInstructions = `\n\nIMPORTANT: Mimic the following Instagram account style:
- Use ${igStyle.emojiUsage} emoji usage (${igStyle.commonEmojis?.slice(0, 5).join(' ') || 'standard emojis'})
- Include exactly ${igStyle.hashtagCount} hashtags at the ${igStyle.hashtagPlacement}
- Line breaks: ${igStyle.lineBreakUsage}
${igStyle.commonWords?.length ? `- Frequently use these words: ${igStyle.commonWords.slice(0, 8).join(', ')}` : ''}
${igStyle.ctaStyle?.length ? `- Use CTAs like: ${igStyle.ctaStyle.slice(0, 3).join(', ')}` : ''}
${igStyle.postingPatterns?.questionUsage ? '- Include a question to encourage engagement' : ''}
${igStyle.postingPatterns?.storyTelling ? '- Tell a brief story or anecdote' : ''}
${igStyle.postingPatterns?.listFormat ? '- Format as a list with bullets or numbers' : ''}
${igStyle.brandMentions?.length ? `- Mention: ${igStyle.brandMentions.slice(0, 3).join(', ')}` : ''}`;
  }

  const hashtagRequirements = igStyle ? 
    `- Include exactly ${igStyle.hashtagCount} hashtags
- Place hashtags: ${igStyle.hashtagPlacement === 'end' ? 'at the end in a block' : igStyle.hashtagPlacement === 'inline' ? 'throughout the caption' : 'mixed throughout and at end'}
${igStyle.commonHashtags?.length ? `- Include these hashtags: ${igStyle.commonHashtags.slice(0, 10).join(' ')}` : ''}` :
    `- Include 25-30 highly relevant hashtags
- Mix of: niche-specific (5-7), medium-reach (10-12), and broad-reach (8-10) tags
- Include trending hashtags if relevant
- Format hashtags on separate lines at the end`;

  const emojiGuide = igStyle ? 
    (igStyle.emojiUsage === 'none' ? '- No emojis' :
     igStyle.emojiUsage === 'minimal' ? '- Include 1-2 emojis max' :
     igStyle.emojiUsage === 'moderate' ? '- Include 3-5 emojis' :
     '- Use many emojis (6+ throughout)') :
    (includeEmojis ? '- Include 3-5 relevant emojis throughout the caption' : '- No emojis');

  const prompt = `Create an Instagram caption with the following requirements:

Context:
${context}

Style Requirements:
- Length: ${lengthGuide}
- Style: ${styleGuide}
- Tone: ${toneGuide}
${emojiGuide}
${includeCTA ? '- Include a clear call-to-action' : ''}
${styleInstructions}

Caption Structure:
1. Hook: Start with an attention-grabbing opening
2. Value: Highlight the main benefit or feature
3. Story/Context: Add relatable context or mini-story
${includeCTA ? '4. CTA: End with clear action step' : ''}

Hashtag Requirements:
${hashtagRequirements}

Additional Guidelines:
- Use line breaks for readability
- Create FOMO or urgency if appropriate
- Make it shareable and save-worthy
- Optimize for Instagram algorithm (encourage comments)
- Sound authentic and human, not salesy
${igStyle ? '- IMPORTANT: Match the analyzed Instagram account\'s writing style exactly' : ''}

Generate the caption now:`;

  return prompt;
}

function generateHashtagsFromContent(
  analyzed: AnalyzedContent,
  request: CaptionRequest
): string[] {
  const hashtags: string[] = [];

  // Industry-specific hashtags
  const industryTags: Record<string, string[]> = {
    fitness: ['#fitness', '#workout', '#gym', '#fitfam', '#fitspo', '#training', '#fitnessmotivation', '#healthylifestyle', '#exercise', '#getfit'],
    fashion: ['#fashion', '#style', '#ootd', '#fashionista', '#instafashion', '#fashionblogger', '#outfitoftheday', '#fashionstyle', '#styleinspo', '#fashionable'],
    beauty: ['#beauty', '#skincare', '#makeup', '#beautytips', '#glowup', '#skincareroutine', '#beautyblogger', '#makeuptutorial', '#beautylover', '#selfcare'],
    technology: ['#tech', '#technology', '#innovation', '#techie', '#gadgets', '#startup', '#software', '#ai', '#digital', '#futuretech'],
    food: ['#foodie', '#foodstagram', '#foodlover', '#instafood', '#foodporn', '#yummy', '#delicious', '#foodblogger', '#recipe', '#homecooking'],
    travel: ['#travel', '#wanderlust', '#travelgram', '#instatravel', '#travelphotography', '#explore', '#adventure', '#vacation', '#traveling', '#travelblogger'],
    general: ['#instagood', '#photooftheday', '#love', '#beautiful', '#happy', '#picoftheday', '#instadaily', '#followme', '#instalike', '#lifestyle']
  };

  // Add industry tags
  const industry = analyzed.industry || 'general';
  hashtags.push(...(industryTags[industry] || industryTags.general));

  // Add product-based hashtags
  if (analyzed.products.length > 0) {
    analyzed.products.slice(0, 3).forEach(product => {
      const clean = product.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (clean) {
        hashtags.push(`#${clean}`);
      }
    });
  }

  // Add feature-based hashtags
  if (analyzed.features.length > 0) {
    analyzed.features.slice(0, 3).forEach(feature => {
      const words = feature.toLowerCase().split(' ');
      if (words[0] && words[0].length > 3) {
        hashtags.push(`#${words[0].replace(/[^a-z0-9]/g, '')}`);
      }
    });
  }

  // Add keyword-based hashtags
  if (request.keywords?.length) {
    request.keywords.forEach(kw => {
      const clean = kw.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (clean) {
        hashtags.push(`#${clean}`);
      }
    });
  }

  // Add brand hashtag
  if (request.brandName || analyzed.brand) {
    const brand = (request.brandName || analyzed.brand).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (brand) {
      hashtags.push(`#${brand}`);
    }
  }

  // Add trending general hashtags
  const trending = ['#viral', '#explore', '#trending', '#reels', '#instareels', '#reelsinstagram', '#explorepage', '#fyp', '#foryou', '#instagram'];
  hashtags.push(...trending);

  // Return unique hashtags
  return [...new Set(hashtags)].filter(tag => tag.length > 2 && tag.length < 30);
}

// Fallback caption generation without AI
export function generateFallbackCaption(
  analyzed: AnalyzedContent | null,
  request: CaptionRequest
): GeneratedCaption {
  const style = request.style || 'medium';
  const includeEmojis = request.includeEmojis !== false;
  
  let caption = '';
  
  // Build caption based on style
  if (style === 'short') {
    if (analyzed?.products[0]) {
      caption = `${analyzed.products[0]} is here! ${includeEmojis ? '🎉' : ''}`;
    } else {
      caption = `Discover something amazing ${includeEmojis ? '✨' : ''}`;
    }
  } else if (style === 'long' || style === 'story') {
    const parts: string[] = [];
    
    if (analyzed?.products[0]) {
      parts.push(`Introducing ${analyzed.products[0]} ${includeEmojis ? '🌟' : ''}`);
    } else {
      parts.push(`Something special for you ${includeEmojis ? '💫' : ''}`);
    }
    
    if (analyzed?.features[0]) {
      parts.push(`\n\nFeaturing: ${analyzed.features.slice(0, 3).join(', ')}`);
    }
    
    if (analyzed?.benefits[0]) {
      parts.push(`\n\n${includeEmojis ? '✓' : '-'} ${analyzed.benefits.slice(0, 2).join(`\n${includeEmojis ? '✓' : '-'} `)}`);
    }
    
    if (request.includeCTA !== false) {
      if (analyzed?.callToAction) {
        parts.push(`\n\n${analyzed.callToAction} ${includeEmojis ? '👉' : ''}`);
      } else {
        parts.push(`\n\nShop now via link in bio ${includeEmojis ? '🔗' : ''}`);
      }
    }
    
    caption = parts.join('');
  } else { // medium
    const hook = analyzed?.products[0] ? 
      `Check out our ${analyzed.products[0]}` : 
      'Your new favorite has arrived';
    
    const benefit = analyzed?.benefits[0] || analyzed?.features[0] || 'Quality you deserve';
    
    caption = `${hook} ${includeEmojis ? '✨' : ''}\n\n${benefit}`;
    
    if (request.includeCTA !== false) {
      caption += `\n\n${analyzed?.callToAction || 'Available now - link in bio'} ${includeEmojis ? '🔗' : ''}`;
    }
  }
  
  // Generate hashtags
  const hashtags = generateHashtagsFromContent(analyzed || {} as AnalyzedContent, request);
  
  // Combine caption with hashtags
  const finalCaption = `${caption}\n\n${hashtags.slice(0, 25).join(' ')}`;
  
  return {
    caption: finalCaption,
    hashtags: hashtags.slice(0, 25),
    characterCount: caption.length,
    style
  };
}