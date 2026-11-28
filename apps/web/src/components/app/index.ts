/**
 * The app kit (WP1): the shared pieces every screen is built from. Import from "@/components/app".
 *
 *   PageHeader, NotAvailable, EmptyState, PageSkeleton (+ Stats/Table/List/FormSkeleton)
 *   StatusBadge, Money, MoneyInput, CountInput, DateField, MonthPicker, UrlMonthPicker
 *   DataTable, FormDialog, ConfirmAction
 *   useAppForm, AppForm, FormField, SubmitButton, mapServerError
 *   toast
 * Hooks are in "@/hooks": usePageTitle, useUrlState, useMonthParam, useDelayedLoading, useIsNarrow, useMediaQuery.
 */
export { ConfirmAction, type ConfirmActionProps } from "./ConfirmAction";
export { CountInput } from "./CountInput";
export { type DataColumn, DataTable, type DataTableProps, type MobileRow } from "./DataTable";
export { DateField, dateOf, isoOf } from "./DateField";
export { EmptyState } from "./EmptyState";
export { FormDialog, type FormDialogProps } from "./FormDialog";
export {
  AppForm,
  type FormControlProps,
  FormField,
  mapServerError,
  SubmitButton,
  useAppForm,
} from "./form";
export { Money } from "./Money";
export { MoneyInput, moneyInputPaise } from "./MoneyInput";
export { MonthPicker, shiftMonth, UrlMonthPicker } from "./MonthPicker";
export { NotAvailable } from "./NotAvailable";
export { InsideHub, PageHeader } from "./PageHeader";
export { type Status, StatusBadge } from "./StatusBadge";
export {
  FormSkeleton,
  ListSkeleton,
  PageSkeleton,
  StatsSkeleton,
  TableSkeleton,
} from "./skeletons";
export { toast } from "./toast";

// The /dev/kit page is not exported here, so it stays out of the main bundle. Mount it lazily, in development or in a
// build with VITE_KIT=1: TODO(WP2) in App.tsx:
//   const KitPage = lazy(() => import("@/components/app/dev/KitPage").then((m) => ({ default: m.KitPage })));
//   {(import.meta.env.DEV || import.meta.env.VITE_KIT === "1") && <Route path="/dev/kit" component={KitPage} />}
