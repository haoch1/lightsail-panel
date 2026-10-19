import type { InputHTMLAttributes, ReactNode } from "react";
import { useEffect, useRef, useId } from "react";
import { ignoreAutofill } from "../../lib/input-autofill";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  children?: ReactNode;
  description?: ReactNode;
  pending?: boolean;
  indeterminate?: boolean;
};

export function Checkbox({
  children,
  description,
  pending = false,
  indeterminate = false,
  ...props
}: Props) {
  const descriptionId = useId();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const input = (
    <input
      ref={ref}
      {...props}
      {...ignoreAutofill}
      disabled={props.disabled || pending}
      data-pending={(pending && !props.disabled) || undefined}
      type="checkbox"
      aria-describedby={description ? descriptionId : props["aria-describedby"]}
    />
  );
  if (!children) return <label className="selection-box">{input}</label>;
  const label = (
    <label className="check-label">
      {input}
      <span className="check-text">{children}</span>
    </label>
  );
  return description ? (
    <div className="check-field">
      {label}
      <p id={descriptionId} className="check-description">
        {description}
      </p>
    </div>
  ) : (
    label
  );
}
