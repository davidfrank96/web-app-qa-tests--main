export const LOCALMAN_EMPTY_STATE_TEXT = "No vendors matched this search";
export const LOCALMAN_EMPTY_STATE_PATTERN = /No vendors matched this search\.?/i;

export type LocalManEmptyState = {
  kind: "empty";
  message: typeof LOCALMAN_EMPTY_STATE_TEXT;
};

export type LocalManVendorState = {
  kind: "vendors";
  vendorCount: number;
};

export type LocalManDiscoveryState = LocalManEmptyState | LocalManVendorState;

export function detectLocalManDiscoveryState(signals: {
  emptyStateVisible: boolean;
  vendorCount: number;
}): LocalManDiscoveryState | null {
  if (signals.emptyStateVisible) {
    return {
      kind: "empty",
      message: LOCALMAN_EMPTY_STATE_TEXT
    };
  }

  if (signals.vendorCount > 0) {
    return {
      kind: "vendors",
      vendorCount: signals.vendorCount
    };
  }

  return null;
}

export function hasLocalManVendors(
  state: LocalManDiscoveryState
): state is LocalManVendorState {
  return state.kind === "vendors";
}
