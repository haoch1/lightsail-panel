import { createContext, useContext } from "react";
import type { Account, Region, ToastFn } from "../../shared/types";
export { useApi } from "../hooks/useApi";
export interface Panel {
  accounts: Account[];
  accountId: string;
  region: string;
  regions: Region[];
  toast: ToastFn;
  navigate: (path: string) => void;
  refreshAccounts: () => void;
  openAccounts: () => void;
  setScope: (accountId: string, region: string) => void;
  demo: boolean;
}
export const PanelContext = createContext<Panel>(null!);
export const usePanel = () => useContext(PanelContext);
