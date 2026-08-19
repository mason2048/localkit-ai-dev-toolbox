import { encode as encodeCl100k } from 'gpt-tokenizer/encoding/cl100k_base'
import { encode as encodeO200k } from 'gpt-tokenizer/encoding/o200k_base'

export type TokenEncoding = 'cl100k_base' | 'o200k_base'
export type TokenProfile = 'gpt-4o' | 'gpt-4' | 'cl100k_base' | 'o200k_base'

export type TokenEstimate = {
  mode: 'approximate'
  tokens: number
  characters: number
  words: number
  cjkCharacters: number
  budgets: TokenBudget[]
}

export type ExactTokenCount = {
  mode: 'exact'
  encoding: TokenEncoding
  profile: TokenProfile
  tokenizer: 'gpt-tokenizer@3.4.0'
  tokens: number
  characters: number
  tokenIds: number[]
  previewTokenIds: number[]
  budgets: TokenBudget[]
  excludes: ['chat-wrapper', 'tool-calls', 'images', 'server-billing-adjustments']
}

export type TokenBudget = { limit: number; remaining: number; percent: number; level: 'ok' | 'near' | 'over' }

export const TOKEN_PROFILES: Record<TokenProfile, { label: string; encoding: TokenEncoding; limits: number[] }> = {
  'gpt-4o': { label: 'GPT-4o / o200k_base', encoding: 'o200k_base', limits: [128000] },
  'gpt-4': { label: 'GPT-4 / cl100k_base', encoding: 'cl100k_base', limits: [8192] },
  cl100k_base: { label: '仅编码 cl100k_base', encoding: 'cl100k_base', limits: [4096, 8192, 32768, 128000] },
  o200k_base: { label: '仅编码 o200k_base', encoding: 'o200k_base', limits: [128000, 200000] },
}

function budgets(tokens: number, limits: number[]): TokenBudget[] {
  return limits.map((limit) => {
    const percent = Math.round((tokens / limit) * 1000) / 10
    return { limit, remaining: Math.max(0, limit - tokens), percent, level: tokens > limit ? 'over' : tokens > limit * 0.8 ? 'near' : 'ok' }
  })
}

export function estimateTokens(text: string, limits = [4096, 8192, 32768, 128000]): TokenEstimate {
  const cjkCharacters = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length
  const withoutCjk = text.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ')
  const words = (withoutCjk.match(/[\p{L}\p{N}_]+/gu) ?? []).length
  const punctuation = (text.match(/[^\s\p{L}\p{N}_]/gu) ?? []).length
  const whitespaceRuns = (text.match(/\s+/g) ?? []).length
  const tokens = text.length === 0 ? 0 : Math.max(1, Math.ceil(cjkCharacters * 1.15 + words * 1.3 + punctuation * 0.45 + whitespaceRuns * 0.08))
  return { mode: 'approximate', tokens, characters: text.length, words, cjkCharacters, budgets: budgets(tokens, limits) }
}

export function encodeExact(text: string, encoding: TokenEncoding) {
  const options = { disallowedSpecial: new Set<string>() }
  return encoding === 'o200k_base' ? encodeO200k(text, options) : encodeCl100k(text, options)
}

export function countExactTokens(text: string, profile: TokenProfile): ExactTokenCount {
  const config = TOKEN_PROFILES[profile]
  const tokenIds = encodeExact(text, config.encoding)
  return {
    mode: 'exact', encoding: config.encoding, profile, tokenizer: 'gpt-tokenizer@3.4.0', tokens: tokenIds.length,
    characters: text.length, tokenIds,
    previewTokenIds: tokenIds.slice(0, 80),
    budgets: budgets(tokenIds.length, config.limits),
    excludes: ['chat-wrapper', 'tool-calls', 'images', 'server-billing-adjustments'],
  }
}
