Add stronger Local Man tests without breaking existing smoke coverage.

Coverage needed:
- Discovery loads vendors.
- Map renders or fallback renders.
- Selecting a vendor updates selected preview.
- Detail page opens.
- Back-to-map flow restores state.
- Call and directions buttons are clickable.
- Mobile layout has no horizontal overflow.
- Admin route loads behind auth and does not expose admin content publicly.

Rules:
- Use stable selectors where available.
- If selectors are missing, propose data-testid attributes in the app repo separately.
- Keep tests deterministic.
- Do not require production-only credentials.
