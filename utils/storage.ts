import { storage } from '#imports';
import type { ExtensionSettings } from '../types';
import type { FieldDefinition } from './fields-config';

// Define storage items
export const twentyUrlStorage = storage.defineItem<string>('sync:twentyUrl', {
  fallback: 'https://crm.southconnect.io',
});

export const authTokenStorage = storage.defineItem<string>('local:authToken', {
  fallback: '',
});

export const authTokenExpiryStorage = storage.defineItem<number>('local:authTokenExpiry', {
  fallback: 0,
});

export const lastCapturedStorage = storage.defineItem<Array<{
  linkedinUrl: string;
  name: string;
  type: 'person' | 'company';
  capturedAt: number;
  twentyId: string;
}>>('local:lastCaptured', {
  fallback: [],
});

// Store which fields the user wants to see on LinkedIn
export const selectedFieldsStorage = storage.defineItem<string[]>('local:selectedFields', {
  fallback: ['leadStatus', 'ecosystem'],
});

// Store the discovered field definitions with their options
export const fieldDefinitionsStorage = storage.defineItem<FieldDefinition[]>('local:fieldDefinitions', {
  fallback: [],
});

// Helper functions
export async function getSettings(): Promise<ExtensionSettings> {
  const twentyUrl = await twentyUrlStorage.getValue();
  return { twentyUrl };
}

export async function saveSettings(settings: Partial<ExtensionSettings>): Promise<void> {
  if (settings.twentyUrl !== undefined) {
    await twentyUrlStorage.setValue(settings.twentyUrl);
  }
}

export async function getStoredToken(): Promise<string | null> {
  const token = await authTokenStorage.getValue();
  const expiry = await authTokenExpiryStorage.getValue();
  if (token && expiry && Date.now() < expiry) {
    return token;
  }
  return null;
}

export async function storeToken(token: string, expiresAt?: number): Promise<void> {
  await authTokenStorage.setValue(token);
  if (expiresAt) {
    await authTokenExpiryStorage.setValue(expiresAt);
  }
}

export async function clearStoredToken(): Promise<void> {
  await authTokenStorage.setValue('');
  await authTokenExpiryStorage.setValue(0);
}

export async function getSelectedFields(): Promise<string[]> {
  return selectedFieldsStorage.getValue();
}

export async function setSelectedFields(fields: string[]): Promise<void> {
  await selectedFieldsStorage.setValue(fields);
}

export async function setFieldDefinitions(defs: FieldDefinition[]): Promise<void> {
  await fieldDefinitionsStorage.setValue(defs);
}

export async function getFieldDefinitions(): Promise<FieldDefinition[]> {
  return fieldDefinitionsStorage.getValue();
}

export async function addToRecentCaptures(capture: {
  linkedinUrl: string;
  name: string;
  type: 'person' | 'company';
  twentyId: string;
}): Promise<void> {
  const current = await lastCapturedStorage.getValue();
  const newCapture = { ...capture, capturedAt: Date.now() };
  const filtered = current.filter((c) => c.linkedinUrl !== capture.linkedinUrl);
  const updated = [newCapture, ...filtered].slice(0, 10);
  await lastCapturedStorage.setValue(updated);
}

export async function getRecentCaptures() {
  return lastCapturedStorage.getValue();
}
