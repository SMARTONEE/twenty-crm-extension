import type { LinkedInProfileData, LinkedInCompanyData, LinkedInData } from '../types';

// Detect page type from URL
export function getLinkedInPageType(url: string): 'person' | 'company' | null {
  if (url.includes('linkedin.com/in/')) return 'person';
  if (url.includes('linkedin.com/company/')) return 'company';
  return null;
}

// Extract LinkedIn profile identifier from URL
export function getLinkedInIdentifier(url: string): string | null {
  const personMatch = url.match(/linkedin\.com\/in\/([^/?]+)/);
  if (personMatch) return personMatch[1];
  const companyMatch = url.match(/linkedin\.com\/company\/([^/?]+)/);
  if (companyMatch) return companyMatch[1];
  return null;
}

// Try to extract data from LinkedIn's embedded JSON-LD / structured data
function tryJsonLD(): { name?: string; headline?: string; image?: string; description?: string } | null {
  try {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      const data = JSON.parse(script.textContent || '');
      if (data['@type'] === 'Person') {
        return {
          name: data.name,
          headline: data.jobTitle || data.description,
          image: data.image,
        };
      }
      if (data['@type'] === 'Organization') {
        return { name: data.name, description: data.description };
      }
    }
  } catch { /* ignore parse errors */ }
  return null;
}

// Try to extract from Open Graph / meta tags
function tryMetaTags(): { name?: string; headline?: string; image?: string; description?: string } | null {
  const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
  const ogDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content');
  const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content');

  if (ogTitle) {
    return {
      name: ogTitle.split('|')[0]?.trim() || ogTitle,
      headline: ogDesc?.split('|')[0]?.trim(),
      image: ogImage || undefined,
      description: ogDesc || undefined,
    };
  }
  return null;
}

// Validate that a string looks like a real person's name (not LinkedIn UI garbage)
const LINKEDIN_UI_GARBAGE = new Set([
  'notifications', 'messaging', 'search', 'linkedin', 'home', 'my network',
  'jobs', 'view profile', 'sign in', 'sign up', 'messagerie',
  'réseau', 'offres d\'emploi', 'accueil', 'post', 'write article',
  'write a post', 'start a post', 'premium', 'learning',
]);
function isValidProfileName(text: string): boolean {
  if (!text || text.length < 2 || text.length > 120) return false;
  // Reject pure numbers (like "0", "123", "1,234")
  if (/^[\d,.\s]+$/.test(text)) return false;
  const lower = text.toLowerCase().trim();
  // Reject known LinkedIn UI garbage
  if (LINKEDIN_UI_GARBAGE.has(lower)) return false;
  // Reject URLs
  if (/^https?:\/\//.test(lower)) return false;
  return true;
}

// Scrape person profile data from LinkedIn page
export function scrapePersonProfile(): LinkedInProfileData | null {
  try {
    const linkedinUrl = window.location.href.split('?')[0];
    console.log('[Scraper] Starting person profile scrape on:', linkedinUrl);

    // --- Strategy 1: document.title (MOST RELIABLE) ---
    // LinkedIn always sets title to "Name | LinkedIn"
    let fullName = '';
    const title = document.title || '';
    const titleParts = title.split('|')[0]?.trim() || '';
    const cleaned = titleParts.replace(/\(\d+\)\s*$/,'').trim(); // Remove "(123)" follower count
    if (cleaned && cleaned.length > 1 && cleaned !== 'LinkedIn') {
      fullName = cleaned;
      console.log('[Scraper] Found name via document.title:', fullName);
    }

    // --- Strategy 2: JSON-LD ---
    const jsonLD = tryJsonLD();
    console.log('[Scraper] JSON-LD data:', jsonLD);
    if (!fullName && jsonLD?.name && jsonLD.name.length > 1) {
      fullName = jsonLD.name;
      console.log('[Scraper] Found name via JSON-LD:', fullName);
    }

    // --- Strategy 3: Meta tags ---
    const meta = tryMetaTags();
    console.log('[Scraper] Meta tag data:', meta);
    if (!fullName && meta?.name && meta.name.length > 1) {
      const metaParts = meta.name.split('|')[0]?.trim() || '';
      if (metaParts && metaParts !== 'LinkedIn') {
        fullName = metaParts;
        console.log('[Scraper] Found name via meta og:title:', fullName);
      }
    }

    // --- Strategy 4: DOM selectors (last resort) ---
    let nameElement: Element | null = null;
    if (!fullName) {
      const nameSelectors = [
        'h1.text-heading-xlarge', 'h1.inline.t-24', 'h1.t-24.v-align-middle',
        '.pv-top-card h1', 'h1[class*="break-words"]', '.ph5 h1',
        '.pv-text-details__left-panel h1', 'h1',
      ];
      for (const sel of nameSelectors) {
        const el = document.querySelector(sel);
        const text = el?.textContent?.trim() || '';
        if (text && text.length > 1 && !/^\d+$/.test(text) && text !== 'LinkedIn') {
          nameElement = el;
          fullName = text;
          console.log('[Scraper] Found name via selector:', sel, '→', text);
          break;
        }
      }
    }

    if (!fullName) {
      console.warn('[Scraper] Could not find name — all strategies exhausted');
      return null;
    }

    console.log('[Scraper] Resolved full name:', fullName);
    const nameParts = parseFullName(fullName);

    // Headline selectors
    const headlineSelectors = [
      'div[data-generated-suggestion-target]',
      'div.text-body-medium.break-words',
      '.pv-text-details__left-panel div.text-body-medium',
      '.ph5 div.text-body-medium',
      '[class*="text-body-medium"][class*="break-words"]',
      '.pv-text-details__left-panel > div:nth-child(2)',
      '.ph5 > div:nth-child(2)',
    ];

    let headline = '';
    for (const sel of headlineSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent?.trim()) {
        const text = el.textContent.trim();
        // Accept even if it contains the name — just strip the name part
        const withoutName = text.replace(new RegExp(fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '').trim();
        if (withoutName.length > 1) {
          headline = withoutName;
          console.log('[Scraper] Found headline via selector:', sel, '→', headline);
          break;
        }
      }
    }

    if (!headline) {
      headline = jsonLD?.headline || meta?.headline || '';
    }

    // Company info — multiple strategies
    const companyData = scrapeCurrentCompanyFromProfile();
    let currentCompany = companyData?.name || '';

    // If no company from the profile, try the experience section broadly
    if (!currentCompany) {
      // LinkedIn experience section pattern
      const expSelectors = [
        '.pvs-entity__sub-components span[aria-hidden="true"]',
        '.display-flex.align-items-center.mr1.t-bold span[aria-hidden="true"]',
        '.pv-text-details__right-panel-item-text',
        '.pv-entity__secondary-title',
        '.experience-item__subtitle',
      ];
      for (const sel of expSelectors) {
        const el = document.querySelector(sel);
        const text = el?.textContent?.trim() || '';
        if (text && text.length > 1 && text.length < 100 && !text.includes('Full-time') && !text.includes('Temps plein')) {
          currentCompany = text.split('·')[0].trim();
          console.log('[Scraper] Found company via exp section:', sel, '→', currentCompany);
          break;
        }
      }
    }

    // Fallback to extracting from headline
    if (!currentCompany) {
      currentCompany = extractCompanyFromHeadline(headline);
    }

    // Profile image
    const profileImageUrl = scrapeProfileImage()
      || jsonLD?.image
      || meta?.image
      || '';

    // Location
    const locationSelectors = [
      'span.text-body-small.inline.t-black--light.break-words',
      '.text-body-small.inline.t-black--light.break-words',
      '.pv-top-card--list-bullet li:last-child',
      '.pv-text-details__right-panel .text-body-small',
      '.ph5 .text-body-small.inline',
    ];

    let location = '';
    for (const sel of locationSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent?.trim()) {
        location = el.textContent.trim();
        console.log('[Scraper] Found location via selector:', sel, '→', location);
        break;
      }
    }

    const result: LinkedInProfileData = {
      type: 'person',
      linkedinUrl,
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      headline,
      currentCompany,
      currentCompanyLinkedInUrl: companyData?.linkedinUrl,
      profileImageUrl: profileImageUrl || undefined,
      location: location || undefined,
    };

    console.log('[Scraper] Final profile data:', {
      name: `${result.firstName} ${result.lastName}`,
      headline: result.headline,
      company: result.currentCompany,
    });

    return result;
  } catch (error) {
    console.error('[Scraper] Error scraping person profile:', error);
    return null;
  }
}

// Scrape profile image
function scrapeProfileImage(): string {
  const selectors = [
    '.pv-top-card-profile-picture__container img',
    '.pv-top-card-profile-picture__image',
    'img.profile-photo-edit__preview',
    '.pv-top-card__photo img',
    'button[aria-label*="image"] img',
    'button[aria-label*="photo"] img',
    '.EntityPhoto-circle-9 img',
    'img.pv-top-card-profile-picture__image--show',
    '.presence-entity__image',
    'img[alt*="profile photo"]',
    'img[alt*="Profile photo"]',
    '.profile-photo img',
    '.ivm-view-attr__img--centered',
    // Broader catch — first non-icon, non-ghost img that looks like a profile pic
  ];

  for (const selector of selectors) {
    const img = document.querySelector(selector) as HTMLImageElement;
    if (img?.src && !img.src.includes('ghost') && !img.src.includes('company')) {
      // Only accept reasonably-sized images (not tiny icons)
      const w = img.naturalWidth || img.width || 0;
      if (w === 0 || w >= 48) {
        console.log('[Scraper] Found profile image via selector:', selector, img.src.substring(0, 80));
        return img.src;
      }
    }
  }

  return '';
}

// Scrape company info from current profile page
function scrapeCurrentCompanyFromProfile(): {
  name: string;
  linkedinUrl?: string;
  logoUrl?: string;
} | null {
  try {
    // Method 1: Find company link in the experience/position section at the top
    const topSection = document.querySelector('.ph5, .pv-top-card, .scaffold-finite-scroll');
    const searchRoot = (topSection as HTMLElement) || document;

    // Only look at links in the top card / profile header area
    const headerLinks = searchRoot.querySelectorAll('a[href*="/company/"]');
    for (const link of headerLinks) {
      // Skip links in unrelated sections
      if (link.closest('.pv-browsemap-section, footer, .feed-shared-control-menu, .discover-entity-type-card')) continue;
      // Only accept if the link is in the experience/position section
      const section = link.closest('.pv-text-details__right-panel, .pv-text-details, .ph5');
      if (!section) continue;

      const href = link.getAttribute('href') || '';
      const match = href.match(/\/company\/([^/?]+)/);
      const linkedinUrl = match ? `https://www.linkedin.com/company/${match[1]}/` : undefined;
      const name = link.textContent?.trim() || '';
      if (name && name.length > 1 && name.length < 100 && !/^\d|\bfollowers?\b|\bemployees?\b|\bconnections\b/i.test(name)) {
        console.log('[Scraper] Found company from header link:', name);
        return { name, linkedinUrl };
      }
    }

    // Method 2: Button with aria-label
    const ariaLabels = ['Entreprise actuelle', 'Current company', 'Empresa actual', 'Aktuelles Unternehmen'];
    for (const label of ariaLabels) {
      const btn = document.querySelector(`button[aria-label*="${label}"]`);
      if (btn) {
        const nameMatch = (btn.getAttribute('aria-label') || '').match(/:\s*([^.]+)/);
        const name = nameMatch ? nameMatch[1].trim() : '';
        if (name) {
          console.log('[Scraper] Found company from aria-label:', name);
          return { name };
        }
      }
    }

    // Method 3: Text pattern "Company · Location" near the top
    const textElements = searchRoot.querySelectorAll('span[aria-hidden="true"], div.text-body-medium, .t-normal');
    for (const el of textElements) {
      const text = el.textContent?.trim() || '';
      if (text.includes(' · ') && text.length > 3 && text.length < 150) {
        const candidate = text.split(' · ')[0].trim();
        if (candidate && candidate.length > 1 && !candidate.includes('@') && !/^\d/.test(candidate)) {
          console.log('[Scraper] Found company from · pattern:', candidate);
          return { name: candidate };
        }
      }
    }

    // Method 4: Any company link in experience section
    const allLinks = document.querySelectorAll('a[href*="/company/"]');
    for (const link of allLinks) {
      const name = link.textContent?.trim() || '';
      if (name && name.length > 1 && name.length < 80 && !/^\d/.test(name)) {
        const parent = link.parentElement;
        const nearby = parent?.textContent?.trim() || '';
        if (nearby.includes('Full-time') || nearby.includes('Temps plein') || nearby.includes('Present') || nearby.includes('Actuellement')) {
          console.log('[Scraper] Found company from exp link:', name);
          return { name };
        }
      }
    }

    // Method 5: JSON-LD
    try {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        const data = JSON.parse(script.textContent || '');
        if (data.worksFor?.name) {
          console.log('[Scraper] Found company from JSON-LD:', data.worksFor.name);
          return { name: data.worksFor.name };
        }
      }
    } catch { /* ignore */ }

    return null;
  } catch (error) {
    console.error('[Scraper] Error scraping company:', error);
    return null;
  }
}

// Scrape company page data from LinkedIn
export function scrapeCompanyPage(): LinkedInCompanyData | null {
  try {
    const linkedinUrl = window.location.href.split('?')[0];
    console.log('[Scraper] Starting company page scrape');

    // Try JSON-LD first
    const jsonLD = tryJsonLD();
    const meta = tryMetaTags();

    // Name selectors
    const nameSelectors = [
      'h1.org-top-card-summary__title',
      '.org-top-card-summary-info-list__info-item',
      'h1[title]',
      'h1',
    ];

    let nameElement: Element | null = null;
    for (const sel of nameSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent?.trim()) {
        nameElement = el;
        break;
      }
    }

    const name = nameElement?.textContent?.trim()
      || jsonLD?.name
      || meta?.name
      || '';

    if (!name) {
      console.warn('[Scraper] Could not find company name');
      return null;
    }

    // Industry
    const industryEl = document.querySelector('.org-top-card-summary-info-list__info-item');
    const industry = industryEl?.textContent?.trim() || '';

    // Employee count
    const allInfoItems = document.querySelectorAll('.org-top-card-summary-info-list__info-item');
    let employeeCount = '';
    allInfoItems.forEach((el) => {
      const text = el.textContent || '';
      if (/\d.*employees?/.test(text) || /\d.*employés?/.test(text)) {
        employeeCount = text.trim();
      }
    });

    // Website
    const websiteEl =
      document.querySelector('a[data-control-name="top_card_link_website"]') ||
      document.querySelector('.link-without-visited-state.org-top-card-primary-actions__action') ||
      document.querySelector('.org-top-card-primary-actions__action a');
    const website = websiteEl?.getAttribute('href') || '';

    // Logo
    const logoEl =
      document.querySelector('.org-top-card-primary-content__logo') ||
      document.querySelector('.org-top-card-primary-content img');
    const logoUrl = logoEl?.getAttribute('src') || '';

    // Description/tagline
    const descEl =
      document.querySelector('.org-top-card-summary__tagline') ||
      document.querySelector('.org-top-card-summary__subtitle');
    const description = descEl?.textContent?.trim()
      || jsonLD?.description
      || meta?.description
      || '';

    return {
      type: 'company',
      linkedinUrl,
      name,
      website: website || undefined,
      industry: industry || undefined,
      employeeCount: employeeCount || undefined,
      logoUrl: logoUrl || undefined,
      description: description || undefined,
    };
  } catch (error) {
    console.error('[Scraper] Error scraping company page:', error);
    return null;
  }
}

// Main scraper function that detects page type and scrapes accordingly
export function scrapeCurrentPage(): LinkedInData | null {
  const pageType = getLinkedInPageType(window.location.href);
  if (pageType === 'person') return scrapePersonProfile();
  if (pageType === 'company') return scrapeCompanyPage();
  return null;
}

// Helper to parse full name into first and last name
function parseFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

// Try to extract company name from headline like "Software Engineer at Google"
function extractCompanyFromHeadline(headline: string): string {
  const patterns = [
    /\bat\s+(.+?)(?:\s*\||$)/i,
    /\bchez\s+(.+?)(?:\s*\||$)/i,
    /\bbei\s+(.+?)(?:\s*\||$)/i,
    /\b@\s*(.+?)(?:\s*\||$)/i,
    /\bfor\s+(.+?)(?:\s*\||$)/i,
    /\bà\s+(.+?)(?:\s*\||$)/i,
    /\ben\s+(.+?)(?:\s*\||$)/i,
  ];
  for (const pattern of patterns) {
    const match = headline.match(pattern);
    if (match) return match[1].trim();
  }
  return '';
}
