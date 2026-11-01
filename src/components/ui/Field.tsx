import type { ReactNode } from "react";
import { cloneElement, isValidElement, useId } from "react";
import Select from "./Select";
import { Input } from "./Input";
import { ignoreAutofill } from "../../lib/input-autofill";
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
      children.type === Select ||
      children.type === Input);
  const control = native
    ? cloneElement(
        children as React.ReactElement<{
          id?: string;
          "aria-describedby"?: string;
          type?: string;
        }>,
        {
          ...(typeof children.type === "string" &&
          ["input", "textarea"].includes(children.type) &&
          (children.props as { type?: string }).type?.toLowerCase() !==
            "password"
            ? ignoreAutofill
            : {}),
          id,
          "aria-describedby": help ? id + "-help" : undefined,
        },
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
