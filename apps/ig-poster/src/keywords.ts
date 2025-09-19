import { addLog } from './logger';

export type Category = 'Business' | 'Fitness' | 'Motivation' | 'Location';

const CATEGORIES: Category[] = ['Business','Fitness','Motivation','Location'];

const initial: Record<Category, string[]> = {
  Business: ['#livepilatesusa', '#miami', '#pilates', '#studio', '#wellness'],
  Fitness: ['#pilateslife', '#strength', '#flexibility', '#mindfulness'],
  Motivation: ['#mondaymotivation', '#fitnessgoals', '#healthylifestyle'],
  Location: ['#miami', '#florida', '#pilatesstudio'],
};

const store: Record<Category, Set<string>> = {
  Business: new Set(),
  Fitness: new Set(),
  Motivation: new Set(),
  Location: new Set(),
};

(function bootstrap(){
  for (const cat of CATEGORIES) {
    initial[cat].forEach(k => store[cat].add(normalize(k)));
  }
})();

function normalize(k: string): string {
  const t = String(k).trim();
  if (!t) return '';
  return t.startsWith('#') ? t : ('#' + t.replace(/^#+/,'').trim());
}

export function listKeywords(): Record<string, string[]> {
  const out: Record<string,string[]> = {};
  for (const cat of CATEGORIES) out[cat] = Array.from(store[cat]).sort((a,b)=>a.localeCompare(b));
  return out;
}

export function addKeyword(category: string, keyword: string): {ok:boolean, error?:string} {
  const cat = CATEGORIES.find(c => c.toLowerCase() === String(category).toLowerCase());
  if (!cat) return { ok:false, error:'invalid_category' };
  const norm = normalize(keyword);
  if (!norm) return { ok:false, error:'invalid_keyword' };
  store[cat].add(norm);
  addLog('info', `[KW] Added ${norm} to ${cat}`);
  return { ok:true };
}

export function removeKeyword(category: string, keyword: string): {ok:boolean, error?:string} {
  const cat = CATEGORIES.find(c => c.toLowerCase() === String(category).toLowerCase());
  if (!cat) return { ok:false, error:'invalid_category' };
  const norm = normalize(keyword);
  if (!norm) return { ok:false, error:'invalid_keyword' };
  store[cat].delete(norm);
  addLog('info', `[KW] Removed ${norm} from ${cat}`);
  return { ok:true };
}

export function pickDefaultKeywords(limit = 8): string[] {
  // Round-robin across categories for variety
  const lists = CATEGORIES.map(c => Array.from(store[c]));
  const out: string[] = [];
  let idx = 0;
  while (out.length < limit) {
    const list = lists[idx % lists.length];
    if (list.length) {
      const k = list[Math.floor(Math.random() * list.length)];
      if (!out.includes(k)) out.push(k);
    }
    idx++;
    if (idx > 100) break; // safety
  }
  return out;
}

export function allCategories(): Category[] { return [...CATEGORIES]; }