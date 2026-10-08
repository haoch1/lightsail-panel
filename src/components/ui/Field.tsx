import type { ReactNode } from "react";
import { cloneElement, isValidElement, useId } from "react";
import Select from "./Select";
export function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactNode;
}) {
  const id = useId();
  const native =
    isValidElement(children) &&
    ((typeof children.type === "string" &&
      ["input", "select", "textarea"].includes(children.type)) ||
      children.type === Select);
  const control = native
    ? cloneElement(
        children as React.ReactElement<{
          id?: string;
          "aria-describedby"?: string;
        }>,
        { id, "aria-describedby": help ? id + "-help" : undefined },
      )
    : children;
  return (
    <div className="field">
      <label htmlFor={native ? id : undefined}>{label}</label>
      {control}
      {help && <small id={id + "-help"}>{help}</small>}
    </div>
  );
}
