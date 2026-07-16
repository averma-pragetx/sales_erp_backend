import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

export type LlmProvider = 'gemini' | 'openai';

export const GEMINI_MODEL = 'gemini-2.5-flash';
export const OPENAI_MODEL = 'gpt-5.4';

// Singletons — one client per process, not one per request
let _gemini: GoogleGenAI | null = null;
let _openai: OpenAI | null = null;

export function getGemini(): GoogleGenAI {
  if (!_gemini) {
    const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('Missing GOOGLE_API_KEY (or GEMINI_API_KEY) in env.');
    _gemini = new GoogleGenAI({ apiKey });
  }
  return _gemini;
}

export function getOpenAI(): OpenAI {
  if (!_openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('Missing OPENAI_API_KEY in env.');
    _openai = new OpenAI({ apiKey });
  }
  return _openai;
}
