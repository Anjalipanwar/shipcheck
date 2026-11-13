import { devices } from 'playwright';
import { REPO_URL, VERSION } from '../version.js';

export type DeviceName = 'desktop' | 'mobile';

export interface DevicePreset {
  name: DeviceName;
  label: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  /** undefined = use the browser's own user agent. */
  userAgent: string | undefined;
}

/** SPEC §7.8: identify ourselves to the sites we test. */
export const USER_AGENT_SUFFIX = `ShipCheck/${VERSION} (+${REPO_URL})`;

export function withShipCheckSuffix(userAgent: string): string {
  // Headless Chrome announces itself as "HeadlessChrome"; some sites serve it a different page.
  return `${userAgent.replace('HeadlessChrome', 'Chrome')} ${USER_AGENT_SUFFIX}`;
}

export const DESKTOP: DevicePreset = {
  name: 'desktop',
  label: 'Desktop (1280×800)',
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
  userAgent: undefined,
};

const iphone = devices['iPhone 13'];

/** SPEC §6.1: iPhone viewport 390×844, touch, mobile user agent. */
export const MOBILE: DevicePreset = {
  name: 'mobile',
  label: 'iPhone (390×844)',
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: iphone?.userAgent,
};
