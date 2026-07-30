import { TwentyApiClient } from '../utils/twenty-api';
import { getSettings, saveSettings, addToRecentCaptures, getRecentCaptures, getStoredToken, storeToken, clearStoredToken } from '../utils/storage';
import type { ExtensionMessage, ExtensionResponse, LinkedInProfileData, LinkedInCompanyData } from '../types';

// Cache for API client
let apiClient: TwentyApiClient | null = null;
let cachedTwentyUrl: string | null = null;

// Get or create API client
async function getApiClient(): Promise<TwentyApiClient> {
  const settings = await getSettings();
  
  if (!settings.twentyUrl) {
    throw new Error('Twenty URL not configured');
  }
  
  // Create new client if URL changed
  if (cachedTwentyUrl !== settings.twentyUrl || !apiClient) {
    apiClient = new TwentyApiClient(settings.twentyUrl);
    cachedTwentyUrl = settings.twentyUrl;
  }
  
  // Get token from storage or from an open Twenty tab
  const token = await getAuthToken();
  if (!token) {
    throw new Error('No authentication token found. Please log in to Twenty CRM.');
  }
  
  apiClient.setToken(token);
  return apiClient;
}

// Get auth token: stored token first, then try to ask an open Twenty tab
async function getAuthToken(): Promise<string | null> {
  // 1. Check stored token
  const storedToken = await getStoredToken();
  if (storedToken) {
    console.log('[Background] Using stored token');
    return storedToken;
  }
  
  // 2. Try to get fresh token from an open Twenty tab
  console.log('[Background] No stored token, querying Twenty tabs...');
  const freshToken = await queryTwentyTabForToken();
  if (freshToken) {
    await storeToken(freshToken);
    return freshToken;
  }
  
  return null;
}

// Query an open Twenty tab for the current auth token from localStorage
async function queryTwentyTabForToken(): Promise<string | null> {
  try {
    const settings = await getSettings();
    if (!settings.twentyUrl) return null;
    
    // Find tabs matching the Twenty URL
    const tabs = await browser.tabs.query({
      url: `${settings.twentyUrl}/*`,
    });
    
    console.log('[Background] Found', tabs.length, 'Twenty tab(s)');
    
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        // Inject a script to read localStorage token
        const results = await browser.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const KEY = '***';
            try {
              const raw = localStorage.getItem(KEY);
              if (!raw) return null;
              const tokenPair = JSON.parse(raw);
              const token = tokenPair?.accessOrWorkspaceAgnosticToken?.token || null;
              if (token && tokenPair?.accessOrWorkspaceAgnosticToken?.expiresAt) {
                const expiresAt = new Date(tokenPair.accessOrWorkspaceAgnosticToken.expiresAt).getTime();
                if (Date.now() > expiresAt) return null;
              }
              return token;
            } catch {
              return null;
            }
          },
        });
        
        const token = results[0]?.result;
        if (token) {
          console.log('[Background] Got token from Twenty tab via scripting');
          return token;
        }
      } catch (error) {
        console.error('[Background] Error executing script in Twenty tab:', error);
        continue;
      }
    }
  } catch (error) {
    console.error('[Background] Error querying Twenty tabs:', error);
  }
  
  return null;
}

// Check if a person already exists (by LinkedIn URL or name)
async function checkPersonDuplicate(
  client: TwentyApiClient,
  linkedinUrl: string,
  firstName?: string,
  lastName?: string
): Promise<{ exists: boolean; record?: { id: string; type: string }; matchedBy?: string }> {
  // First, try to find by LinkedIn URL
  try {
    const personByLinkedIn = await client.findPersonByLinkedInUrl(linkedinUrl);
    if (personByLinkedIn) {
      console.log('Found person by LinkedIn URL:', personByLinkedIn.id);
      return { exists: true, record: { id: personByLinkedIn.id, type: 'person' }, matchedBy: 'linkedin' };
    }
  } catch (error) {
    console.error('Error searching by LinkedIn URL:', error);
  }

  // If not found by LinkedIn URL and we have name, try by name
  if (firstName && lastName) {
    try {
      const personByName = await client.findPersonByName(firstName, lastName);
      if (personByName) {
        console.log('Found person by name:', personByName.id, personByName.name);
        return { exists: true, record: { id: personByName.id, type: 'person' }, matchedBy: 'name' };
      }
    } catch (error) {
      console.error('Error searching by name:', error);
    }
  }

  return { exists: false };
}

// Check if a company already exists (by LinkedIn URL or name)
async function checkCompanyDuplicate(
  client: TwentyApiClient,
  linkedinUrl: string,
  companyName?: string
): Promise<{ exists: boolean; record?: { id: string; type: string }; matchedBy?: string }> {
  // First, try to find by LinkedIn URL
  try {
    const companyByLinkedIn = await client.findCompanyByLinkedInUrl(linkedinUrl);
    if (companyByLinkedIn) {
      console.log('Found company by LinkedIn URL:', companyByLinkedIn.id);
      return { exists: true, record: { id: companyByLinkedIn.id, type: 'company' }, matchedBy: 'linkedin' };
    }
  } catch (error) {
    console.error('Error searching company by LinkedIn URL:', error);
  }

  // If not found by LinkedIn URL and we have name, try by name
  if (companyName) {
    try {
      const companyByName = await client.findCompanyByName(companyName);
      if (companyByName) {
        console.log('Found company by name:', companyByName.id, companyByName.name);
        return { exists: true, record: { id: companyByName.id, type: 'company' }, matchedBy: 'name' };
      }
    } catch (error) {
      console.error('Error searching company by name:', error);
    }
  }

  return { exists: false };
}

// Check if a record already exists (broader matching)
async function checkDuplicate(
  linkedinUrl: string,
  pageType: 'person' | 'company',
  scrapedData?: LinkedInProfileData | LinkedInCompanyData
): Promise<{ exists: boolean; record?: { id: string; type: string }; matchedBy?: string }> {
  const client = await getApiClient();
  
  if (pageType === 'person') {
    const personData = scrapedData as LinkedInProfileData | undefined;
    return checkPersonDuplicate(
      client,
      linkedinUrl,
      personData?.firstName,
      personData?.lastName
    );
  } else {
    const companyData = scrapedData as LinkedInCompanyData | undefined;
    return checkCompanyDuplicate(
      client,
      linkedinUrl,
      companyData?.name
    );
  }
}

// Create a new record
async function createRecord(
  data: LinkedInProfileData | LinkedInCompanyData
): Promise<{ id: string }> {
  const client = await getApiClient();
  
  if (data.type === 'person') {
    const person = await client.createPerson(data);
    
    // Save to recent captures
    await addToRecentCaptures({
      linkedinUrl: data.linkedinUrl,
      name: `${data.firstName} ${data.lastName}`,
      type: 'person',
      twentyId: person.id,
    });
    
    return { id: person.id };
  } else {
    const company = await client.createCompany(data);
    
    // Save to recent captures
    await addToRecentCaptures({
      linkedinUrl: data.linkedinUrl,
      name: data.name,
      type: 'company',
      twentyId: company.id,
    });
    
    return { id: company.id };
  }
}

// Test connection to Twenty
async function testConnection(): Promise<boolean> {
  try {
    const client = await getApiClient();
    return await client.testConnection();
  } catch (err) {
    console.error('Test connection failed:', err);
    return false;
  }
}

// Handle messages
async function handleMessage(message: ExtensionMessage): Promise<ExtensionResponse> {
  console.log('Received message:', message.type);
  
  try {
    switch (message.type) {
      case 'GET_AUTH_TOKEN': {
        const token = await getAuthToken();
        return { success: !!token, data: { hasToken: !!token } };
      }
      
      case 'STORE_TOKEN': {
        const { token } = message.payload as { token: string };
        console.log('[Background] Storing token from Twenty content script');
        await storeToken(token);
        return { success: true };
      }
      
      case 'CLEAR_TOKEN': {
        console.log('[Background] Clearing stored token');
        await clearStoredToken();
        return { success: true };
      }
      
      case 'CHECK_DUPLICATE': {
        const { linkedinUrl, pageType, scrapedData } = message.payload as {
          linkedinUrl: string;
          pageType: 'person' | 'company';
          scrapedData?: LinkedInProfileData | LinkedInCompanyData;
        };
        const result = await checkDuplicate(linkedinUrl, pageType, scrapedData);
        return { success: true, data: result };
      }
      
      case 'CREATE_RECORD': {
        const data = message.payload as LinkedInProfileData | LinkedInCompanyData;
        const result = await createRecord(data);
        return { success: true, data: result };
      }
      
      case 'GET_SETTINGS': {
        const settings = await getSettings();
        const hasToken = !!(await getAuthToken());
        return { 
          success: true, 
          data: { ...settings, hasToken } 
        };
      }
      
      case 'SAVE_SETTINGS': {
        const newSettings = message.payload as { twentyUrl?: string };
        console.log('Saving settings:', newSettings);
        await saveSettings(newSettings);
        // Clear cached client when URL changes
        if (newSettings.twentyUrl) {
          apiClient = null;
          cachedTwentyUrl = null;
          await clearStoredToken();
        }
        console.log('Settings saved successfully');
        return { success: true };
      }
      
      case 'TEST_CONNECTION': {
        const connected = await testConnection();
        return { success: true, data: { connected } };
      }
      
      case 'GET_RECENT_CAPTURES': {
        const captures = await getRecentCaptures();
        return { success: true, data: captures };
      }
      
      case 'SEARCH_RECORDS': {
        const { query, type } = message.payload as { query: string; type: 'person' | 'company' };
        const client = await getApiClient();
        const results = await client.searchRecords(query, type);
        return { success: true, data: results };
      }
      
      case 'UPDATE_RECORD': {
        const { id, type, data } = message.payload as {
          id: string;
          type: 'person' | 'company';
          data: LinkedInProfileData | LinkedInCompanyData;
        };
        const client = await getApiClient();
        await client.updateRecordWithLinkedInData(id, type, data);
        return { success: true, data: { id } };
      }
      
      default:
        return { success: false, error: 'Unknown message type' };
    }
  } catch (error) {
    console.error('Background error:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

// Message handler
export default defineBackground(() => {
  // Use the proper WXT/webextension-polyfill pattern for async message handling
  browser.runtime.onMessage.addListener(
    (message: ExtensionMessage, _sender, sendResponse) => {
      // Handle async by returning true and using sendResponse
      handleMessage(message).then(sendResponse);
      return true; // Indicates we will send a response asynchronously
    }
  );
  
  console.log('Twenty CRM Extension background loaded');
});
