"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { CityData, CountryData } from "@/types/atlas";

const RANK_LABEL: Record<CityData["rank"], string> = {
  capital: "Capital",
  city: "City",
  town: "Town",
};

export function CityDetailPanel({
  city,
  country,
  onClose,
}: {
  city: CityData | null;
  country: CountryData | null;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {city && country && (
        <motion.aside
          key={city.id}
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "tween", duration: 0.22, ease: "easeOut" }}
          className="absolute top-0 right-0 h-full w-full max-w-md bg-white shadow-xl overflow-hidden flex flex-col"
          // Stop click events from bubbling to the SVG (which would deselect)
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <header className="px-5 pt-5 pb-3 border-b border-stone-100">
            <div className="flex items-start justify-between gap-3">
              <nav className="text-xs text-stone-500">
                <span>{country.name}</span>
                {country.nameJa && (
                  <span className="text-stone-400"> · {country.nameJa}</span>
                )}
                <span className="mx-1.5">›</span>
                <span className="text-stone-700">{RANK_LABEL[city.rank]}</span>
              </nav>
              <button
                aria-label="Close"
                onClick={onClose}
                className="text-stone-400 hover:text-stone-700 text-lg leading-none -mt-1"
              >
                ×
              </button>
            </div>
            <h2 className="mt-2 text-2xl font-medium text-stone-800">{city.label}</h2>
            {city.labelJa && (
              <p className="text-sm text-stone-500 mt-0.5">{city.labelJa}</p>
            )}
            <div className="mt-3 flex items-center gap-3 text-xs text-stone-500">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block w-1.5 h-3 bg-stone-400 align-middle"
                  style={{ height: 6 + city.urbanDensity * 1.2 }}
                />
                density {city.urbanDensity}/10
              </span>
              {city.messages && (
                <span>· {city.messages.length} messages</span>
              )}
            </div>
          </header>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {city.summary && (
              <section>
                <h3 className="text-[11px] uppercase tracking-wider text-stone-500 mb-1.5">
                  Summary
                </h3>
                <p className="text-sm text-stone-700 leading-relaxed">{city.summary}</p>
              </section>
            )}

            {city.messages && city.messages.length > 0 && (
              <section>
                <h3 className="text-[11px] uppercase tracking-wider text-stone-500 mb-2">
                  Conversation preview
                </h3>
                <ul className="space-y-2.5">
                  {city.messages.map((m, i) => (
                    <li
                      key={i}
                      className={
                        m.role === "user"
                          ? "ml-6 bg-stone-100 text-stone-800 rounded-lg px-3 py-2 text-sm"
                          : "mr-6 bg-emerald-50 text-stone-800 rounded-lg px-3 py-2 text-sm"
                      }
                    >
                      <div className="text-[10px] uppercase tracking-wider text-stone-500 mb-0.5">
                        {m.role}
                      </div>
                      <div className="leading-relaxed">{m.text}</div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {!city.summary && !city.messages?.length && (
              <p className="text-sm text-stone-400 italic">
                No conversation data yet for this city.
              </p>
            )}
          </div>

          {/* Footer */}
          <footer className="px-5 py-4 border-t border-stone-100 bg-stone-50">
            <button
              type="button"
              disabled
              title="Conversation resume lands in Phase 3 of the spec — not implemented yet"
              className="w-full py-2 px-4 bg-stone-800 text-white text-sm rounded opacity-40 cursor-not-allowed"
            >
              Continue here →
            </button>
            <p className="mt-1.5 text-[10px] text-stone-400 text-center">
              Resume-here lands in spec Phase 3
            </p>
          </footer>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
