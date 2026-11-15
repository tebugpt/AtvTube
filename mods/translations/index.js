import i18n from 'i18next';
import resources from './i18nResources.js';
import { configRead, configWrite } from '../config.js';

// Cache key used to remember the last language we resolved from the
// authoritative source (yt.config_.HL) so a future cold start that races
// ahead of YouTube's own initialization still has something better than
// navigator.language to fall back on.
const CACHE_KEY = 'lastResolvedUILanguage';

function normalizeLanguage(raw) {
  const lower = String(raw).toLowerCase().replace('_', '-');

  // Chinese: distinguish Simplified vs Traditional
  if (lower.startsWith('zh')) {
    if (
      lower.includes('tw') ||
      lower.includes('hk') ||
      lower.includes('mo') ||
      lower.includes('hant')
    ) {
      return 'zh-TW';
    }
    // zh, zh-CN, zh-Hans, zh-SG, etc. → Simplified Chinese
    return 'zh-CN';
  }

  // Prefer exact resource key if available
  if (resources[raw]) return raw;
  if (resources[lower]) return lower;

  // Common region-specific resources
  if (lower.startsWith('pt-br')) return 'pt-BR';
  if (lower.startsWith('pt-pt') || lower === 'pt') return 'pt-PT';
  if (
    lower.startsWith('es-419') ||
    lower.startsWith('es-mx') ||
    lower.startsWith('es-ar') ||
    lower.startsWith('es-us') ||
    lower.startsWith('es-xl')
  ) {
    return 'es-419';
  }
  if (lower.startsWith('fi')) return 'fi-FI';
  if (lower.startsWith('sr') && (lower.includes('latn') || lower.includes('latin'))) {
    return 'sr-Latn';
  }
  if (lower.startsWith('sr')) return 'sr';

  // Fallback: strip region (original behavior)
  const base = lower.replace(/[-_].*$/, '');
  if (resources[base]) return base;

  return 'en';
}

function getYtHL() {
  try {
    return window?.yt?.config_?.HL || null;
  } catch (e) {
    return null;
  }
}

function resolveInitialLanguage() {
  // 1) Authoritative source: YouTube's own display-language setting.
  //    This reflects what the user picked inside YouTube, not the device's
  //    system/browser locale, and is what we always want when available.
  const hl = getYtHL();
  if (hl) {
    return { lang: normalizeLanguage(hl), authoritative: true };
  }

  // 2) yt.config_ isn't populated yet (this script runs very early, often
  //    before YouTube's own bootstrap code has executed). Use whatever we
  //    successfully resolved from yt.config_.HL last time, if we have it.
  let cached = null;
  try {
    cached = configRead(CACHE_KEY);
  } catch (e) { /* config not ready yet, ignore */ }
  if (cached) {
    return { lang: cached, authoritative: false };
  }

  // 3) Last resort: browser/system locale. On many TV runtimes (Tizen
  //    WebKit, Cobalt/Android) this does NOT reflect the user's chosen
  //    YouTube display language and can be a fixed default (e.g. en-US),
  //    so this is only a placeholder until step 4 below can correct it.
  return { lang: normalizeLanguage(navigator.language || 'en'), authoritative: false };
}

const initial = resolveInitialLanguage();

i18n.init({
  lng: initial.lang,
  fallbackLng: 'en',
  resources,
  debug: false,
  interpolation: {
    escapeValue: false,
  }
});

if (initial.authoritative) {
  try {
    configWrite(CACHE_KEY, initial.lang);
  } catch (e) { /* ignore persistence failures */ }
} else {
  // 4) yt.config_.HL wasn't ready at load time. Poll briefly for it to
  //    appear (mirrors the polling pattern already used elsewhere in this
  //    codebase to wait for the <video> element) and switch the UI language
  //    live once it does, persisting the result for next launch.
  let attempts = 0;
  const maxAttempts = 40; // ~10s at 250ms intervals
  const poll = setInterval(() => {
    attempts++;
    const hl = getYtHL();

    if (hl) {
      clearInterval(poll);
      const resolved = normalizeLanguage(hl);
      if (resolved !== i18n.language) {
        i18n.changeLanguage(resolved);
      }
      try {
        configWrite(CACHE_KEY, resolved);
      } catch (e) { /* ignore persistence failures */ }
    } else if (attempts >= maxAttempts) {
      clearInterval(poll);
    }
  }, 250);
}

export default i18n;
