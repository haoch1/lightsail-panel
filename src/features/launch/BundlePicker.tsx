import type { Catalog } from "../../../shared/types";
import Select from "../../components/ui/Select";
import { compactBundleLabel } from "../../lib/bundle";

type Props = {
  bundles: Catalog["types"];
  value: string;
  onChange: (value: string) => void;
};

export default function BundlePicker({ bundles, value, onChange }: Props) {
  return (
    <Select
      aria-label="实例套餐"
      required
      className="bundle-select"
      menuClassName="bundle-menu"
      openFromStart
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="" disabled>
        选择套餐
      </option>
      {bundles.map((bundle) => (
        <option key={bundle.id} value={bundle.id}>
          {compactBundleLabel(bundle)}
        </option>
      ))}
    </Select>
  );
}
