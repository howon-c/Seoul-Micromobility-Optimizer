/**
 * LLM Service for Gemini API integration
 * Handles chat completions with the Google Gemini API
 */

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
  }[];
  error?: {
    message?: string;
    code?: number;
  };
}

/**
 * Calls Gemini API with chat messages
 * @param messages - Array of chat messages
 * @param apiKey - Gemini API key
 * @param systemPrompt - System prompt to set context
 * @returns Assistant's response text
 */
export async function callGeminiAPI(
  messages: ChatMessage[],
  apiKey: string,
  systemPrompt: string
): Promise<string> {
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('API key is required');
  }

  // Dynamically resolve the best available model for this API key
  const modelName = await resolveModelForKey(apiKey);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  // Build contents array for Gemini format
  // Gemini v1 API doesn't support systemInstruction, so we prepend it as a user message
  const contents: { role: string; parts: { text: string }[] }[] = [];
  
  // Prepend system prompt as first user message for context
  contents.push({
    role: 'user',
    parts: [{ text: `[System Instructions]\n${systemPrompt}\n\n[End System Instructions]\n\nPlease acknowledge you understand these instructions and are ready to help.` }]
  });
  
  // Add a model acknowledgment to establish the context
  contents.push({
    role: 'model',
    parts: [{ text: 'Understood. I am your AI Operations Manager, ready to analyze your fleet optimization results and answer questions based on the simulation data provided. How can I help?' }]
  });
  
  // Add actual conversation messages
  messages
    .filter(m => m.role !== 'system')
    .forEach(m => {
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      });
    });

  const requestBody = {
    contents,
    generationConfig: {
      temperature: 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 1024,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
    ]
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    const data: GeminiResponse = await response.json();

    if (!response.ok) {
      const errorMsg = data.error?.message || `API error: ${response.status}`;
      throw new Error(errorMsg);
    }

    // Extract text from Gemini response
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) {
      throw new Error('No response generated');
    }

    return text;

  } catch (error) {
    if (error instanceof Error) {
      // Re-throw with more context
      if (error.message.includes('API_KEY_INVALID')) {
        throw new Error('Invalid API key. Please check your Gemini API key.');
      }
      if (error.message.includes('QUOTA_EXCEEDED')) {
        throw new Error('API quota exceeded. Please try again later.');
      }
      throw error;
    }
    throw new Error('Failed to call Gemini API');
  }
}

/**
 * Lists available models for the provided API key
 */
export async function listAvailableModels(apiKey: string): Promise<string[]> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  try {
    const response = await fetch(endpoint);
    const data = await response.json();
    if (data.models) {
      return data.models.map((m: any) => m.name.replace('models/', ''));
    }
    return [];
  } catch (e) {
    console.error("Failed to list models", e);
    return [];
  }
}

/**
 * Validates if an API key looks valid (basic format check)
 */
export function isValidApiKeyFormat(key: string): boolean {
  // Gemini API keys are typically 39 characters starting with "AIza"
  return key.length >= 30 && key.startsWith('AIza');
}

/**
 * Storage key for persisting API key in localStorage
 */
const API_KEY_STORAGE_KEY = 'gemini_api_key';

/**
 * Saves API key to localStorage
 */
export function saveApiKey(key: string): void {
  try {
    localStorage.setItem(API_KEY_STORAGE_KEY, key);
  } catch {
    console.warn('Failed to save API key to localStorage');
  }
}

/**
 * Loads API key from localStorage
 */
export function loadApiKey(): string | null {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Clears API key from localStorage
 */
export function clearApiKey(): void {
  try {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
  } catch {
    console.warn('Failed to clear API key from localStorage');
  }
}

/**
 * Picks the best model from a list based on a preference order.
 */
function pickPreferredModel(models: string[]): string {
  const prefs = [
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.0-flash-exp',
    'gemini-1.5-flash',
    'gemini-pro',
    'gemini-1.0-pro',
  ];
  for (const p of prefs) {
    if (models.includes(p)) return p;
  }
  // Fallback to first available
  return models[0];
}

/**
 * Resolve an available model for the provided API key.
 * Falls back to gemini-2.5-flash if listing fails.
 */
async function resolveModelForKey(apiKey: string): Promise<string> {
  try {
    const models = await listAvailableModels(apiKey);
    if (models && models.length > 0) {
      return pickPreferredModel(models);
    }
  } catch (e) {
    console.warn('Could not list models, falling back to gemini-2.5-flash', e);
  }
  return 'gemini-2.5-flash';
}

