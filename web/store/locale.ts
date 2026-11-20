"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Locale } from "../lib/i18n";

type LocaleState = { locale: Locale; setLocale: (locale: Locale) => void };

export const useLocale = create<LocaleState>()(persist((set) => ({
    locale: "zh-CN",
    setLocale: (locale) => {
        set({ locale });
        if (typeof document !== "undefined") document.documentElement.lang = locale;
    },
}), {
    name: "openterminal-locale",
    partialize: ({ locale }) => ({ locale }),
    merge: (persisted, current) => {
        const value = (persisted as Partial<LocaleState> | undefined)?.locale;
        return { ...current, locale: value === "en" ? "en" : "zh-CN" };
    },
    onRehydrateStorage: () => (state) => {
        if (state && typeof document !== "undefined") document.documentElement.lang = state.locale;
    },
}));
