import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function MonthPicker({
  value,
  max,
  onChange,
}: {
  value: string;
  max: string;
  onChange: (month: string) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [year, setYear] = useState(Number(value.slice(0, 4)));
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const box = trigger.current!.getBoundingClientRect();
      setPosition({
        left: Math.max(8, Math.min(box.left, innerWidth - 284)),
        top: box.bottom + 5,
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (
        !root.current?.contains(e.target as Node) &&
        !menu.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    const scroll = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", scroll, true);
    menu.current
      ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
      ?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [open]);
  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }
  function choose(month: string) {
    onChange(month);
    close();
  }
  return (
    <div className="month-picker" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="month-trigger"
        aria-label={`费用月份：${value.slice(0, 4)}年${Number(value.slice(5))}月`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          if (open) close();
          else {
            setYear(Number(value.slice(0, 4)));
            setOpen(true);
          }
        }}
      >
        <span>
          {value.slice(0, 4)}年{Number(value.slice(5))}月
        </span>
        <CalendarDays size={16} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="dialog"
            aria-label="选择费用月份"
            className="month-menu"
            style={position}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                close();
              }
            }}
          >
            <div className="month-year">
              <button
                type="button"
                className="icon-button"
                aria-label="上一年"
                disabled={year <= 2000}
                onClick={() => setYear(year - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <strong>{year}年</strong>
              <button
                type="button"
                className="icon-button"
                aria-label="下一年"
                disabled={year >= Number(max.slice(0, 4))}
                onClick={() => setYear(year + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="month-grid">
              {Array.from({ length: 12 }, (_, index) => {
                const month = `${year}-${String(index + 1).padStart(2, "0")}`;
                return (
                  <button
                    key={month}
                    type="button"
                    disabled={month > max}
                    aria-label={`${year}年${index + 1}月`}
                    aria-pressed={month === value}
                    onClick={() => choose(month)}
                  >
                    {index + 1}月
                  </button>
                );
              })}
            </div>
            <div className="month-footer">
              <button
                type="button"
                className="text-link"
                onClick={() => choose(max)}
              >
                回到本月
              </button>
              <button type="button" className="text-link" onClick={close}>
                关闭
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
