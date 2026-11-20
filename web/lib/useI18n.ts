"use client";

import { useLocale } from "../store/locale";
import { translate, translateText, type TranslationKey } from "./i18n";

export function useI18n() {
    const locale = useLocale((state) => state.locale);
    return {
        locale,
        t: (key: TranslationKey, values?: Record<string, string | number>) => translate(locale, key, values),
        text: (value: string) => translateText(locale, value),
    };
}
