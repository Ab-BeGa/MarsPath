import { createContext, useCallback, useContext, useEffect, useMemo, useState,
  type PropsWithChildren } from 'react'
import {
  catalog, LOCALE_NUMBER_FORMAT, normalizeLocale, translate, type Locale,
  type TranslationKey,
} from './i18nCatalog.ts'
import { localizeErrorMessage } from './localizedErrors.ts'

const STORAGE_KEY = 'jezero-traverse:locale:v1'
type Translator = (key: TranslationKey | string, params?: Record<string, string | number>) => string
type I18nValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Translator
  format: (value: number, options?: Intl.NumberFormatOptions) => string
  meters: (value: number, options?: Intl.NumberFormatOptions) => string
  error: (message: string) => string
}
const I18nContext = createContext<I18nValue | null>(null)

function readInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'ru'
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'ru' || stored === 'en' || stored === 'kk') return stored
  } catch { /* Disabled storage/private mode must never block the application. */ }
  return normalizeLocale(window.navigator.language)
}

export function I18nProvider({ children }: PropsWithChildren) {
  const [locale, setLocale] = useState<Locale>(readInitialLocale)
  const t = useCallback<Translator>((key, params) => translate(key, locale, params), [locale])
  const format = useCallback((value: number, options: Intl.NumberFormatOptions = {}) =>
    new Intl.NumberFormat(LOCALE_NUMBER_FORMAT[locale], { maximumFractionDigits: 1, ...options }).format(value), [locale])
  const meters = useCallback((value: number, options: Intl.NumberFormatOptions = {}) =>
    format(value, options) + ' ' + (locale === 'en' ? 'm' : 'м'), [format, locale])
  const error = useCallback((message: string) => localizeErrorMessage(message, locale), [locale])

  useEffect(() => {
    document.documentElement.lang = locale
    document.title = 'MarsPath · ' + t('globe.title')
    try { window.localStorage.setItem(STORAGE_KEY, locale) }
    catch { /* Persist only where allowed. Switching still works. */ }
  }, [locale, t])

  const value = useMemo(() => ({ locale, setLocale, t, format, meters, error }),
    [locale, t, format, meters, error])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (ctx === null) throw new Error('I18nProvider must wrap the application')
  return ctx
}

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n()
  return <label className="orbital-language" title={t('language.label')}>
    <span className="language-globe-icon" aria-hidden="true"><i/></span>
    <select aria-label={t('language.label')} value={locale}
      onChange={event => setLocale(normalizeLocale(event.currentTarget.value))}>
      <option value="ru">Русский</option>
      <option value="en">English</option>
      <option value="kk">Қазақша</option>
    </select>
  </label>
}

export { catalog, translate, normalizeLocale }
export type { Locale, TranslationKey }
