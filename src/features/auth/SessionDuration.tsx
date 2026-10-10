import { Field } from "../../components/ui";
import Select from "../../components/ui/Select";

export default function SessionDuration({
  hours,
  onChange,
  disabled = false,
}: {
  hours: number;
  onChange: (hours: number) => void;
  disabled?: boolean;
}) {
  return (
    <Field label="登录有效期">
      <Select
        aria-label="登录有效期"
        disabled={disabled}
        value={String(hours)}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {[
          { value: 12, label: "12 小时" },
          { value: 24, label: "1 天" },
          { value: 168, label: "7 天" },
          { value: 720, label: "30 天" },
          { value: 2160, label: "90 天" },
        ].map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}
