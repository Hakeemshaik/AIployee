"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

// ---------------------------------------------------------------------------
// Choosing one of a list, in our own voice.
//
// The native <select> draws whatever the operating system draws: a grey list in
// the system font, at the system size, with no room for the second line that
// explains what an option means. On a screen made of glass and rounded pills it
// is the one control that looks borrowed.
//
// This is the same control, kept honest:
//
//   * it renders a real <input type="hidden"> under the button, so every form
//     that submits `name=value` to a server action carries on working;
//   * it is a proper listbox — arrows move, Home and End jump, typing a few
//     letters seeks, Enter and Space choose, Escape closes and puts focus back;
//   * the list is portalled to the body and positioned against the viewport, so
//     it cannot be clipped by a card, a drawer or an overflow-hidden panel, and
//     it flips above the button when there is no room below.
//
// An option can carry a `hint` — the sentence the native control had nowhere to
// put.
// ---------------------------------------------------------------------------

export type SelectOption = {
  value: string;
  label: string;
  /** The half-sentence that says what choosing this actually does. */
  hint?: string;
  disabled?: boolean;
};

export type SelectProps = {
  options: readonly SelectOption[];
  /** Controlled value. Leave off and pass `defaultValue` for form use. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Submits with the form, exactly as the native control did. */
  name?: string;
  id?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

const MENU_MAX_HEIGHT = 288;

type Anchor = { left: number; top: number; width: number; drop: "down" | "up" };

export function Select({
  options,
  value,
  defaultValue,
  onChange,
  name,
  id,
  placeholder = "Select…",
  required,
  disabled,
  className = "",
  "aria-label": ariaLabel,
}: SelectProps) {
  const auto = useId();
  const listId = `${id ?? auto}-list`;
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = controlled ? value : inner;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const seek = useRef({ term: "", at: 0 });

  const selected = useMemo(
    () => options.find((option) => option.value === current) ?? null,
    [options, current],
  );

  const choose = useCallback(
    (option: SelectOption) => {
      if (option.disabled) return;
      if (!controlled) setInner(option.value);
      onChange?.(option.value);
      setOpen(false);
      buttonRef.current?.focus();
    },
    [controlled, onChange],
  );

  /** Opening lands the highlight on whatever is already chosen. */
  const openList = useCallback(() => {
    const index = options.findIndex((option) => option.value === current);
    setActive(index >= 0 ? index : 0);
    setOpen(true);
  }, [options, current]);

  // --- where the list goes ---------------------------------------------------
  // Measured against the viewport rather than the button's offset parent, so a
  // card with its own scroll or clipping has no say in it.
  const measure = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const box = button.getBoundingClientRect();
    const below = window.innerHeight - box.bottom;
    const drop: Anchor["drop"] = below < Math.min(MENU_MAX_HEIGHT, 220) && box.top > below ? "up" : "down";
    setAnchor({
      left: box.left,
      top: drop === "down" ? box.bottom + 6 : box.top - 6,
      width: box.width,
      drop,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    // Anything that moves the button moves the list with it. Capture, so a
    // scroll inside a drawer counts and not only the page's own.
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, measure]);

  // Keep the highlighted row in sight while the arrows walk a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      const target = event.target as Node;
      if (listRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const step = useCallback(
    (from: number, direction: 1 | -1) => {
      const count = options.length;
      for (let hop = 1; hop <= count; hop += 1) {
        const next = (from + direction * hop + count * hop) % count;
        if (!options[next]?.disabled) return next;
      }
      return from;
    },
    [options],
  );

  function onKeyDown(event: React.KeyboardEvent) {
    if (disabled) return;

    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      case "ArrowDown":
        event.preventDefault();
        setActive((index) => step(index, 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        setActive((index) => step(index, -1));
        return;
      case "Home":
        event.preventDefault();
        setActive(step(-1, 1));
        return;
      case "End":
        event.preventDefault();
        setActive(step(0, -1));
        return;
      case "Enter":
      case " ": {
        event.preventDefault();
        const option = options[active];
        if (option) choose(option);
        return;
      }
      case "Tab":
        setOpen(false);
        return;
      default:
        break;
    }

    // Typeahead: the letters typed within a second of each other are one term,
    // the way the native control behaves.
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now();
      seek.current.term = now - seek.current.at > 1000 ? event.key : seek.current.term + event.key;
      seek.current.at = now;
      const term = seek.current.term.toLowerCase();
      const hit = options.findIndex(
        (option) => !option.disabled && option.label.toLowerCase().startsWith(term),
      );
      if (hit >= 0) setActive(hit);
    }
  }

  const list = open && anchor && (
    <div
      ref={listRef}
      id={listId}
      role="listbox"
      aria-label={ariaLabel}
      className="card-float menu-in fixed z-[80] overflow-y-auto p-1.5"
      style={{
        left: anchor.left,
        width: Math.max(anchor.width, 176),
        maxHeight: MENU_MAX_HEIGHT,
        ...(anchor.drop === "down"
          ? { top: anchor.top }
          : { top: "auto", bottom: window.innerHeight - anchor.top }),
        ["--origin" as string]: anchor.drop === "down" ? "top center" : "bottom center",
      }}
    >
      {options.map((option, index) => {
        const isSelected = option.value === current;
        return (
          <button
            key={option.value || `blank-${index}`}
            type="button"
            role="option"
            data-index={index}
            aria-selected={isSelected}
            disabled={option.disabled}
            onMouseEnter={() => !option.disabled && setActive(index)}
            onClick={() => choose(option)}
            className={`flex w-full items-start gap-2 rounded-[14px] px-2.5 py-2 text-left text-[0.8125rem] transition-colors ${
              option.disabled
                ? "cursor-not-allowed text-ink-3 opacity-60"
                : index === active
                  ? "bg-accent/[0.09] text-ink"
                  : "text-ink-2"
            }`}
          >
            <Check
              size={14}
              className={`mt-[0.15rem] shrink-0 text-accent ${isSelected ? "" : "invisible"}`}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink">{option.label}</span>
              {option.hint && (
                <span className="mt-0.5 block text-[0.6875rem] leading-snug text-ink-3">
                  {option.hint}
                </span>
              )}
            </span>
          </button>
        );
      })}
      {options.length === 0 && (
        <p className="px-2.5 py-3 text-[0.75rem] text-ink-3">Nothing to choose from.</p>
      )}
    </div>
  );

  return (
    <>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        role="combobox"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-required={required || undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={`field inline-flex items-center justify-between gap-2 text-left ${className}`}
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? "text-ink" : "text-ink-3"}`}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-ink-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {/* The value the form actually submits, so every server action that was
          reading `name` off a native <select> carries on unchanged.

          `required` is deliberately not on it: the browser skips constraint
          validation for hidden inputs, so claiming it here would look like a
          guard and be none. An empty required choice is caught where it is
          actually checked — in the action. */}
      {name && <input type="hidden" name={name} value={current} />}
      {typeof document !== "undefined" && list ? createPortal(list, document.body) : null}
    </>
  );
}
