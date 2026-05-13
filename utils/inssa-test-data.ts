export const INSSA_FIND_BUTTON_PATTERN = /^find$/i;
export const INSSA_BURY_BUTTON_PATTERN = /^bury$/i;
export const INSSA_SIGN_IN_PATTERN = /^sign in$/i;
export const INSSA_FIND_CHOOSER_PATTERN = /uncover nearby time capsules|choose what you want to uncover|uncover now/i;
export const INSSA_TIME_CAPSULE_ROUTE_PATTERN = /\/timecapsule(?:\?|$)/i;
export const INSSA_TIME_CAPSULE_NEXT_PATTERN = /next=.*%2Ftimecapsule/i;
export const INSSA_DRAFTS_ROUTE = "/messages?tab=1&drafts=1";
export const INSSA_DRAFTS_SURFACE_PATTERN = /my time capsules|viewing drafts|drafts \(/i;
export const INSSA_COMPOSE_STEP_PATTERN = /compose|media|share/i;
export const INSSA_SUBJECT_LABEL_PATTERN = /subject\*/i;
export const INSSA_MESSAGE_LABEL_PATTERN = /your message\*/i;
export const INSSA_SUBJECT_COUNTER_PATTERN = /\/140\b/i;
export const INSSA_MESSAGE_COUNTER_PATTERN = /\/3000\b/i;
export const INSSA_DISCARD_DRAFT_PATTERN = /discard draft/i;
export const INSSA_SAVE_EXIT_PATTERN = /save\s*&\s*exit/i;
export const INSSA_DELETE_CAPSULE_PATTERN = /delete capsule|delete draft|delete/i;
export const INSSA_ARCHIVE_CAPSULE_PATTERN = /archive capsule|archive/i;
export const INSSA_HIDE_CAPSULE_PATTERN = /hide capsule|hide/i;
export const INSSA_EDIT_CAPSULE_PATTERN = /edit capsule|edit draft|edit/i;
export const INSSA_PUBLISH_CAPSULE_PATTERN = /publish capsule|publish|seal capsule|seal/i;
export const INSSA_GENERIC_JS_SHELL_PATTERN = /you need to enable javascript to run this app/i;
export const INSSA_PROFILE_SURFACE_PATTERN = /\bprofile\b/i;
export const INSSA_POINTS_LEDGER_PATTERN = /your momentum|how to earn points|activity entries/i;
export const INSSA_SETTINGS_PATTERN = /my settings|appearance|membership|notification preferences/i;
export const INSSA_CONNECTIONS_PATTERN = /my contacts|find people|no contacts yet|your network/i;
export const INSSA_REQUESTS_PATTERN = /contact requests|incoming|outgoing|no incoming connection requests/i;
export const INSSA_COMPOSE_REFRESH_CACHE_KEY_PREFIX = "timecapsule-refresh:";
export const INSSA_COMPOSE_INITIAL_DRAFT_KEY_PREFIX = "timecapsule-initial-draft:";

export const INSSA_DEFAULT_COMPOSE_ROUTE =
  "/timecapsule?lat=53.3382&lng=-6.2591&address=8PQR%2B79%20Dublin%2C%20County%20Dublin%2C%20Ireland&place=&placeId=";

export function getInssaComposeTemplateDefaults(route: string = INSSA_DEFAULT_COMPOSE_ROUTE): {
  address: string;
  message: string;
  placeName: string;
  subject: string;
} {
  const parsed = new URL(route, "https://staging.inssa.us");
  const address = parsed.searchParams.get("address")?.trim() ?? "";
  const placeName = parsed.searchParams.get("place")?.trim() ?? "";
  const subject = address;
  const locationLabel = placeName && address && placeName !== address ? `${placeName} (${address})` : placeName || address;

  return {
    address,
    message: locationLabel ? `This place made me think of you: ${locationLabel}` : "",
    placeName,
    subject
  };
}

export type InssaStableSurface =
  | "auth"
  | "compose"
  | "connections"
  | "landing-authenticated"
  | "landing-public"
  | "points-ledger"
  | "profile"
  | "requests"
  | "settings";

export type InssaStableRouteCase = {
  access: "auth" | "protected" | "public";
  label: string;
  path: string;
  loggedIn: {
    finalPathPattern: RegExp;
    surface: InssaStableSurface;
  };
  loggedOut: {
    finalPathPattern: RegExp;
    surface: InssaStableSurface;
  };
};

export const INSSA_STABLE_ROUTE_CASES: InssaStableRouteCase[] = [
  {
    access: "public",
    label: "home",
    path: "/",
    loggedIn: {
      finalPathPattern: /^\/$/,
      surface: "landing-authenticated"
    },
    loggedOut: {
      finalPathPattern: /^\/$/,
      surface: "landing-public"
    }
  },
  {
    access: "auth",
    label: "sign-in",
    path: "/signin",
    loggedIn: {
      finalPathPattern: /^\/signin(?:\/)?$/,
      surface: "auth"
    },
    loggedOut: {
      finalPathPattern: /^\/signin(?:\/)?$/,
      surface: "auth"
    }
  },
  {
    access: "protected",
    label: "profile-me",
    path: "/me",
    loggedIn: {
      finalPathPattern: /^\/(?:me|u\/[^/]+)(?:\/)?$/,
      surface: "profile"
    },
    loggedOut: {
      finalPathPattern: /^\/signin(?:\/)?$/,
      surface: "auth"
    }
  },
  {
    access: "protected",
    label: "points-ledger",
    path: "/points-ledger",
    loggedIn: {
      finalPathPattern: /^\/points-ledger(?:\/)?$/,
      surface: "points-ledger"
    },
    loggedOut: {
      finalPathPattern: /^\/signin(?:\/)?$/,
      surface: "auth"
    }
  },
  {
    access: "protected",
    label: "settings",
    path: "/settings",
    loggedIn: {
      finalPathPattern: /^\/settings(?:\/)?$/,
      surface: "settings"
    },
    loggedOut: {
      finalPathPattern: /^\/signin(?:\/)?$/,
      surface: "auth"
    }
  },
  {
    access: "protected",
    label: "connections",
    path: "/profile/connections",
    loggedIn: {
      finalPathPattern: /^\/profile\/connections(?:\/)?$/,
      surface: "connections"
    },
    loggedOut: {
      finalPathPattern: /^\/signin(?:\/)?$/,
      surface: "auth"
    }
  },
  {
    access: "protected",
    label: "requests",
    path: "/profile/connections/requests",
    loggedIn: {
      finalPathPattern: /^\/profile\/connections\/requests(?:\/)?$/,
      surface: "requests"
    },
    loggedOut: {
      finalPathPattern: /^\/signin(?:\/)?$/,
      surface: "auth"
    }
  },
  {
    access: "protected",
    label: "compose",
    path: INSSA_DEFAULT_COMPOSE_ROUTE,
    loggedIn: {
      finalPathPattern: /^\/timecapsule(?:\/)?(?:\?.*)?$/,
      surface: "compose"
    },
    loggedOut: {
      finalPathPattern: /^\/signin(?:\/)?$/,
      surface: "auth"
    }
  }
];
