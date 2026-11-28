import { SetupHub } from "./Setup.tsx";

// TODO(WP2): the shell mounts the whole hub: route `setup/:tab` to `SetupHub` (it reads the tab from the address) and
// drop its HubTabs for Setup. Until then each tab's old entry point shows the hub on its tab.
export const Rates = () => <SetupHub tab="rules" />;
