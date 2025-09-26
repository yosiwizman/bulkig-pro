import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { addLog } from './logger';

export interface IGPostStyle {
  username: string;
  captionLength: 'short' | 'medium' | 'long';
  emojiUsage: 'none' | 'minimal' | 'moderate' | 'heavy';
  hashtagCount: number;
  hashtagPlacement: 'inline' | 'end' | 'mixed';
  tone: 'professional' | 'casual' | 'fun' | 'inspirational' | 'mixed';
  commonWords: string[];
  commonHashtags: string[];
  commonEmojis: string[];
  lineBreakUsage: 'none' | 'minimal' | 'frequent';
  ctaStyle: string[];
  brandMentions: string[];
  avgEngagementTopics: string[];
  postingPatterns: {
    questionUsage: boolean;
    storyTelling: boolean;
    listFormat: boolean;
    quotesUsage: boolean;
    capsUsage: 'none' | 'minimal' | 'moderate' | 'heavy';
  };
}

export interface IGProfileAnalysis {
  profile: {
    username: string;
    fullName: string;
    bio: string;
    isVerified: boolean;
    followerCount: number;
    postCount: number;
    category: string;
  };
  style: IGPostStyle;
  contentThemes: string[];
  bestPerformingTypes: string[];
  sampleCaptions: string[];
}

// Analyze Instagram profile using web scraping
export async function analyzeInstagramProfile(username: string): Promise<IGProfileAnalysis | null> {
  try {
    addLog('info', `[IG-ANALYZER] Starting analysis for @${username}`);
    
    // Try multiple methods to get Instagram data
    const analysis = await tryAnalyzeMethods(username);
    
    if (!analysis) {
      addLog('warn', `[IG-ANALYZER] Could not analyze @${username}`);
      return null;
    }
    
    addLog('info', `[IG-ANALYZER] Successfully analyzed @${username}`, { 
      postCount: analysis.sampleCaptions.length,
      tone: analysis.style.tone 
    });
    
    return analysis;
  } catch (error: any) {
    addLog('error', '[IG-ANALYZER] Analysis failed', { error: error?.message || error });
    return null;
  }
}

async function tryAnalyzeMethods(username: string): Promise<IGProfileAnalysis | null> {
  // Method 1: Try public web interface
  const webAnalysis = await analyzeViaWeb(username);
  if (webAnalysis) return webAnalysis;
  
  // Method 2: Try alternative endpoints
  const apiAnalysis = await analyzeViaAPI(username);
  if (apiAnalysis) return apiAnalysis;
  
  // Method 3: Use cached/example data for demonstration
  return getFallbackAnalysis(username);
}

async function analyzeViaWeb(username: string): Promise<IGProfileAnalysis | null> {
  try {
    const url = `https://www.instagram.com/${username}/`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'no-cache',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 10000
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Try to extract data from various possible script tags
    let profileData: any = null;
    
    $('script').each((_, el) => {
      const scriptContent = $(el).html();
      if (scriptContent && scriptContent.includes('window._sharedData')) {
        try {
          const match = scriptContent.match(/window\._sharedData\s*=\s*({.+?});/);
          if (match) {
            const data = JSON.parse(match[1]);
            profileData = extractProfileFromSharedData(data, username);
          }
        } catch {}
      }
    });
    
    // Try meta tags as fallback
    if (!profileData) {
      profileData = extractFromMetaTags($, username);
    }
    
    if (!profileData) {
      return null;
    }
    
    return profileData;
  } catch (error) {
    console.error('[IG-ANALYZER] Web analysis error:', error);
    return null;
  }
}

async function analyzeViaAPI(username: string): Promise<IGProfileAnalysis | null> {
  try {
    // Try Instagram's public GraphQL endpoint
    const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Instagram 76.0.0.15.395 Android (24/7.0; 640dpi; 1440x2560; samsung; SM-G930F; herolte; samsungexynos8890)',
        'X-IG-App-ID': '936619743392459'
      },
      timeout: 10000
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (!data?.data?.user) {
      return null;
    }

    const user = data.data.user;
    const posts = user.edge_owner_to_timeline_media?.edges || [];
    
    // Extract captions from posts
    const captions = posts
      .map((post: any) => post.node?.edge_media_to_caption?.edges?.[0]?.node?.text)
      .filter(Boolean)
      .slice(0, 20); // Analyze up to 20 recent posts
    
    return analyzeExtractedData({
      username: user.username,
      fullName: user.full_name,
      bio: user.biography,
      isVerified: user.is_verified,
      followerCount: user.edge_followed_by?.count || 0,
      postCount: user.edge_owner_to_timeline_media?.count || 0,
      category: user.category_name || 'General',
      captions
    });
  } catch (error) {
    console.error('[IG-ANALYZER] API analysis error:', error);
    return null;
  }
}

function extractProfileFromSharedData(data: any, username: string): IGProfileAnalysis | null {
  try {
    const user = data?.entry_data?.ProfilePage?.[0]?.graphql?.user;
    if (!user) return null;
    
    const posts = user.edge_owner_to_timeline_media?.edges || [];
    const captions = posts
      .map((post: any) => post.node?.edge_media_to_caption?.edges?.[0]?.node?.text)
      .filter(Boolean)
      .slice(0, 20);
    
    return analyzeExtractedData({
      username: user.username,
      fullName: user.full_name,
      bio: user.biography,
      isVerified: user.is_verified,
      followerCount: user.edge_followed_by?.count || 0,
      postCount: user.edge_owner_to_timeline_media?.count || 0,
      category: user.category_name || 'General',
      captions
    });
  } catch {
    return null;
  }
}

function extractFromMetaTags($: cheerio.CheerioAPI, username: string): IGProfileAnalysis | null {
  try {
    const title = $('meta[property="og:title"]').attr('content') || '';
    const description = $('meta[property="og:description"]').attr('content') || '';
    
    // Extract follower count from description
    const followerMatch = description.match(/([0-9,]+)\s*Followers/i);
    const postMatch = description.match(/([0-9,]+)\s*Posts/i);
    
    return {
      profile: {
        username,
        fullName: title.split('(')[0].trim(),
        bio: description,
        isVerified: title.includes('✓'),
        followerCount: followerMatch ? parseInt(followerMatch[1].replace(/,/g, '')) : 0,
        postCount: postMatch ? parseInt(postMatch[1].replace(/,/g, '')) : 0,
        category: 'General'
      },
      style: getDefaultStyle(),
      contentThemes: [],
      bestPerformingTypes: [],
      sampleCaptions: []
    };
  } catch {
    return null;
  }
}

function analyzeExtractedData(data: {
  username: string;
  fullName: string;
  bio: string;
  isVerified: boolean;
  followerCount: number;
  postCount: number;
  category: string;
  captions: string[];
}): IGProfileAnalysis {
  const style = analyzeCaptionStyle(data.captions);
  const themes = extractContentThemes(data.captions);
  
  return {
    profile: {
      username: data.username,
      fullName: data.fullName,
      bio: data.bio,
      isVerified: data.isVerified,
      followerCount: data.followerCount,
      postCount: data.postCount,
      category: data.category
    },
    style,
    contentThemes: themes,
    bestPerformingTypes: detectBestPerformingTypes(data.captions),
    sampleCaptions: data.captions.slice(0, 5)
  };
}

function analyzeCaptionStyle(captions: string[]): IGPostStyle {
  if (!captions || captions.length === 0) {
    return getDefaultStyle();
  }
  
  // Analyze caption lengths
  const lengths = captions.map(c => c.length);
  const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  
  // Determine caption length category
  let captionLength: 'short' | 'medium' | 'long';
  if (avgLength < 100) captionLength = 'short';
  else if (avgLength < 300) captionLength = 'medium';
  else captionLength = 'long';
  
  // Analyze emoji usage
  const emojiCounts = captions.map(c => (c.match(/[\u{1F600}-\u{1F6FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu) || []).length);
  const avgEmojis = emojiCounts.reduce((a, b) => a + b, 0) / emojiCounts.length;
  
  let emojiUsage: 'none' | 'minimal' | 'moderate' | 'heavy';
  if (avgEmojis === 0) emojiUsage = 'none';
  else if (avgEmojis < 2) emojiUsage = 'minimal';
  else if (avgEmojis < 5) emojiUsage = 'moderate';
  else emojiUsage = 'heavy';
  
  // Analyze hashtags
  const hashtagCounts = captions.map(c => (c.match(/#\w+/g) || []).length);
  const avgHashtags = Math.round(hashtagCounts.reduce((a, b) => a + b, 0) / hashtagCounts.length);
  
  // Extract common hashtags
  const allHashtags: string[] = [];
  captions.forEach(c => {
    const tags = c.match(/#\w+/g) || [];
    allHashtags.push(...tags);
  });
  
  const hashtagFreq: Record<string, number> = {};
  allHashtags.forEach(tag => {
    hashtagFreq[tag] = (hashtagFreq[tag] || 0) + 1;
  });
  
  const commonHashtags = Object.entries(hashtagFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([tag]) => tag);
  
  // Analyze hashtag placement
  let hashtagPlacement: 'inline' | 'end' | 'mixed' = 'end';
  const endHashtagCount = captions.filter(c => {
    const lastLine = c.split('\n').pop() || '';
    return lastLine.includes('#');
  }).length;
  
  if (endHashtagCount > captions.length * 0.7) {
    hashtagPlacement = 'end';
  } else if (endHashtagCount < captions.length * 0.3) {
    hashtagPlacement = 'inline';
  } else {
    hashtagPlacement = 'mixed';
  }
  
  // Analyze tone
  const tone = analyzeTone(captions);
  
  // Extract common words (excluding stop words)
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'we', 'they', 'he', 'she', 'it', 'my', 'your', 'our', 'their']);
  
  const wordFreq: Record<string, number> = {};
  captions.forEach(caption => {
    const words = caption.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/);
    words.forEach(word => {
      if (word.length > 3 && !stopWords.has(word)) {
        wordFreq[word] = (wordFreq[word] || 0) + 1;
      }
    });
  });
  
  const commonWords = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word]) => word);
  
  // Extract common emojis
  const emojiFreq: Record<string, number> = {};
  captions.forEach(caption => {
    const emojis = caption.match(/[\u{1F600}-\u{1F6FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu) || [];
    emojis.forEach(emoji => {
      emojiFreq[emoji] = (emojiFreq[emoji] || 0) + 1;
    });
  });
  
  const commonEmojis = Object.entries(emojiFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([emoji]) => emoji);
  
  // Analyze line breaks
  const lineBreakCounts = captions.map(c => (c.match(/\n/g) || []).length);
  const avgLineBreaks = lineBreakCounts.reduce((a, b) => a + b, 0) / lineBreakCounts.length;
  
  let lineBreakUsage: 'none' | 'minimal' | 'frequent';
  if (avgLineBreaks < 1) lineBreakUsage = 'none';
  else if (avgLineBreaks < 3) lineBreakUsage = 'minimal';
  else lineBreakUsage = 'frequent';
  
  // Extract CTAs
  const ctaPatterns = [
    /link in bio/i,
    /shop now/i,
    /swipe up/i,
    /comment below/i,
    /dm for/i,
    /tag a friend/i,
    /double tap/i,
    /save this/i,
    /share with/i,
    /click the link/i
  ];
  
  const ctaStyles: string[] = [];
  captions.forEach(caption => {
    ctaPatterns.forEach(pattern => {
      const match = caption.match(pattern);
      if (match && !ctaStyles.includes(match[0])) {
        ctaStyles.push(match[0]);
      }
    });
  });
  
  // Analyze posting patterns
  const postingPatterns = {
    questionUsage: captions.filter(c => c.includes('?')).length > captions.length * 0.3,
    storyTelling: captions.filter(c => c.length > 200).length > captions.length * 0.3,
    listFormat: captions.filter(c => /\d\.|•|✓|→/g.test(c)).length > captions.length * 0.2,
    quotesUsage: captions.filter(c => /[""].*[""]/.test(c)).length > captions.length * 0.2,
    capsUsage: analyzeCapsUsage(captions)
  };
  
  return {
    username: '',
    captionLength,
    emojiUsage,
    hashtagCount: avgHashtags,
    hashtagPlacement,
    tone,
    commonWords,
    commonHashtags,
    commonEmojis,
    lineBreakUsage,
    ctaStyle: ctaStyles,
    brandMentions: extractBrandMentions(captions),
    avgEngagementTopics: extractTopics(captions),
    postingPatterns
  };
}

function analyzeTone(captions: string[]): 'professional' | 'casual' | 'fun' | 'inspirational' | 'mixed' {
  const toneScores = {
    professional: 0,
    casual: 0,
    fun: 0,
    inspirational: 0
  };
  
  const professionalWords = ['excellence', 'quality', 'professional', 'expertise', 'industry', 'leading', 'premium', 'exclusive'];
  const casualWords = ['hey', 'guys', 'lol', 'gonna', 'wanna', 'super', 'totally', 'yeah'];
  const funWords = ['amazing', 'awesome', 'excited', 'love', 'happy', 'yay', 'woohoo', 'party'];
  const inspirationalWords = ['dream', 'believe', 'inspire', 'motivate', 'journey', 'transform', 'empower', 'achieve'];
  
  captions.forEach(caption => {
    const lower = caption.toLowerCase();
    
    professionalWords.forEach(word => {
      if (lower.includes(word)) toneScores.professional++;
    });
    
    casualWords.forEach(word => {
      if (lower.includes(word)) toneScores.casual++;
    });
    
    funWords.forEach(word => {
      if (lower.includes(word)) toneScores.fun++;
    });
    
    inspirationalWords.forEach(word => {
      if (lower.includes(word)) toneScores.inspirational++;
    });
  });
  
  const maxScore = Math.max(...Object.values(toneScores));
  if (maxScore === 0) return 'mixed';
  
  const dominantTones = Object.entries(toneScores)
    .filter(([_, score]) => score === maxScore)
    .map(([tone]) => tone as 'professional' | 'casual' | 'fun' | 'inspirational');
  
  return dominantTones.length > 1 ? 'mixed' : dominantTones[0];
}

function analyzeCapsUsage(captions: string[]): 'none' | 'minimal' | 'moderate' | 'heavy' {
  const capsRatios = captions.map(caption => {
    const letters = caption.replace(/[^a-zA-Z]/g, '');
    const caps = caption.replace(/[^A-Z]/g, '');
    return letters.length > 0 ? caps.length / letters.length : 0;
  });
  
  const avgCapsRatio = capsRatios.reduce((a, b) => a + b, 0) / capsRatios.length;
  
  if (avgCapsRatio < 0.05) return 'none';
  if (avgCapsRatio < 0.15) return 'minimal';
  if (avgCapsRatio < 0.3) return 'moderate';
  return 'heavy';
}

function extractBrandMentions(captions: string[]): string[] {
  const mentions: Set<string> = new Set();
  
  captions.forEach(caption => {
    // Extract @mentions
    const atMentions = caption.match(/@\w+/g) || [];
    atMentions.forEach(mention => mentions.add(mention));
    
    // Extract capitalized brand names
    const brandPattern = /\b[A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)*\b/g;
    const brands = caption.match(brandPattern) || [];
    brands.forEach(brand => {
      if (brand.length > 3 && !['The', 'This', 'That', 'These', 'Those'].includes(brand)) {
        mentions.add(brand);
      }
    });
  });
  
  return Array.from(mentions).slice(0, 10);
}

function extractTopics(captions: string[]): string[] {
  const topicKeywords: Record<string, string[]> = {
    'fitness': ['workout', 'gym', 'fitness', 'exercise', 'training', 'muscle', 'cardio'],
    'fashion': ['outfit', 'style', 'fashion', 'wear', 'dress', 'clothing', 'ootd'],
    'food': ['recipe', 'cooking', 'food', 'meal', 'delicious', 'taste', 'eat'],
    'travel': ['travel', 'trip', 'explore', 'adventure', 'destination', 'journey', 'vacation'],
    'beauty': ['makeup', 'skincare', 'beauty', 'glow', 'skin', 'cosmetics', 'routine'],
    'lifestyle': ['life', 'daily', 'routine', 'morning', 'evening', 'day', 'living'],
    'business': ['business', 'entrepreneur', 'success', 'growth', 'marketing', 'brand', 'company'],
    'motivation': ['motivation', 'inspire', 'goals', 'dream', 'success', 'mindset', 'believe']
  };
  
  const topicScores: Record<string, number> = {};
  
  captions.forEach(caption => {
    const lower = caption.toLowerCase();
    
    Object.entries(topicKeywords).forEach(([topic, keywords]) => {
      keywords.forEach(keyword => {
        if (lower.includes(keyword)) {
          topicScores[topic] = (topicScores[topic] || 0) + 1;
        }
      });
    });
  });
  
  return Object.entries(topicScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic]) => topic);
}

function detectBestPerformingTypes(captions: string[]): string[] {
  const types: string[] = [];
  
  // Check for questions
  if (captions.filter(c => c.includes('?')).length > captions.length * 0.3) {
    types.push('questions');
  }
  
  // Check for lists
  if (captions.filter(c => /\d\.|•|✓|→/g.test(c)).length > captions.length * 0.2) {
    types.push('lists');
  }
  
  // Check for stories
  if (captions.filter(c => c.length > 300).length > captions.length * 0.3) {
    types.push('stories');
  }
  
  // Check for tips/advice
  if (captions.filter(c => /tip|advice|how to|guide/i.test(c)).length > captions.length * 0.2) {
    types.push('tips');
  }
  
  // Check for announcements
  if (captions.filter(c => /new|launch|announce|introducing|coming soon/i.test(c)).length > captions.length * 0.2) {
    types.push('announcements');
  }
  
  return types;
}

function extractContentThemes(captions: string[]): string[] {
  // This would be more sophisticated with NLP, but for now use keyword matching
  return extractTopics(captions);
}

function getDefaultStyle(): IGPostStyle {
  return {
    username: '',
    captionLength: 'medium',
    emojiUsage: 'moderate',
    hashtagCount: 15,
    hashtagPlacement: 'end',
    tone: 'casual',
    commonWords: [],
    commonHashtags: [],
    commonEmojis: ['✨', '🔥', '💯', '👏', '❤️'],
    lineBreakUsage: 'minimal',
    ctaStyle: ['Link in bio'],
    brandMentions: [],
    avgEngagementTopics: [],
    postingPatterns: {
      questionUsage: false,
      storyTelling: false,
      listFormat: false,
      quotesUsage: false,
      capsUsage: 'minimal'
    }
  };
}

// Fallback analysis with example data
function getFallbackAnalysis(username: string): IGProfileAnalysis {
  addLog('info', `[IG-ANALYZER] Using fallback analysis for @${username}`);
  
  return {
    profile: {
      username,
      fullName: username,
      bio: 'Instagram profile',
      isVerified: false,
      followerCount: 0,
      postCount: 0,
      category: 'General'
    },
    style: getDefaultStyle(),
    contentThemes: ['lifestyle', 'motivation'],
    bestPerformingTypes: ['questions', 'tips'],
    sampleCaptions: []
  };
}

// Generate captions in the analyzed style
export function generateInStyle(
  style: IGPostStyle,
  content: string,
  options?: {
    forceLength?: 'short' | 'medium' | 'long';
    forceTone?: 'professional' | 'casual' | 'fun' | 'inspirational';
    includeHashtags?: boolean;
  }
): string {
  const length = options?.forceLength || style.captionLength;
  const tone = options?.forceTone || style.tone;
  const includeHashtags = options?.includeHashtags !== false;
  
  let caption = '';
  
  // Start with appropriate opening based on tone
  const openings: Record<string, string[]> = {
    professional: ['We are pleased to announce', 'Introducing', 'Discover', 'Experience'],
    casual: ['Hey everyone!', 'Check this out:', 'Just wanted to share', 'You guys!'],
    fun: ['OMG!', 'This is amazing!', 'Can we talk about', 'YASSS!'],
    inspirational: ['Remember:', 'Today\'s reminder:', 'Never forget:', 'Believe in'],
    mixed: ['Here\'s something special:', 'Excited to share:', 'New update:', 'Hello friends!']
  };
  
  const opening = openings[tone][Math.floor(Math.random() * openings[tone].length)];
  caption = opening + ' ';
  
  // Add main content
  caption += content;
  
  // Add emojis based on usage level
  if (style.emojiUsage !== 'none') {
    const emojiCount = style.emojiUsage === 'minimal' ? 1 : 
                       style.emojiUsage === 'moderate' ? 3 : 5;
    
    const emojisToUse = style.commonEmojis.length > 0 ? 
      style.commonEmojis : ['✨', '🔥', '💫', '🌟', '💪'];
    
    for (let i = 0; i < Math.min(emojiCount, emojisToUse.length); i++) {
      caption += ' ' + emojisToUse[i];
    }
  }
  
  // Add line breaks based on style
  if (style.lineBreakUsage === 'frequent') {
    caption = caption.replace(/\. /g, '.\n\n');
  } else if (style.lineBreakUsage === 'minimal') {
    caption = caption.replace(/\. /g, '.\n');
  }
  
  // Add CTA if style includes it
  if (style.ctaStyle.length > 0) {
    const cta = style.ctaStyle[Math.floor(Math.random() * style.ctaStyle.length)];
    caption += '\n\n' + cta;
  }
  
  // Add hashtags
  if (includeHashtags) {
    const hashtagsToUse = style.commonHashtags.length >= style.hashtagCount ?
      style.commonHashtags.slice(0, style.hashtagCount) :
      [...style.commonHashtags, '#instagood', '#photooftheday', '#love', '#beautiful', '#happy'].slice(0, style.hashtagCount);
    
    if (style.hashtagPlacement === 'end') {
      caption += '\n\n' + hashtagsToUse.join(' ');
    } else if (style.hashtagPlacement === 'inline') {
      // Sprinkle hashtags throughout
      hashtagsToUse.forEach((tag, i) => {
        if (i % 3 === 0 && i < caption.length / 2) {
          const insertPoint = caption.indexOf(' ', i * 20);
          if (insertPoint > -1) {
            caption = caption.slice(0, insertPoint) + ' ' + tag + caption.slice(insertPoint);
          }
        } else {
          caption += ' ' + tag;
        }
      });
    }
  }
  
  // Apply posting patterns
  if (style.postingPatterns.questionUsage && !caption.includes('?')) {
    caption += '\n\nWhat do you think?';
  }
  
  if (style.postingPatterns.capsUsage === 'heavy') {
    caption = caption.toUpperCase();
  } else if (style.postingPatterns.capsUsage === 'moderate') {
    // Capitalize first letter of each sentence
    caption = caption.replace(/(^|\. )(\w)/g, (match) => match.toUpperCase());
  }
  
  // Adjust length
  if (length === 'short' && caption.length > 150) {
    caption = caption.slice(0, 147) + '...';
  } else if (length === 'long' && caption.length < 300) {
    // Add more content
    if (style.postingPatterns.storyTelling) {
      caption += '\n\nLet me tell you more about this journey...';
    }
  }
  
  return caption;
}

// Store analyzed profiles for reuse
const profileCache: Map<string, { analysis: IGProfileAnalysis; timestamp: number }> = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

export async function getOrAnalyzeProfile(username: string, forceRefresh = false): Promise<IGProfileAnalysis | null> {
  const cached = profileCache.get(username);
  
  if (!forceRefresh && cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
    addLog('info', `[IG-ANALYZER] Using cached analysis for @${username}`);
    return cached.analysis;
  }
  
  const analysis = await analyzeInstagramProfile(username);
  
  if (analysis) {
    profileCache.set(username, { analysis, timestamp: Date.now() });
  }
  
  return analysis;
}