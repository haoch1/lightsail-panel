import { useRef } from "react";
export function SegmentedControl({
  value,
  onChange,
  label,
  options,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: ReadonlyArray<readonly [string, string]>;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className="segmented-control"
      role="group"
      aria-label={label}
      onKeyDown={(event) => {
        if (
          event.nativeEvent.isComposing ||
          !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) ||
          disabled
        )
          return;
        event.preventDefault();
        const index = options.findIndex(([id]) => id === value);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? options.length - 1
              : (index +
                  (event.key === "ArrowRight" ? 1 : -1) +
                  options.length) %
                options.length;
        onChange(options[next][0]);
        ref.current
          ?.querySelectorAll<HTMLButtonElement>("button")
          [next]?.focus();
      }}
    >
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          disabled={disabled}
          aria-pressed={id === value}
          data-state={id === value ? "on" : "off"}
          tabIndex={id === value ? 0 : -1}
          onClick={() => onChange(id)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
