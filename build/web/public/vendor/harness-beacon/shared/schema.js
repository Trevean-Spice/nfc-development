/*
 * Shared record schema for the Trevean Spice measurement harness.
 *
 * One instrument records four things with the same vocabulary:
 *   1. the bench runs,
 *   2. the 28 August 2026 gate,
 *   3. the September full-matrix re-run,
 *   4. every customer tap after launch (the field beacon).
 *
 * So the number accepted in August is measured the same way as the number
 * reviewed in December. See the Architecture document, Measurement section.
 *
 * Two rules are baked into the type names on purpose, because a field name is
 * read more often than a comment:
 *
 *   navigationToReadableMs   is SCORED against the 2.0 s budget.
 *   osConfirmationStepMs     is RECORDED AND REPORTED, NEVER SCORED.
 *
 * The second one is the OS handoff: on iOS the notification banner the user has
 * to tap, on Android the direct browser launch. It is excluded from acceptance
 * by the Acceptance criteria document, section 6.1, and it is not a defect on
 * either platform.
 */
export const HARNESS_VERSION = '1.0.0';
export const GATE_SCHEMA = 'trevean-gate-run/1';
export const BEACON_SCHEMA = 'trevean-field-beacon/1';
/** Acceptance criteria, section 6.2: readable within 2.0 s of navigation start. */
export const READABLE_BUDGET_MS = 2000;
/** Acceptance criteria, section 6.1: at least 98% of taps produce a successful read. */
export const READ_SUCCESS_THRESHOLD_PCT = 98;
/** Acceptance criteria, section 6.1: ten taps per device per condition. */
export const TAPS_PER_DEVICE_PER_CONDITION = 10;
/** Hardware document: furthest repeatable distance, five confirming attempts. */
export const DISTANCE_CONFIRMING_ATTEMPTS = 5;
/**
 * Hardware document: the bamboo lid is 8 mm, corrected from 4 mm on 12 August
 * 2026. The 1.5 mm cork gasket sits below the tag and does not count against
 * the read path.
 */
export const LID_THICKNESS_MM = 8;
/** Hardware document: iPhone XS, the worst case, governs the lid budget. */
export const WORST_CASE_READ_DISTANCE_MM = 18;
export const DEVICE_STATES = [
    {
        id: 'ios-awake-unlocked',
        platform: 'ios',
        label: 'Display awake, unlocked',
        supported: true,
    },
    {
        id: 'ios-awake-locked',
        platform: 'ios',
        label: 'Display awake, locked',
        supported: true,
    },
    {
        id: 'ios-screen-off',
        platform: 'ios',
        label: 'Screen off',
        supported: false,
        warning: 'Screen off is zero reads on every iPhone. 50 attempts on 6 August produced nothing. This is OS behaviour and is excluded from scoring.',
    },
    {
        id: 'android-unlocked',
        platform: 'android',
        label: 'Unlocked',
        supported: true,
    },
    {
        id: 'android-locked-awake',
        platform: 'android',
        label: 'Locked, screen awake',
        supported: false,
        warning: 'A locked Android is zero reads. 80 attempts on 6 August produced nothing. This is OS behaviour and is excluded from scoring.',
    },
    {
        id: 'android-screen-off',
        platform: 'android',
        label: 'Screen off',
        supported: false,
        warning: 'Screen off is zero reads on every phone. This is OS behaviour and is excluded from scoring.',
    },
];
export function deviceStateInfo(id) {
    const found = DEVICE_STATES.find((s) => s.id === id);
    if (!found) {
        throw new Error(`Unknown device state: ${id}`);
    }
    return found;
}
export function statesForPlatform(platform) {
    return DEVICE_STATES.filter((s) => s.platform === platform);
}
export const READ_PATHS = [
    { id: 'bare', label: 'Bare tag, no lid' },
    { id: 'through-lid', label: `Through the ${LID_THICKNESS_MM} mm bamboo lid` },
];
export const PHONE_CASES = [
    { id: 'none', label: 'No case', mm: 0 },
    { id: 'thin', label: 'Thin case, about 2 mm', mm: 2 },
    { id: 'wallet', label: 'Wallet or thick case, about 4 mm', mm: 4 },
    { id: 'other', label: 'Other, measure and note it', mm: 0 },
];
export const FAILURE_REASONS = [
    { id: 'no-read', label: 'Nothing happened, no read' },
    { id: 'wrong-blend', label: 'Opened the wrong blend' },
    { id: 'not-found', label: 'Error page or 404' },
    { id: 'slow', label: 'Opened, but was not readable in time' },
    { id: 'other', label: 'Something else, see notes' },
];
/** The only values accepted from the via parameter. Anything else is direct. */
export const ARRIVALS = ['nfc', 'qr', 'direct'];
export function isGateRecord(value) {
    return (typeof value === 'object' &&
        value !== null &&
        value.schema === GATE_SCHEMA);
}
export function isBeaconEvent(value) {
    return (typeof value === 'object' &&
        value !== null &&
        value.schema === BEACON_SCHEMA);
}
