import type { InputHTMLAttributes, ReactNode } from "react";
import { useId } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  children?: ReactNode;
  description?: ReactNode;
};

export function Checkbox({ children, description, ...props }: Props) {
  const descriptionId = useId();
  const input = (
    <input
      {...props}
      type="checkbox"
      aria-describedby={description ? descriptionId : props["aria-describedby"]}
    />
  );
  if (!children) return input;
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
