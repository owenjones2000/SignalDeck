"use client";

import "./globals.css";
import { useI18n } from "../lib/useI18n";

// Last-resort fallback when the root layout itself throws; replaces <html>/<body>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t, locale } = useI18n();
  return (
    <html lang={locale}>
      <body>
        <div className="p-4 flex flex-col gap-2 items-start">
          <span className="down">{t("Terminal error:")} {error.message}</span>
          <button onClick={reset} className="dim hover:text-[var(--amber)]">
            {t("Retry")}
          </button>
        </div>
      </body>
    </html>
  );
}
