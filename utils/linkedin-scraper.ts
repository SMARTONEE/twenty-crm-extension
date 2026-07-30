// Scrape company info from current profile page
function scrapeCurrentCompanyFromProfile(): {
  name: string;
  linkedinUrl?: string;
  logoUrl?: string;
} | null {
  try {
    // Method 1: Find ANY link to a company page in the profile header area
    // LinkedIn's experience section always links to the company page
    const topSection = document.querySelector('.ph5, .pv-top-card, .scaffold-finite-scroll');
    const searchRoot = topSection || document;

    const companyLinks = searchRoot.querySelectorAll('a[href*="/company/"]');
    for (const link of companyLinks) {
      // Skip company links that are clearly in the "People also viewed" or footer
      if (link.closest('.pv-browsemap-section, footer, .feed-shared-control-menu')) continue;

      const href = link.getAttribute('href') || '';
      const match = href.match(/\/company\/([^/?]+)/);
      const linkedinUrl = match ? `https://www.linkedin.com/company/${match[1]}/` : undefined;

      // Get the company name from the link text or nearby text
      const name = link.textContent?.trim()
        || link.querySelector('span[aria-hidden="true"]')?.textContent?.trim()
        || '';

      if (name && name.length > 1 && !name.includes('followers') && !name.includes('employees')) {
        console.log('[Scraper] Found company from link in header:', name);
        return { name, linkedinUrl };
      }
    }

    // Method 2: Button with aria-label (most specific)
    const ariaLabels = ['Entreprise actuelle', 'Current company', 'Empresa actual', 'Aktuelles Unternehmen'];
    for (const label of ariaLabels) {
      const btn = document.querySelector(`button[aria-label*="${label}"]`);
      if (btn) {
        const ariaLabel = btn.getAttribute('aria-label') || '';
        const nameMatch = ariaLabel.match(/:\s*([^.]+)/);
        const name = nameMatch ? nameMatch[1].trim() : '';
        if (name) {
          console.log('[Scraper] Found company from button aria-label:', name);
          return { name };
        }
      }
    }

    // Method 3: Any text that looks like "Company · Location" pattern in the header
    const textElements = searchRoot.querySelectorAll('span[aria-hidden="true"], div.text-body-medium, .t-normal');
    for (const el of textElements) {
      const text = el.textContent?.trim() || '';
      // Pattern: "Company Name · Location" or just "Company Name"
      if (text.includes(' · ') && text.length > 3 && text.length < 150) {
        const parts = text.split(' · ');
        const candidate = parts[0].trim();
        if (candidate && candidate.length > 1 && !candidate.includes('@') && !/^\d/.test(candidate)) {
          console.log('[Scraper] Found company from · pattern:', candidate);
          return { name: candidate };
        }
      }
    }

    // Method 4: Try to find company from any visible company link anywhere on the page
    const allCompanyLinks = document.querySelectorAll('a[href*="/company/"]');
    for (const link of allCompanyLinks) {
      const name = link.textContent?.trim() || '';
      if (name && name.length > 1 && name.length < 80 && !name.match(/^\d|followers|employees|connections/i)) {
        // Only use if it's likely a company name (not a job title)
        const parent = link.parentElement;
        const grandparent = parent?.parentElement;
        const nearby = parent?.textContent?.trim() || '';
        // If the link is inside an experience section, it's likely the current company
        if (nearby.includes('Full-time') || nearby.includes('Temps plein') || nearby.includes('Present') || nearby.includes('Actuellement')) {
          console.log('[Scraper] Found company from experience link:', name);
          return { name };
        }
      }
    }

    // Method 5: JSON-LD
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent || '');
        if (data.worksFor?.name) {
          console.log('[Scraper] Found company from JSON-LD worksFor:', data.worksFor.name);
          return { name: data.worksFor.name };
        }
        if (data.affiliation?.name) {
          console.log('[Scraper] Found company from JSON-LD affiliation:', data.affiliation.name);
          return { name: data.affiliation.name };
        }
      } catch { /* ignore */ }
    }

    console.log('[Scraper] No company found — all methods exhausted');
    return null;
  } catch (error) {
    console.error('[Scraper] Error scraping company:', error);
    return null;
  }
}