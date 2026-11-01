import * as Popover from "@radix-ui/react-popover";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
export default function MonthPicker({
  value,
  max,
  onChange,
}: {
  value: string;
  max: string;
  onChange: (month: string) => void;
}) {
  const content = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(value.slice(0, 4)));
  function close() {
    setOpen(false);
  }
  function choose(month: string) {
    onChange(month);
    close();
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setYear(Number(value.slice(0, 4)));
      }}
    >
      <div className="month-picker">
        <Popover.Trigger asChild>
          <button
            type="button"
            className="month-trigger"
            aria-label={
              "费用月份：" +
              value.slice(0, 4) +
              "年" +
              Number(value.slice(5)) +
              "月"
            }
          >
            <span>
              {value.slice(0, 4)}年{Number(value.slice(5))}月
            </span>
            <CalendarDays size={16} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            ref={content}
            className="month-menu"
            aria-label="选择费用月份"
            sideOffset={5}
            collisionPadding={12}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              content.current
                ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
                ?.focus({ preventScroll: true });
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
          </Popover.Content>
        </Popover.Portal>
      </div>
    </Popover.Root>
  );
}
