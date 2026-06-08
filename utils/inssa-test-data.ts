export const INSSA_FIND_BUTTON_PATTERN = /^find$/i;
export const INSSA_BURY_BUTTON_PATTERN = /^bury$/i;
export const INSSA_SIGN_IN_PATTERN = /^sign in$/i;
export const INSSA_FIND_CHOOSER_PATTERN = /uncover nearby time capsules|choose what you want to uncover|uncover now/i;
export const INSSA_TIME_CAPSULE_ROUTE_PATTERN = /\/timecapsule(?:\?|$)/i;
export const INSSA_TIME_CAPSULE_NEXT_PATTERN = /next=.*%2Ftimecapsule/i;
export const INSSA_DRAFTS_ROUTE = "/messages?tab=1&drafts=1";
export const INSSA_DRAFTS_SURFACE_PATTERN = /my time capsules|viewing drafts|drafts \(/i;
export const INSSA_COMPOSE_STEP_PATTERN = /compose|media|share/i;
export const INSSA_COMPOSE_STEP_HEADING_PATTERN = /step\s*\d\s*:\s*(compose|media|add\s+media(?:\s*&\s*bury)?|share)/i;
export const INSSA_COMPOSE_STEP_COMPOSE_PATTERN = /step\s*1\s*:\s*compose/i;
export const INSSA_COMPOSE_STEP_MEDIA_PATTERN = /step\s*2\s*:\s*(?:media|add\s+media(?:\s*&\s*bury)?)/i;
export const INSSA_COMPOSE_STEP_SHARE_PATTERN = /step\s*3\s*:\s*share/i;
export const INSSA_SUBJECT_LABEL_PATTERN = /subject\*/i;
export const INSSA_MESSAGE_LABEL_PATTERN = /your message\*/i;
export const INSSA_SUBJECT_COUNTER_PATTERN = /\/140\b/i;
export const INSSA_MESSAGE_COUNTER_PATTERN = /\/3000\b/i;
export const INSSA_DISCARD_DRAFT_PATTERN = /discard draft/i;
export const INSSA_SAVE_EXIT_PATTERN = /save\s*&\s*exit/i;
export const INSSA_BACK_STEP_PATTERN = /^back(?: and save)?$/i;
export const INSSA_NEXT_STEP_PATTERN = /^next step$|^next$|^continue$/i;
export const INSSA_DELETE_CAPSULE_PATTERN = /delete capsule|delete draft|delete/i;
export const INSSA_ARCHIVE_CAPSULE_PATTERN = /archive capsule|archive/i;
export const INSSA_HIDE_CAPSULE_PATTERN = /hide capsule|hide/i;
export const INSSA_EDIT_CAPSULE_PATTERN = /edit capsule|edit draft|edit/i;
export const INSSA_UNPUBLISH_CAPSULE_PATTERN = /unpublish|make private|remove from public|disable share/i;
export const INSSA_PUBLISH_CAPSULE_PATTERN = /publish capsule|publish|seal capsule|seal/i;
export const INSSA_LIVE_CREATE_ACTION_PATTERN =
  /publish capsule|publish|seal capsule|seal|^bury$|^share$|^send$|^finish$|create capsule|^create$/i;
export const INSSA_LIVE_CREATE_SUCCESS_PATTERN =
  /copy share link|share link|capsule (?:created|ready|shared|buried)|your capsule (?:is )?(?:ready|live|created)|ready to share|successfully (?:created|shared|buried)/i;
export const INSSA_REVEAL_SETTINGS_TITLE_PATTERN = /reveal settings/i;
export const INSSA_REVEAL_SETTINGS_STEP_PATTERN = /step\s*1\s*of\s*2|step\s*2\s*of\s*2/i;
export const INSSA_PERSONAL_MEMORY_PATTERN = /personal memory/i;
export const INSSA_SHARED_CAPSULE_PATTERN = /shared capsule/i;
export const INSSA_REVEAL_NOW_PATTERN = /reveal now/i;
export const INSSA_REVEAL_LATER_PATTERN = /reveal later/i;
export const INSSA_REVEAL_CONTINUE_PATTERN = /^continue$/i;
export const INSSA_REVEAL_CANCEL_PATTERN = /^cancel$/i;
export const INSSA_COPY_SHARE_LINK_PATTERN = /copy share link/i;
export const INSSA_SHARE_LINK_BUTTON_PATTERN = /^share link$/i;
export const INSSA_HOME_BUTTON_PATTERN = /^home$/i;
export const INSSA_SAFE_REVEAL_FOLLOWUP_PATTERN =
  /^share by link$|^skip contacts(?:\s*&\s*share link with others)?$|^done$|^continue$/i;
export const INSSA_CONTACT_SELECTION_PATTERN = /contacts?|people|friends|search/i;
export const INSSA_CAPSULE_SHARE_LINK_PATTERN = /(?:https?:\/\/[^\s"'<>]+)?\/capsule\/[^\s"'<>]+/i;
export const INSSA_REMOTE_IMAGE_INPUT_PATTERN = /image url|image link|paste.*url|paste.*link|https?:\/\/|url|link/i;
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

export type InssaComposeRouteLocation = {
  address: string;
  key?: string;
  label: string;
  lat: number;
  lng: number;
  marketRegion?: string;
  place?: string;
  placeId?: string;
};

export type InssaUsMarketLocationKey = "austin" | "chicago" | "los-angeles" | "miami" | "nyc" | "seattle";

export type InssaUsMarketLocation = InssaComposeRouteLocation & {
  key: InssaUsMarketLocationKey;
  marketRegion: "east-coast" | "midwest" | "south-central" | "southeast" | "west-coast";
};

export const INSSA_US_MARKET_LOCATIONS: InssaUsMarketLocation[] = [
  {
    key: "nyc",
    label: "New York, NY",
    lat: 40.758,
    lng: -73.9855,
    address: "Times Square, Manhattan, New York, NY 10036, USA",
    marketRegion: "east-coast",
    place: "New York, NY",
    placeId: ""
  },
  {
    key: "los-angeles",
    label: "Los Angeles, CA",
    lat: 34.0522,
    lng: -118.2437,
    address: "Downtown Los Angeles, Los Angeles, CA 90012, USA",
    marketRegion: "west-coast",
    place: "Los Angeles, CA",
    placeId: ""
  },
  {
    key: "chicago",
    label: "Chicago, IL",
    lat: 41.8781,
    lng: -87.6298,
    address: "Millennium Park, Chicago, IL 60601, USA",
    marketRegion: "midwest",
    place: "Chicago, IL",
    placeId: ""
  },
  {
    key: "miami",
    label: "Miami, FL",
    lat: 25.7617,
    lng: -80.1918,
    address: "Downtown Miami, Miami, FL 33132, USA",
    marketRegion: "southeast",
    place: "Miami, FL",
    placeId: ""
  },
  {
    key: "austin",
    label: "Austin, TX",
    lat: 30.2672,
    lng: -97.7431,
    address: "Downtown Austin, Austin, TX 78701, USA",
    marketRegion: "south-central",
    place: "Austin, TX",
    placeId: ""
  },
  {
    key: "seattle",
    label: "Seattle, WA",
    lat: 47.6062,
    lng: -122.3321,
    address: "Pike Place Market, Seattle, WA 98101, USA",
    marketRegion: "west-coast",
    place: "Seattle, WA",
    placeId: ""
  }
];

export const DEFAULT_INSSA_US_MARKET_LOCATION_KEY: InssaUsMarketLocationKey = "nyc";

export function buildInssaComposeRouteForLocation(location: InssaComposeRouteLocation): string {
  const params = new URLSearchParams({
    address: location.address,
    lat: String(location.lat),
    lng: String(location.lng),
    place: location.place ?? location.label,
    placeId: location.placeId ?? ""
  });

  return `/timecapsule?${params.toString()}`;
}

export function getInssaUsMarketLocation(key: string): InssaUsMarketLocation | null {
  const normalized = key.trim().toLowerCase();
  return INSSA_US_MARKET_LOCATIONS.find((location) => location.key === normalized) ?? null;
}

export function getInssaComposeTemplateDefaults(route: string = INSSA_DEFAULT_COMPOSE_ROUTE): {
  address: string;
  message: string;
  placeName: string;
  subject: string;
} {
  const parsed = new URL(route, "https://staging.inssa.us");
  const address = parsed.searchParams.get("address")?.trim() ?? "";
  const placeName = parsed.searchParams.get("place")?.trim() ?? "";
  const subject = placeName || address;
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
