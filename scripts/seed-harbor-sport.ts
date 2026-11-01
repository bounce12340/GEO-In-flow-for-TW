#!/usr/bin/env tsx
/* eslint-disable no-console */

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

type Scalar = string | number | null;

interface WeightedOption<T> {
  value: T;
  weight: number;
}

interface Page {
  key: string;
  path: string;
  title: string;
  avgSeconds: number;
  pageW: number;
  pageH: number;
}

interface Product {
  sku: string;
  name: string;
  category: ProductCategory;
  pageKey: string;
  price: number;
}

interface Location {
  region: string;
  city: string;
}

interface Referrer {
  channel: string;
  domain: string | null;
  path: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
}

interface SessionContext {
  sessionId: string;
  visitId: string;
  country: string;
  region: string;
  city: string;
  device: string;
  browser: string;
  os: string;
  screen: string;
  language: string;
  distinctId: string;
  persona: Persona;
  customerType: string;
  intentScore: number;
  campaign: Campaign;
  referrer: Referrer;
  createdAt: Date;
}

interface Campaign {
  name: string;
  trafficMultiplier: number;
  conversionLift: number;
  category?: ProductCategory;
}

interface PageVisit {
  sessionId: string;
  visitId: string;
  pageKey: string;
  path: string;
  createdAt: Date;
  device: string;
  screen: string;
}

interface ReplayCandidate {
  sessionId: string;
  visitId: string;
  firstPath: string;
  screen: string;
  startedAt: Date;
  endedAt: Date;
}

type ProductCategory = 'running' | 'training' | 'cycling' | 'swim' | 'outdoor' | 'teamwear';
type Persona = 'runner' | 'trainer' | 'cyclist' | 'swimmer' | 'outdoor' | 'team_coach';
type JourneyKind =
  | 'bounce'
  | 'browse'
  | 'product'
  | 'cart'
  | 'checkout'
  | 'purchase'
  | 'content'
  | 'store';

const WEBSITE_ID = uuidFor('website', 'harbor-sport-demo');
const WEBSITE_NAME = 'Harbor Sport';
const WEBSITE_DOMAIN = 'localhost:3001';
const HOSTNAME = 'harbor-sport.demo';
const SHARE_SLUG = 'harbor-sport-demo';
let rng: Rng;

const EVENT_TYPE = {
  pageView: 1,
  customEvent: 2,
  performance: 5,
} as const;

const DATA_TYPE = {
  string: 1,
  number: 2,
} as const;

const HEATMAP_EVENT_TYPE = {
  click: 1,
  scroll: 2,
} as const;

const BASE_PATH = '/demo/harbor-sport';

const pages: Page[] = [
  {
    key: 'home',
    path: `${BASE_PATH}/index.html`,
    title: 'Harbor Sport | Performance Gear',
    avgSeconds: 46,
    pageW: 1440,
    pageH: 2200,
  },
  {
    key: 'shop',
    path: `${BASE_PATH}/shop.html`,
    title: 'Shop All Sport Gear',
    avgSeconds: 72,
    pageW: 1440,
    pageH: 2600,
  },
  {
    key: 'running',
    path: `${BASE_PATH}/running.html`,
    title: 'Running Shoes and Apparel',
    avgSeconds: 96,
    pageW: 1440,
    pageH: 2800,
  },
  {
    key: 'training',
    path: `${BASE_PATH}/training.html`,
    title: 'Training and Gym Gear',
    avgSeconds: 88,
    pageW: 1440,
    pageH: 2500,
  },
  {
    key: 'cycling',
    path: `${BASE_PATH}/cycling.html`,
    title: 'Cycling Apparel and Accessories',
    avgSeconds: 84,
    pageW: 1440,
    pageH: 2400,
  },
  {
    key: 'swim',
    path: `${BASE_PATH}/swim.html`,
    title: 'Swim Collection',
    avgSeconds: 78,
    pageW: 1440,
    pageH: 2300,
  },
  {
    key: 'outdoor',
    path: `${BASE_PATH}/outdoor.html`,
    title: 'Outdoor Training Essentials',
    avgSeconds: 82,
    pageW: 1440,
    pageH: 2400,
  },
  {
    key: 'teamwear',
    path: `${BASE_PATH}/teamwear.html`,
    title: 'Teamwear and Club Orders',
    avgSeconds: 112,
    pageW: 1440,
    pageH: 2600,
  },
  {
    key: 'productRunner',
    path: `${BASE_PATH}/product/aero-runner-elite.html`,
    title: 'Aero Runner Elite',
    avgSeconds: 142,
    pageW: 1440,
    pageH: 2300,
  },
  {
    key: 'productTrainer',
    path: `${BASE_PATH}/product/coreflex-trainer.html`,
    title: 'CoreFlex Trainer',
    avgSeconds: 128,
    pageW: 1440,
    pageH: 2200,
  },
  {
    key: 'productCycling',
    path: `${BASE_PATH}/product/coastal-cycling-kit.html`,
    title: 'Coastal Cycling Kit',
    avgSeconds: 118,
    pageW: 1440,
    pageH: 2200,
  },
  {
    key: 'productSwim',
    path: `${BASE_PATH}/product/tide-swim-pack.html`,
    title: 'Tide Swim Pack',
    avgSeconds: 104,
    pageW: 1440,
    pageH: 2100,
  },
  {
    key: 'productOutdoor',
    path: `${BASE_PATH}/product/trail-shell.html`,
    title: 'Trail Shell',
    avgSeconds: 112,
    pageW: 1440,
    pageH: 2200,
  },
  {
    key: 'cart',
    path: `${BASE_PATH}/cart.html`,
    title: 'Shopping Cart',
    avgSeconds: 64,
    pageW: 1440,
    pageH: 1500,
  },
  {
    key: 'checkout',
    path: `${BASE_PATH}/checkout.html`,
    title: 'Secure Checkout',
    avgSeconds: 92,
    pageW: 1440,
    pageH: 1600,
  },
  {
    key: 'complete',
    path: `${BASE_PATH}/checkout-complete.html`,
    title: 'Order Complete',
    avgSeconds: 34,
    pageW: 1440,
    pageH: 1200,
  },
  {
    key: 'blogRace',
    path: `${BASE_PATH}/blog/half-marathon-training.html`,
    title: 'Half Marathon Training Guide',
    avgSeconds: 176,
    pageW: 1440,
    pageH: 3000,
  },
  {
    key: 'stores',
    path: `${BASE_PATH}/stores.html`,
    title: 'Find a Harbor Sport Store',
    avgSeconds: 58,
    pageW: 1440,
    pageH: 1800,
  },
  {
    key: 'sale',
    path: `${BASE_PATH}/sale.html`,
    title: 'Seasonal Sale',
    avgSeconds: 86,
    pageW: 1440,
    pageH: 2600,
  },
  {
    key: 'sizeGuide',
    path: `${BASE_PATH}/size-guide.html`,
    title: 'Size Guide',
    avgSeconds: 74,
    pageW: 1440,
    pageH: 1700,
  },
];

const pageByKey = new Map(pages.map(page => [page.key, page]));

const products: Product[] = [
  {
    sku: 'HS-RUN-AERO-01',
    name: 'Aero Runner Elite',
    category: 'running',
    pageKey: 'productRunner',
    price: 149,
  },
  {
    sku: 'HS-TRN-CORE-02',
    name: 'CoreFlex Trainer',
    category: 'training',
    pageKey: 'productTrainer',
    price: 119,
  },
  {
    sku: 'HS-CYC-COAST-03',
    name: 'Coastal Cycling Kit',
    category: 'cycling',
    pageKey: 'productCycling',
    price: 189,
  },
  {
    sku: 'HS-SWM-TIDE-04',
    name: 'Tide Swim Pack',
    category: 'swim',
    pageKey: 'productSwim',
    price: 74,
  },
  {
    sku: 'HS-OUT-TRAIL-05',
    name: 'Trail Shell',
    category: 'outdoor',
    pageKey: 'productOutdoor',
    price: 159,
  },
  {
    sku: 'HS-TMW-CLUB-06',
    name: 'Club Kit Builder',
    category: 'teamwear',
    pageKey: 'teamwear',
    price: 249,
  },
];

const categoryPage: Record<ProductCategory, string> = {
  running: 'running',
  training: 'training',
  cycling: 'cycling',
  swim: 'swim',
  outdoor: 'outdoor',
  teamwear: 'teamwear',
};

const personaWeights: WeightedOption<Persona>[] = [
  { value: 'runner', weight: 0.32 },
  { value: 'trainer', weight: 0.24 },
  { value: 'cyclist', weight: 0.13 },
  { value: 'swimmer', weight: 0.1 },
  { value: 'outdoor', weight: 0.13 },
  { value: 'team_coach', weight: 0.08 },
];

const personaCategory: Record<Persona, ProductCategory> = {
  runner: 'running',
  trainer: 'training',
  cyclist: 'cycling',
  swimmer: 'swim',
  outdoor: 'outdoor',
  team_coach: 'teamwear',
};

const sourceCountryWeights: WeightedOption<string>[] = [
  { value: 'US', weight: 0.29 },
  { value: 'CA', weight: 0.08 },
  { value: 'GB', weight: 0.08 },
  { value: 'AU', weight: 0.06 },
  { value: 'DE', weight: 0.06 },
  { value: 'FR', weight: 0.05 },
  { value: 'JP', weight: 0.05 },
  { value: 'KR', weight: 0.04 },
  { value: 'SG', weight: 0.035 },
  { value: 'CN', weight: 0.055 },
  { value: 'TW', weight: 0.015 },
  { value: 'NZ', weight: 0.03 },
  { value: 'NL', weight: 0.02 },
  { value: 'ES', weight: 0.02 },
  { value: 'IT', weight: 0.02 },
  { value: 'BR', weight: 0.025 },
  { value: 'MX', weight: 0.02 },
  { value: 'IN', weight: 0.035 },
  { value: 'AE', weight: 0.015 },
  { value: 'SE', weight: 0.01 },
  { value: 'CH', weight: 0.01 },
];

const locationsByCountry: Record<string, Location[]> = {
  US: [
    { region: 'US-CA', city: 'Los Angeles' },
    { region: 'US-CA', city: 'San Francisco' },
    { region: 'US-NY', city: 'New York' },
    { region: 'US-TX', city: 'Austin' },
    { region: 'US-WA', city: 'Seattle' },
    { region: 'US-CO', city: 'Denver' },
    { region: 'US-FL', city: 'Miami' },
    { region: 'US-IL', city: 'Chicago' },
  ],
  CA: [
    { region: 'CA-ON', city: 'Toronto' },
    { region: 'CA-BC', city: 'Vancouver' },
    { region: 'CA-QC', city: 'Montreal' },
    { region: 'CA-AB', city: 'Calgary' },
  ],
  GB: [
    { region: 'GB-ENG', city: 'London' },
    { region: 'GB-ENG', city: 'Manchester' },
    { region: 'GB-SCT', city: 'Edinburgh' },
    { region: 'GB-WLS', city: 'Cardiff' },
  ],
  AU: [
    { region: 'AU-NSW', city: 'Sydney' },
    { region: 'AU-VIC', city: 'Melbourne' },
    { region: 'AU-QLD', city: 'Brisbane' },
    { region: 'AU-WA', city: 'Perth' },
  ],
  DE: [
    { region: 'DE-BE', city: 'Berlin' },
    { region: 'DE-BY', city: 'Munich' },
    { region: 'DE-HH', city: 'Hamburg' },
    { region: 'DE-HE', city: 'Frankfurt' },
  ],
  FR: [
    { region: 'FR-IDF', city: 'Paris' },
    { region: 'FR-ARA', city: 'Lyon' },
    { region: 'FR-PAC', city: 'Marseille' },
    { region: 'FR-OCC', city: 'Toulouse' },
  ],
  JP: [
    { region: 'JP-13', city: 'Tokyo' },
    { region: 'JP-27', city: 'Osaka' },
    { region: 'JP-23', city: 'Nagoya' },
    { region: 'JP-14', city: 'Yokohama' },
  ],
  KR: [
    { region: 'KR-11', city: 'Seoul' },
    { region: 'KR-26', city: 'Busan' },
    { region: 'KR-28', city: 'Incheon' },
  ],
  SG: [{ region: 'SG-01', city: 'Singapore' }],
  CN: [
    { region: 'CN-SH', city: 'Shanghai' },
    { region: 'CN-BJ', city: 'Beijing' },
    { region: 'CN-GD', city: 'Shenzhen' },
    { region: 'CN-GD', city: 'Guangzhou' },
    { region: 'CN-ZJ', city: 'Hangzhou' },
    { region: 'CN-FJ', city: 'Xiamen' },
  ],
  NZ: [
    { region: 'NZ-AUK', city: 'Auckland' },
    { region: 'NZ-WGN', city: 'Wellington' },
    { region: 'NZ-CAN', city: 'Christchurch' },
  ],
  NL: [
    { region: 'NL-NH', city: 'Amsterdam' },
    { region: 'NL-ZH', city: 'Rotterdam' },
  ],
  ES: [
    { region: 'ES-MD', city: 'Madrid' },
    { region: 'ES-CT', city: 'Barcelona' },
  ],
  IT: [
    { region: 'IT-62', city: 'Rome' },
    { region: 'IT-25', city: 'Milan' },
  ],
  BR: [
    { region: 'BR-SP', city: 'Sao Paulo' },
    { region: 'BR-RJ', city: 'Rio de Janeiro' },
  ],
  MX: [
    { region: 'MX-CMX', city: 'Mexico City' },
    { region: 'MX-JAL', city: 'Guadalajara' },
  ],
  IN: [
    { region: 'IN-MH', city: 'Mumbai' },
    { region: 'IN-KA', city: 'Bengaluru' },
    { region: 'IN-DL', city: 'New Delhi' },
  ],
  AE: [
    { region: 'AE-DU', city: 'Dubai' },
    { region: 'AE-AZ', city: 'Abu Dhabi' },
  ],
  SE: [
    { region: 'SE-AB', city: 'Stockholm' },
    { region: 'SE-O', city: 'Gothenburg' },
  ],
  CH: [
    { region: 'CH-ZH', city: 'Zurich' },
    { region: 'CH-GE', city: 'Geneva' },
  ],
};

const languageByCountry: Record<string, WeightedOption<string>[]> = {
  US: [
    { value: 'en-US', weight: 0.9 },
    { value: 'es-US', weight: 0.1 },
  ],
  CA: [
    { value: 'en-CA', weight: 0.75 },
    { value: 'fr-CA', weight: 0.25 },
  ],
  GB: [{ value: 'en-GB', weight: 1 }],
  AU: [{ value: 'en-AU', weight: 1 }],
  DE: [{ value: 'de-DE', weight: 1 }],
  FR: [{ value: 'fr-FR', weight: 1 }],
  JP: [
    { value: 'ja-JP', weight: 0.86 },
    { value: 'en-US', weight: 0.14 },
  ],
  KR: [
    { value: 'ko-KR', weight: 0.86 },
    { value: 'en-US', weight: 0.14 },
  ],
  SG: [
    { value: 'en-SG', weight: 0.72 },
    { value: 'zh-CN', weight: 0.28 },
  ],
  CN: [
    { value: 'zh-CN', weight: 0.88 },
    { value: 'en-US', weight: 0.12 },
  ],
  NZ: [{ value: 'en-NZ', weight: 1 }],
  NL: [{ value: 'nl-NL', weight: 1 }],
  ES: [{ value: 'es-ES', weight: 1 }],
  IT: [{ value: 'it-IT', weight: 1 }],
  BR: [{ value: 'pt-BR', weight: 1 }],
  MX: [{ value: 'es-MX', weight: 1 }],
  IN: [
    { value: 'en-IN', weight: 0.68 },
    { value: 'hi-IN', weight: 0.32 },
  ],
  AE: [
    { value: 'en-US', weight: 0.55 },
    { value: 'ar-AE', weight: 0.45 },
  ],
  SE: [{ value: 'sv-SE', weight: 1 }],
  CH: [
    { value: 'de-CH', weight: 0.72 },
    { value: 'fr-CH', weight: 0.28 },
  ],
};

const sessionRows: Scalar[][] = [];
const eventRows: Scalar[][] = [];
const eventDataRows: Scalar[][] = [];
const sessionDataRows: Scalar[][] = [];
const revenueRows: Scalar[][] = [];
const heatmapRows: Scalar[][] = [];
const replayRows: Scalar[][] = [];
const savedReplayRows: Scalar[][] = [];
const pageVisits: PageVisit[] = [];
const replayCandidates: ReplayCandidate[] = [];
const distinctIdsByCountry = new Map<string, string[]>();

let sessionSequence = 0;
let eventSequence = 0;
let eventDataSequence = 0;
let sessionDataSequence = 0;
let heatmapSequence = 0;
let replaySequence = 0;

function main() {
  const now = new Date();
  const endDate = now;
  const startDate = addDays(startOfUtcDay(endDate), -364);
  const days = datesBetween(startDate, endDate);

  for (const day of days) {
    const campaign = getCampaign(day);
    const count = getSessionCountForDay(day, campaign);

    for (let i = 0; i < count; i++) {
      const createdAt = timestampForDay(day);
      createSessionData(createdAt, campaign, false);
    }
  }

  for (let i = 0; i < 36; i++) {
    const createdAt = new Date(now.getTime() - rng.int(1, 29) * 60 * 1000 - rng.int(0, 59) * 1000);
    createSessionData(createdAt, getCampaign(now), true);
  }

  createHeatmapData();
  createReplayData();

  printSql(startDate, endDate);
}

function createSessionData(createdAt: Date, campaign: Campaign, isRealtime: boolean) {
  sessionSequence += 1;

  const country = rng.weighted(sourceCountryWeights);
  const location = rng.pick(locationsByCountry[country] ?? [{ region: `${country}-`, city: '' }]);
  const device = getDevice(country);
  const deviceInfo = getDeviceInfo(device);
  const language = rng.weighted(languageByCountry[country] ?? [{ value: 'en-US', weight: 1 }]);
  const persona = rng.weighted(personaWeights);
  const customerType = getCustomerType(country);
  const distinctId = getDistinctId(country, customerType);
  const referrer = getReferrer(country, campaign);
  const sessionId = uuidFor('session', sessionSequence);
  const visitId = uuidFor('visit', sessionSequence);
  const intentScore = getIntentScore(customerType, campaign, referrer.channel);

  const session: SessionContext = {
    sessionId,
    visitId,
    country,
    region: location.region,
    city: location.city,
    device,
    browser: deviceInfo.browser,
    os: deviceInfo.os,
    screen: deviceInfo.screen,
    language,
    distinctId,
    persona,
    customerType,
    intentScore,
    campaign,
    referrer,
    createdAt,
  };

  sessionRows.push([
    sessionId,
    WEBSITE_ID,
    session.browser,
    session.os,
    session.device,
    session.screen,
    session.language,
    session.country,
    session.region,
    session.city,
    distinctId,
    iso(session.createdAt),
  ]);

  addSessionData(session, 'market', getMarket(session.country), session.createdAt);
  addSessionData(session, 'persona', session.persona, session.createdAt);
  addSessionData(session, 'customer_type', customerType, session.createdAt);
  addSessionData(
    session,
    'preferred_category',
    personaCategory[session.persona],
    session.createdAt,
  );
  addSessionData(session, 'intent_score', intentScore, session.createdAt);

  const product = chooseProduct(session.persona, campaign);
  const journey = buildJourney(product, campaign, referrer, isRealtime);
  let currentTime = new Date(createdAt);
  let cartEventCreated = false;
  let checkoutEventCreated = false;

  for (let index = 0; index < journey.pages.length; index++) {
    const page = getPage(journey.pages[index]);
    const isFirstPage = index === 0;
    addWebsiteEvent({
      session,
      eventType: EVENT_TYPE.pageView,
      eventName: null,
      page,
      createdAt: currentTime,
      referrer: isFirstPage ? referrer : null,
      metrics: null,
      tag: journey.kind,
    });

    pageVisits.push({
      sessionId,
      visitId,
      pageKey: page.key,
      path: page.path,
      createdAt: currentTime,
      device,
      screen: session.screen,
    });

    if (rng.chance(device === 'mobile' ? 0.72 : 0.62)) {
      addPerformanceEvent(session, page, addSeconds(currentTime, rng.int(1, 4)));
    }

    let eventTime = addSeconds(currentTime, rng.int(2, 10));

    if (isProductPage(page.key)) {
      const productEventId = addCustomEvent(session, page, 'product_view', eventTime, journey.kind);
      addProductEventData(productEventId, product, eventTime, session, null);

      if (rng.chance(0.32)) {
        eventTime = addSeconds(eventTime, rng.int(1, 6));
        addCustomEventWithData(session, page, 'size_select', eventTime, journey.kind, [
          ['sku', product.sku],
          ['size', rng.pick(['XS', 'S', 'M', 'L', 'XL', '8', '9', '10', '11'])],
          ['category', product.category],
        ]);
      }

      if (['cart', 'checkout', 'purchase'].includes(journey.kind) && !cartEventCreated) {
        eventTime = addSeconds(eventTime, rng.int(2, 8));
        const addEventId = addCustomEvent(session, page, 'add_to_cart', eventTime, journey.kind);
        addProductEventData(addEventId, product, eventTime, session, null);
        cartEventCreated = true;
      } else if (rng.chance(0.08)) {
        eventTime = addSeconds(eventTime, rng.int(2, 8));
        addCustomEventWithData(session, page, 'wishlist_add', eventTime, journey.kind, [
          ['sku', product.sku],
          ['category', product.category],
        ]);
      }
    }

    if (['shop', 'running', 'training', 'cycling', 'swim', 'outdoor', 'sale'].includes(page.key)) {
      if (rng.chance(0.12)) {
        addCustomEventWithData(session, page, 'search', eventTime, journey.kind, [
          ['query_type', rng.pick(['product', 'category', 'size', 'sale'])],
          ['category', product.category],
        ]);
      }

      if (rng.chance(0.07)) {
        addCustomEventWithData(
          session,
          page,
          'filter_apply',
          addSeconds(eventTime, 2),
          journey.kind,
          [
            ['filter', rng.pick(['size', 'price', 'sport', 'color', 'availability'])],
            ['category', product.category],
          ],
        );
      }
    }

    if (page.key === 'cart' && rng.chance(0.22)) {
      addCustomEventWithData(session, page, 'coupon_apply', eventTime, journey.kind, [
        ['coupon', getCoupon(campaign)],
        ['category', product.category],
      ]);
    }

    if (
      page.key === 'checkout' &&
      ['checkout', 'purchase'].includes(journey.kind) &&
      !checkoutEventCreated
    ) {
      eventTime = addSeconds(eventTime, rng.int(2, 8));
      addCustomEventWithData(session, page, 'begin_checkout', eventTime, journey.kind, [
        ['payment_method', rng.pick(['card', 'paypal', 'apple_pay', 'google_pay'])],
        ['shipping_tier', rng.pick(['standard', 'express', 'pickup'])],
        ['category', product.category],
      ]);
      checkoutEventCreated = true;
    }

    if (page.key === 'complete' && journey.kind === 'purchase') {
      eventTime = addSeconds(eventTime, rng.int(2, 8));
      addPurchaseEvent(session, page, product, eventTime);
    }

    if (page.key === 'blogRace' && rng.chance(0.08)) {
      addCustomEventWithData(session, page, 'newsletter_signup', eventTime, journey.kind, [
        ['source', 'training_guide'],
        ['interest', product.category],
      ]);
    }

    if (page.key === 'stores' && rng.chance(0.58)) {
      addCustomEventWithData(session, page, 'store_locator_open', eventTime, journey.kind, [
        ['market', getMarket(session.country)],
        ['city', session.city],
      ]);
    }

    if (rng.chance(0.045)) {
      addCustomEventWithData(session, page, 'video_play', addSeconds(eventTime, 4), journey.kind, [
        ['video', `${product.category}_fit_guide`],
        ['category', product.category],
      ]);
    }

    currentTime = addSeconds(
      currentTime,
      Math.max(
        8,
        page.avgSeconds +
          rng.int(-Math.round(page.avgSeconds * 0.35), Math.round(page.avgSeconds * 0.45)),
      ),
    );
  }

  if (
    replayCandidates.length < 180 &&
    journey.pages.length >= 2 &&
    (sessionSequence % 113 === 0 || journey.kind === 'purchase')
  ) {
    replayCandidates.push({
      sessionId,
      visitId,
      firstPath: getPage(journey.pages[0]).path,
      screen: session.screen,
      startedAt: createdAt,
      endedAt: addSeconds(createdAt, rng.int(35, 180)),
    });
  }
}

function buildJourney(
  product: Product,
  campaign: Campaign,
  referrer: Referrer,
  isRealtime: boolean,
): { kind: JourneyKind; pages: string[] } {
  const conversionBoost =
    campaign.conversionLift + (['email', 'paid_search'].includes(referrer.channel) ? 0.45 : 0);
  const purchaseWeight = isRealtime ? 0.07 : 0.037 + conversionBoost * 0.013;
  const checkoutWeight = 0.055 + conversionBoost * 0.008;
  const cartWeight = 0.105 + conversionBoost * 0.01;
  const category = categoryPage[product.category];
  const productPage = product.pageKey;

  const options: WeightedOption<{ kind: JourneyKind; pages: string[] }>[] = [
    { value: { kind: 'bounce', pages: ['home'] }, weight: 0.14 },
    { value: { kind: 'browse', pages: ['home', 'shop', category] }, weight: 0.19 },
    { value: { kind: 'product', pages: ['home', category, productPage] }, weight: 0.19 },
    { value: { kind: 'cart', pages: ['home', category, productPage, 'cart'] }, weight: cartWeight },
    {
      value: { kind: 'checkout', pages: ['home', category, productPage, 'cart', 'checkout'] },
      weight: checkoutWeight,
    },
    {
      value: {
        kind: 'purchase',
        pages: ['home', category, productPage, 'cart', 'checkout', 'complete'],
      },
      weight: purchaseWeight,
    },
    { value: { kind: 'content', pages: ['blogRace', category, productPage] }, weight: 0.065 },
    { value: { kind: 'store', pages: ['home', 'stores'] }, weight: 0.035 },
    { value: { kind: 'browse', pages: ['sale', category, productPage] }, weight: 0.085 },
  ];

  return rng.weighted(options);
}

function addWebsiteEvent({
  session,
  eventType,
  eventName,
  page,
  createdAt,
  referrer,
  metrics,
  tag,
}: {
  session: SessionContext;
  eventType: number;
  eventName: string | null;
  page: Page;
  createdAt: Date;
  referrer: Referrer | null;
  metrics: { lcp: number; inp: number; cls: number; fcp: number; ttfb: number } | null;
  tag: string | null;
}) {
  eventSequence += 1;
  const eventId = uuidFor('event', eventSequence);

  eventRows.push([
    eventId,
    WEBSITE_ID,
    session.sessionId,
    session.visitId,
    iso(createdAt),
    page.path,
    null,
    referrer?.utmSource ?? null,
    referrer?.utmMedium ?? null,
    referrer?.utmCampaign ?? null,
    referrer?.utmContent ?? null,
    referrer?.utmTerm ?? null,
    referrer?.path ?? null,
    referrer?.domain ?? null,
    page.title,
    eventType,
    eventName,
    tag,
    HOSTNAME,
    metrics?.lcp ?? null,
    metrics?.inp ?? null,
    metrics?.cls ?? null,
    metrics?.fcp ?? null,
    metrics?.ttfb ?? null,
  ]);

  return eventId;
}

function addCustomEvent(
  session: SessionContext,
  page: Page,
  eventName: string,
  createdAt: Date,
  tag: string,
) {
  return addWebsiteEvent({
    session,
    eventType: EVENT_TYPE.customEvent,
    eventName,
    page,
    createdAt,
    referrer: null,
    metrics: null,
    tag,
  });
}

function addCustomEventWithData(
  session: SessionContext,
  page: Page,
  eventName: string,
  createdAt: Date,
  tag: string,
  entries: [string, string | number][],
) {
  const eventId = addCustomEvent(session, page, eventName, createdAt, tag);
  for (const [key, value] of entries) {
    addEventData(eventId, key, value, createdAt);
  }
  return eventId;
}

function addProductEventData(
  eventId: string,
  product: Product,
  createdAt: Date,
  session: SessionContext,
  revenue: number | null,
) {
  addEventData(eventId, 'sku', product.sku, createdAt);
  addEventData(eventId, 'product', product.name, createdAt);
  addEventData(eventId, 'category', product.category, createdAt);
  addEventData(eventId, 'price', product.price, createdAt);
  addEventData(eventId, 'market', getMarket(session.country), createdAt);
  addEventData(eventId, 'campaign', session.campaign.name, createdAt);
  if (revenue !== null) {
    addEventData(eventId, 'revenue', revenue, createdAt);
    addEventData(eventId, 'currency', 'USD', createdAt);
  }
}

function addPurchaseEvent(session: SessionContext, page: Page, product: Product, createdAt: Date) {
  const quantity = rng.weighted([
    { value: 1, weight: 0.72 },
    { value: 2, weight: 0.22 },
    { value: 3, weight: 0.06 },
  ]);
  const discount = getDiscount(session.campaign.name);
  const merchandise = product.price * quantity * (1 - discount);
  const shipping = merchandise >= 120 ? 0 : rng.pick([6.95, 9.95, 14.95]);
  const revenue = round(merchandise + shipping, 2);
  const eventId = addCustomEvent(session, page, 'purchase', createdAt, 'purchase');

  addProductEventData(eventId, product, createdAt, session, revenue);
  addEventData(eventId, 'quantity', quantity, createdAt);
  addEventData(
    eventId,
    'order_id',
    `HS-${createdAt.getUTCFullYear()}-${eventSequence.toString().padStart(6, '0')}`,
    createdAt,
  );
  addEventData(eventId, 'shipping_tier', shipping === 0 ? 'free' : 'paid', createdAt);

  revenueRows.push([
    uuidFor('revenue', eventId),
    WEBSITE_ID,
    session.sessionId,
    eventId,
    'purchase',
    'USD',
    revenue,
    iso(createdAt),
  ]);
}

function addEventData(eventId: string, key: string, value: string | number, createdAt: Date) {
  eventDataSequence += 1;
  const isNumber = typeof value === 'number';
  eventDataRows.push([
    uuidFor('event-data', eventDataSequence),
    WEBSITE_ID,
    eventId,
    key,
    isNumber ? null : value,
    isNumber ? value : null,
    null,
    isNumber ? DATA_TYPE.number : DATA_TYPE.string,
    iso(createdAt),
  ]);
}

function addSessionData(
  session: SessionContext,
  key: string,
  value: string | number,
  createdAt: Date,
) {
  sessionDataSequence += 1;
  const isNumber = typeof value === 'number';
  sessionDataRows.push([
    uuidFor('session-data', sessionDataSequence),
    WEBSITE_ID,
    session.sessionId,
    key,
    isNumber ? null : value,
    isNumber ? value : null,
    null,
    isNumber ? DATA_TYPE.number : DATA_TYPE.string,
    session.distinctId,
    iso(createdAt),
  ]);
}

function addPerformanceEvent(session: SessionContext, page: Page, createdAt: Date) {
  const mobilePenalty = session.device === 'mobile' ? 1.22 : 1;
  const regionPenalty = ['IN', 'BR', 'MX'].includes(session.country) ? 1.13 : 1;
  const scale = mobilePenalty * regionPenalty;

  addWebsiteEvent({
    session,
    eventType: EVENT_TYPE.performance,
    eventName: null,
    page,
    createdAt,
    referrer: null,
    tag: 'web_vitals',
    metrics: {
      lcp: round(rng.float(1350, 3400) * scale, 1),
      inp: round(rng.float(80, 310) * scale, 1),
      cls: round(rng.float(0.01, 0.18) * (session.device === 'mobile' ? 1.18 : 1), 4),
      fcp: round(rng.float(760, 2100) * scale, 1),
      ttfb: round(rng.float(160, 980) * regionPenalty, 1),
    },
  });
}

function createHeatmapData() {
  const heatmapKeys = new Set([
    'home',
    'shop',
    'running',
    'training',
    'productRunner',
    'productTrainer',
    'cart',
    'checkout',
    'sale',
  ]);

  for (const visit of pageVisits) {
    if (!heatmapKeys.has(visit.pageKey)) continue;
    if (heatmapRows.length > 16000) break;

    if (rng.chance(visit.device === 'mobile' ? 0.22 : 0.18)) {
      const clickCount = rng.chance(0.18) ? 2 : 1;

      for (let i = 0; i < clickCount; i++) {
        const point = getClickPoint(visit.pageKey, visit.screen);
        heatmapSequence += 1;
        heatmapRows.push([
          uuidFor('heatmap', heatmapSequence),
          WEBSITE_ID,
          visit.sessionId,
          visit.visitId,
          visit.path,
          HEATMAP_EVENT_TYPE.click,
          point.x,
          point.y,
          point.pageX,
          point.pageY,
          point.pageW,
          point.viewportW,
          point.viewportH,
          point.pageH,
          null,
          iso(addSeconds(visit.createdAt, rng.int(3, 95))),
        ]);
      }
    }

    if (rng.chance(0.2)) {
      const viewport = getViewport(visit.screen);
      const page = getPage(visit.pageKey);
      heatmapSequence += 1;
      heatmapRows.push([
        uuidFor('heatmap', heatmapSequence),
        WEBSITE_ID,
        visit.sessionId,
        visit.visitId,
        visit.path,
        HEATMAP_EVENT_TYPE.scroll,
        null,
        null,
        null,
        null,
        page.pageW,
        viewport.width,
        viewport.height,
        page.pageH,
        clamp(Math.round(rng.normal(68, 22)), 8, 100),
        iso(addSeconds(visit.createdAt, rng.int(12, 170))),
      ]);
    }
  }
}

function createReplayData() {
  const candidates = replayCandidates.slice(0, 180);

  for (const candidate of candidates) {
    replaySequence += 1;
    const events = createReplayEvents(candidate);
    const compressedHex = gzipSync(Buffer.from(JSON.stringify(events), 'utf-8')).toString('hex');

    replayRows.push([
      uuidFor('replay', replaySequence),
      WEBSITE_ID,
      candidate.sessionId,
      candidate.visitId,
      1,
      `\\x${compressedHex}`,
      events.length,
      iso(candidate.startedAt),
      iso(candidate.endedAt),
      iso(candidate.endedAt),
    ]);

    if (savedReplayRows.length < 12) {
      savedReplayRows.push([
        uuidFor('saved-replay', replaySequence),
        `Sample shopper replay ${savedReplayRows.length + 1}`,
        WEBSITE_ID,
        candidate.visitId,
        iso(candidate.endedAt),
        iso(candidate.endedAt),
      ]);
    }
  }
}

function createReplayEvents(candidate: ReplayCandidate) {
  const viewport = getViewport(candidate.screen);
  const timestamp = candidate.startedAt.getTime();

  return [
    {
      type: 4,
      timestamp,
      data: {
        href: `http://${WEBSITE_DOMAIN}${candidate.firstPath}`,
        width: viewport.width,
        height: viewport.height,
      },
    },
    {
      type: 2,
      timestamp: timestamp + 20,
      data: {
        node: {
          type: 0,
          childNodes: [
            {
              type: 1,
              name: 'html',
              childNodes: [
                { type: 1, name: 'head', childNodes: [] },
                {
                  type: 1,
                  name: 'body',
                  attributes: {
                    style:
                      'margin:0;font-family:Inter,Arial,sans-serif;background:#f7f8f4;color:#111827',
                  },
                  childNodes: [
                    {
                      type: 1,
                      name: 'main',
                      attributes: {
                        style: `width:${viewport.width}px;min-height:${viewport.height}px;padding:48px;background:linear-gradient(180deg,#f8fafc,#e7ece4)`,
                      },
                      childNodes: [
                        {
                          type: 1,
                          name: 'h1',
                          attributes: { style: 'font-size:42px;margin:0 0 16px' },
                          childNodes: [{ type: 3, textContent: 'Harbor Sport' }],
                        },
                        {
                          type: 1,
                          name: 'p',
                          attributes: { style: 'font-size:18px;max-width:620px;line-height:1.5' },
                          childNodes: [
                            {
                              type: 3,
                              textContent:
                                'Synthetic replay for browsing performance gear, product details, cart, and checkout flows.',
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
    {
      type: 3,
      timestamp: timestamp + 1800,
      data: { source: 2, type: 0, x: Math.round(viewport.width * 0.42), y: 280 },
    },
    {
      type: 3,
      timestamp: timestamp + 6200,
      data: { source: 3, x: 0, y: Math.round(viewport.height * 0.62) },
    },
    {
      type: 3,
      timestamp: timestamp + 11500,
      data: { source: 2, type: 0, x: Math.round(viewport.width * 0.72), y: 520 },
    },
  ];
}

function printSql(startDate: Date, endDate: Date) {
  const reportRows = createReportRows(startDate, endDate);
  const segmentRows = createSegmentRows();
  const boardRows = createBoardRows();
  const shareRows = createShareRows();

  console.log('-- Harbor Sport synthetic analytics seed');
  console.log('-- Pipe into: docker compose exec -T db psql -U umami -d umami');
  console.log('BEGIN;');
  console.log('SET client_min_messages TO warning;');
  console.log('CREATE TEMP TABLE harbor_admin AS');
  console.log(
    '  SELECT user_id FROM "user" WHERE role = \'admin\' AND deleted_at IS NULL ORDER BY created_at LIMIT 1;',
  );
  console.log(
    "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM harbor_admin) THEN RAISE EXCEPTION 'No admin user found'; END IF; END $$;",
  );
  console.log(
    `CREATE TEMP TABLE harbor_target AS SELECT website_id FROM website WHERE website_id = '${WEBSITE_ID}'::uuid OR (domain = '${WEBSITE_DOMAIN}' AND name = '${WEBSITE_NAME}');`,
  );
  console.log(
    "DELETE FROM share WHERE entity_id IN (SELECT website_id FROM harbor_target) OR slug = 'harbor-sport-demo';",
  );
  console.log(
    "DELETE FROM board WHERE name LIKE 'Harbor Sport%' OR parameters->>'websiteId' IN (SELECT website_id::text FROM harbor_target);",
  );
  console.log(
    'DELETE FROM session_replay_saved WHERE website_id IN (SELECT website_id FROM harbor_target);',
  );
  console.log(
    'DELETE FROM session_replay WHERE website_id IN (SELECT website_id FROM harbor_target);',
  );
  console.log(
    'DELETE FROM heatmap_event WHERE website_id IN (SELECT website_id FROM harbor_target);',
  );
  console.log('DELETE FROM revenue WHERE website_id IN (SELECT website_id FROM harbor_target);');
  console.log('DELETE FROM event_data WHERE website_id IN (SELECT website_id FROM harbor_target);');
  console.log(
    'DELETE FROM session_data WHERE website_id IN (SELECT website_id FROM harbor_target);',
  );
  console.log(
    'DELETE FROM website_event WHERE website_id IN (SELECT website_id FROM harbor_target);',
  );
  console.log('DELETE FROM session WHERE website_id IN (SELECT website_id FROM harbor_target);');
  console.log('DELETE FROM segment WHERE website_id IN (SELECT website_id FROM harbor_target);');
  console.log('DELETE FROM report WHERE website_id IN (SELECT website_id FROM harbor_target);');
  console.log('DELETE FROM website WHERE website_id IN (SELECT website_id FROM harbor_target);');
  console.log(`INSERT INTO website (website_id, name, domain, user_id, created_by, recorder_enabled, replay_config, created_at, updated_at)
SELECT '${WEBSITE_ID}'::uuid, '${WEBSITE_NAME}', '${WEBSITE_DOMAIN}', user_id, user_id, true,
  '{"replayEnabled":true,"sampleRate":1,"maxDuration":300,"heatmapEnabled":true,"heatmapSampleRate":1}'::jsonb,
  now(), now()
FROM harbor_admin;`);

  copy(
    'session',
    [
      'session_id',
      'website_id',
      'browser',
      'os',
      'device',
      'screen',
      'language',
      'country',
      'region',
      'city',
      'distinct_id',
      'created_at',
    ],
    sessionRows,
  );
  copy(
    'website_event',
    [
      'event_id',
      'website_id',
      'session_id',
      'visit_id',
      'created_at',
      'url_path',
      'url_query',
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
      'referrer_path',
      'referrer_domain',
      'page_title',
      'event_type',
      'event_name',
      'tag',
      'hostname',
      'lcp',
      'inp',
      'cls',
      'fcp',
      'ttfb',
    ],
    eventRows,
  );
  copy(
    'event_data',
    [
      'event_data_id',
      'website_id',
      'website_event_id',
      'data_key',
      'string_value',
      'number_value',
      'date_value',
      'data_type',
      'created_at',
    ],
    eventDataRows,
  );
  copy(
    'session_data',
    [
      'session_data_id',
      'website_id',
      'session_id',
      'data_key',
      'string_value',
      'number_value',
      'date_value',
      'data_type',
      'distinct_id',
      'created_at',
    ],
    sessionDataRows,
  );
  copy(
    'revenue',
    [
      'revenue_id',
      'website_id',
      'session_id',
      'event_id',
      'event_name',
      'currency',
      'revenue',
      'created_at',
    ],
    revenueRows,
  );
  copy(
    'heatmap_event',
    [
      'heatmap_event_id',
      'website_id',
      'session_id',
      'visit_id',
      'url_path',
      'event_type',
      'x',
      'y',
      'page_x',
      'page_y',
      'page_w',
      'viewport_w',
      'viewport_h',
      'page_h',
      'scroll_pct',
      'created_at',
    ],
    heatmapRows,
  );
  copy(
    'session_replay',
    [
      'replay_id',
      'website_id',
      'session_id',
      'visit_id',
      'chunk_index',
      'events',
      'event_count',
      'started_at',
      'ended_at',
      'created_at',
    ],
    replayRows,
  );
  copy(
    'session_replay_saved',
    ['saved_replay_id', 'name', 'website_id', 'visit_id', 'created_at', 'updated_at'],
    savedReplayRows,
  );

  console.log(
    'CREATE TEMP TABLE harbor_report_seed (report_id uuid, website_id uuid, type varchar(50), name varchar(200), description varchar(500), parameters jsonb, created_at timestamptz, updated_at timestamptz);',
  );
  copy(
    'harbor_report_seed',
    [
      'report_id',
      'website_id',
      'type',
      'name',
      'description',
      'parameters',
      'created_at',
      'updated_at',
    ],
    reportRows,
  );
  console.log(
    'INSERT INTO report (report_id, user_id, website_id, type, name, description, parameters, created_at, updated_at)',
  );
  console.log(
    'SELECT report_id, (SELECT user_id FROM harbor_admin), website_id, type, name, description, parameters, created_at, updated_at FROM harbor_report_seed;',
  );
  copy(
    'segment',
    ['segment_id', 'website_id', 'type', 'name', 'parameters', 'created_at', 'updated_at'],
    segmentRows,
  );
  console.log(
    'CREATE TEMP TABLE harbor_board_seed (board_id uuid, type varchar(50), name varchar(200), description varchar(500), parameters jsonb, created_at timestamptz, updated_at timestamptz);',
  );
  copy(
    'harbor_board_seed',
    ['board_id', 'type', 'name', 'description', 'parameters', 'created_at', 'updated_at'],
    boardRows,
  );
  console.log(
    'INSERT INTO board (board_id, type, name, description, parameters, user_id, created_at, updated_at)',
  );
  console.log(
    'SELECT board_id, type, name, description, parameters, (SELECT user_id FROM harbor_admin), created_at, updated_at FROM harbor_board_seed;',
  );
  copy(
    'share',
    [
      'share_id',
      'entity_id',
      'name',
      'share_type',
      'slug',
      'parameters',
      'created_at',
      'updated_at',
    ],
    shareRows,
  );
  console.log('COMMIT;');
  console.log(
    `SELECT 'Harbor Sport website' AS item, website_id, name, domain FROM website WHERE website_id = '${WEBSITE_ID}'::uuid;`,
  );
  console.log(
    `SELECT 'sessions' AS item, count(*) FROM session WHERE website_id = '${WEBSITE_ID}'::uuid UNION ALL SELECT 'events', count(*) FROM website_event WHERE website_id = '${WEBSITE_ID}'::uuid UNION ALL SELECT 'event_data', count(*) FROM event_data WHERE website_id = '${WEBSITE_ID}'::uuid UNION ALL SELECT 'session_data', count(*) FROM session_data WHERE website_id = '${WEBSITE_ID}'::uuid UNION ALL SELECT 'revenue', count(*) FROM revenue WHERE website_id = '${WEBSITE_ID}'::uuid UNION ALL SELECT 'heatmap_events', count(*) FROM heatmap_event WHERE website_id = '${WEBSITE_ID}'::uuid UNION ALL SELECT 'replays', count(*) FROM session_replay WHERE website_id = '${WEBSITE_ID}'::uuid UNION ALL SELECT 'reports', count(*) FROM report WHERE website_id = '${WEBSITE_ID}'::uuid UNION ALL SELECT 'segments', count(*) FROM segment WHERE website_id = '${WEBSITE_ID}'::uuid;`,
  );
  console.log(
    `SELECT country, count(*) AS sessions FROM session WHERE website_id = '${WEBSITE_ID}'::uuid GROUP BY country ORDER BY sessions DESC LIMIT 12;`,
  );
  console.log(
    `SELECT count(*) AS standalone_legacy_country_rows FROM session WHERE website_id = '${WEBSITE_ID}'::uuid AND country = 'T' || 'W';`,
  );
}

function createReportRows(startDate: Date, endDate: Date): Scalar[][] {
  const createdAt = iso(new Date());
  const commonDates = {
    startDate: iso(startDate),
    endDate: iso(endDate),
    timezone: 'Asia/Shanghai',
  };
  const reports = [
    {
      type: 'goal',
      name: 'Purchase conversion',
      description: 'Completed orders from all global traffic.',
      parameters: { ...commonDates, type: 'event', value: 'purchase' },
    },
    {
      type: 'goal',
      name: 'Checkout complete page',
      description: 'Thank-you page views after payment.',
      parameters: { ...commonDates, type: 'path', value: `${BASE_PATH}/checkout-complete.html` },
    },
    {
      type: 'funnel',
      name: 'Product to purchase funnel',
      description: 'Product view, cart, checkout, and purchase steps.',
      parameters: {
        ...commonDates,
        window: 10080,
        steps: [
          { type: 'event', value: 'product_view' },
          { type: 'event', value: 'add_to_cart' },
          { type: 'event', value: 'begin_checkout' },
          { type: 'event', value: 'purchase' },
        ],
      },
    },
    {
      type: 'journey',
      name: 'Global shopper paths',
      description: 'Top journeys across content, category, product, and checkout paths.',
      parameters: { ...commonDates, steps: 5 },
    },
    {
      type: 'retention',
      name: 'Returning shopper retention',
      description: 'How returning Harbor Sport shoppers come back over time.',
      parameters: commonDates,
    },
    {
      type: 'utm',
      name: 'Campaign acquisition',
      description: 'Paid search, paid social, email, referral, and seasonal campaign traffic.',
      parameters: commonDates,
    },
    {
      type: 'revenue',
      name: 'Revenue by campaign',
      description: 'USD revenue generated from purchase events.',
      parameters: { ...commonDates, unit: 'month', currency: 'USD', compare: 'prev' },
    },
    {
      type: 'performance',
      name: 'Web vitals by market',
      description: 'Synthetic LCP, INP, CLS, FCP, and TTFB signals.',
      parameters: { ...commonDates, unit: 'day', metric: 'lcp' },
    },
    {
      type: 'attribution',
      name: 'Last-click purchase attribution',
      description: 'Campaign and referrer attribution for purchases.',
      parameters: {
        ...commonDates,
        model: 'last-click',
        type: 'event',
        step: 'purchase',
        currency: 'USD',
      },
    },
    {
      type: 'breakdown',
      name: 'Market and device breakdown',
      description: 'Path, country, device, UTM, and event dimensions.',
      parameters: {
        ...commonDates,
        fields: ['path', 'country', 'region', 'device', 'utmCampaign', 'event'],
      },
    },
    {
      type: 'heatmap',
      name: 'Home page click heatmap',
      description: 'Click density for the Harbor Sport home page.',
      parameters: { ...commonDates, urlPath: `${BASE_PATH}/index.html`, mode: 'click' },
    },
    {
      type: 'heatmap',
      name: 'Running page scroll heatmap',
      description: 'Scroll depth for the running collection.',
      parameters: { ...commonDates, urlPath: `${BASE_PATH}/running.html`, mode: 'scroll' },
    },
  ];

  return reports.map(report => [
    uuidFor('report', report.type, report.name),
    WEBSITE_ID,
    report.type,
    report.name,
    report.description,
    JSON.stringify(report.parameters),
    createdAt,
    createdAt,
  ]);
}

function createSegmentRows(): Scalar[][] {
  const createdAt = iso(new Date());
  const segments = [
    {
      type: 'segment',
      name: 'High-intent shoppers',
      parameters: {
        match: 'any',
        filters: [
          { name: 'event', operator: 'eq', value: 'add_to_cart' },
          { name: 'event', operator: 'eq', value: 'begin_checkout' },
          { name: 'event', operator: 'eq', value: 'purchase' },
        ],
      },
    },
    {
      type: 'segment',
      name: 'Mobile commerce visitors',
      parameters: { match: 'all', filters: [{ name: 'device', operator: 'eq', value: 'mobile' }] },
    },
    {
      type: 'segment',
      name: 'China market visitors',
      parameters: { match: 'all', filters: [{ name: 'country', operator: 'eq', value: 'CN' }] },
    },
    {
      type: 'segment',
      name: 'Paid acquisition traffic',
      parameters: {
        match: 'any',
        filters: [
          { name: 'utmMedium', operator: 'eq', value: 'cpc' },
          { name: 'utmMedium', operator: 'eq', value: 'paid_social' },
        ],
      },
    },
    {
      type: 'cohort',
      name: 'Purchased in last year',
      parameters: {
        match: 'all',
        dateRange: '365day',
        action: { type: 'event', value: 'purchase' },
        filters: [],
      },
    },
    {
      type: 'cohort',
      name: 'Running collection entrants',
      parameters: {
        match: 'all',
        dateRange: '365day',
        action: { type: 'path', value: `${BASE_PATH}/running.html` },
        filters: [],
      },
    },
  ];

  return segments.map(segment => [
    uuidFor('segment', segment.type, segment.name),
    WEBSITE_ID,
    segment.type,
    segment.name,
    JSON.stringify(segment.parameters),
    createdAt,
    createdAt,
  ]);
}

function createBoardRows(): Scalar[][] {
  const createdAt = iso(new Date());
  const board = {
    websiteId: WEBSITE_ID,
    rows: [
      {
        id: uuidFor('board-row', 'metrics'),
        columns: [
          {
            id: uuidFor('board-column', 'metrics'),
            size: 1,
            component: {
              type: 'WebsiteMetricsBar',
              entityType: 'website',
              entityId: WEBSITE_ID,
              websiteId: WEBSITE_ID,
              title: 'Harbor Sport metrics',
            },
          },
        ],
      },
      {
        id: uuidFor('board-row', 'chart-map'),
        columns: [
          {
            id: uuidFor('board-column', 'chart'),
            size: 2,
            component: {
              type: 'WebsiteChart',
              entityType: 'website',
              entityId: WEBSITE_ID,
              websiteId: WEBSITE_ID,
              title: 'Traffic trend',
            },
          },
          {
            id: uuidFor('board-column', 'map'),
            size: 1,
            component: {
              type: 'WorldMap',
              entityType: 'website',
              entityId: WEBSITE_ID,
              websiteId: WEBSITE_ID,
              title: 'Global distribution',
            },
          },
        ],
      },
      {
        id: uuidFor('board-row', 'tables'),
        columns: [
          {
            id: uuidFor('board-column', 'paths'),
            size: 1,
            component: {
              type: 'MetricsTable',
              entityType: 'website',
              entityId: WEBSITE_ID,
              websiteId: WEBSITE_ID,
              title: 'Top pages',
              props: { type: 'path', limit: 10 },
            },
          },
          {
            id: uuidFor('board-column', 'events'),
            size: 1,
            component: {
              type: 'EventsChart',
              entityType: 'website',
              entityId: WEBSITE_ID,
              websiteId: WEBSITE_ID,
              title: 'Conversion events',
            },
          },
          {
            id: uuidFor('board-column', 'weekly'),
            size: 1,
            component: {
              type: 'WeeklyTraffic',
              entityType: 'website',
              entityId: WEBSITE_ID,
              websiteId: WEBSITE_ID,
              title: 'Weekly traffic',
            },
          },
        ],
      },
    ],
  };

  return [
    [
      uuidFor('board', 'harbor-sport'),
      'website',
      'Harbor Sport demo board',
      'Global synthetic analytics board for Harbor Sport.',
      JSON.stringify(board),
      createdAt,
      createdAt,
    ],
  ];
}

function createShareRows(): Scalar[][] {
  const createdAt = iso(new Date());
  return [
    [
      uuidFor('share', 'harbor-sport-website'),
      WEBSITE_ID,
      'Harbor Sport public demo',
      1,
      SHARE_SLUG,
      JSON.stringify({
        overview: true,
        events: true,
        sessions: true,
        realtime: true,
        performance: true,
        compare: true,
        breakdown: true,
        goals: true,
        funnels: true,
        journeys: true,
        retention: true,
        replays: true,
        heatmaps: true,
        segments: true,
        cohorts: true,
        utm: true,
        revenue: true,
        attribution: true,
        allowFilter: true,
        theme: 'light',
      }),
      createdAt,
      createdAt,
    ],
  ];
}

function copy(table: string, columns: string[], rows: Scalar[][]) {
  if (!rows.length) return;

  console.log(
    `COPY ${quoteTable(table)} (${columns.map(column => `"${column}"`).join(', ')}) FROM STDIN WITH (FORMAT csv, NULL '\\N');`,
  );

  for (const row of rows) {
    console.log(row.map(csvValue).join(','));
  }

  console.log('\\.');
}

function csvValue(value: Scalar) {
  if (value === null || value === undefined) return '\\N';
  const text = String(value);
  if (!/[",\n\r]/.test(text) && text !== '\\N') return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function quoteTable(table: string) {
  return table
    .split('.')
    .map(part => `"${part}"`)
    .join('.');
}

function getSessionCountForDay(day: Date, campaign: Campaign) {
  const base = 72;
  const month = day.getUTCMonth();
  const monthMultipliers = [1.08, 0.96, 1.12, 1.22, 1.16, 0.98, 0.92, 1.04, 1.28, 1.2, 1.82, 1.46];
  const dayWeights = [0.88, 1.12, 1.16, 1.17, 1.13, 1.04, 0.86];
  const variance = rng.float(0.86, 1.14);

  return Math.max(
    18,
    Math.round(
      base *
        monthMultipliers[month] *
        dayWeights[day.getUTCDay()] *
        campaign.trafficMultiplier *
        variance,
    ),
  );
}

function getCampaign(day: Date): Campaign {
  const month = day.getUTCMonth() + 1;
  const date = day.getUTCDate();

  if (month === 11 && date >= 18 && date <= 30) {
    return {
      name: 'black_friday_performance_sale',
      trafficMultiplier: 2.35,
      conversionLift: 1.45,
    };
  }

  if (month === 1 && date <= 18) {
    return {
      name: 'new_year_training_plan',
      trafficMultiplier: 1.42,
      conversionLift: 0.62,
      category: 'training',
    };
  }

  if ((month === 4 && date >= 8) || (month === 5 && date <= 18)) {
    return {
      name: 'spring_race_ready',
      trafficMultiplier: 1.34,
      conversionLift: 0.54,
      category: 'running',
    };
  }

  if (month === 6 || month === 7) {
    return {
      name: 'summer_swim_outdoor',
      trafficMultiplier: 1.18,
      conversionLift: 0.36,
      category: month === 6 ? 'swim' : 'outdoor',
    };
  }

  if (month === 9) {
    return {
      name: 'back_to_training',
      trafficMultiplier: 1.48,
      conversionLift: 0.72,
      category: 'running',
    };
  }

  return { name: 'always_on_global', trafficMultiplier: 1, conversionLift: 0 };
}

function getDevice(country: string) {
  const mobileWeight = ['CN', 'SG', 'KR', 'JP', 'IN', 'BR', 'MX'].includes(country) ? 0.68 : 0.58;
  return rng.weighted([
    { value: 'mobile', weight: mobileWeight },
    { value: 'desktop', weight: 0.34 },
    { value: 'tablet', weight: 0.08 },
  ]);
}

function getDeviceInfo(device: string) {
  if (device === 'mobile') {
    const os = rng.weighted([
      { value: 'iOS', weight: 0.52 },
      { value: 'Android', weight: 0.48 },
    ]);
    return {
      os,
      browser:
        os === 'iOS'
          ? rng.weighted([
              { value: 'Safari', weight: 0.78 },
              { value: 'Chrome', weight: 0.22 },
            ])
          : rng.weighted([
              { value: 'Chrome', weight: 0.82 },
              { value: 'Samsung', weight: 0.1 },
              { value: 'Firefox', weight: 0.08 },
            ]),
      screen: rng.pick(['390x844', '414x896', '393x873', '428x926', '360x800', '412x915']),
    };
  }

  if (device === 'tablet') {
    return {
      os: rng.weighted([
        { value: 'iOS', weight: 0.68 },
        { value: 'Android', weight: 0.32 },
      ]),
      browser: rng.weighted([
        { value: 'Safari', weight: 0.58 },
        { value: 'Chrome', weight: 0.38 },
        { value: 'Firefox', weight: 0.04 },
      ]),
      screen: rng.pick(['1024x768', '834x1194', '820x1180', '800x1280']),
    };
  }

  return {
    os: rng.weighted([
      { value: 'Windows 11', weight: 0.38 },
      { value: 'Windows 10', weight: 0.28 },
      { value: 'Mac OS', weight: 0.26 },
      { value: 'Linux', weight: 0.08 },
    ]),
    browser: rng.weighted([
      { value: 'Chrome', weight: 0.62 },
      { value: 'Safari', weight: 0.14 },
      { value: 'Edge', weight: 0.13 },
      { value: 'Firefox', weight: 0.11 },
    ]),
    screen: rng.pick(['1920x1080', '1440x900', '1536x864', '2560x1440', '1366x768', '1680x1050']),
  };
}

function getCustomerType(country: string) {
  const returningBoost = ['US', 'CA', 'GB', 'AU', 'NZ'].includes(country) ? 0.1 : 0;
  return rng.weighted([
    { value: 'new', weight: 0.5 - returningBoost },
    { value: 'returning', weight: 0.38 + returningBoost },
    { value: 'vip', weight: 0.12 },
  ]);
}

function getDistinctId(country: string, customerType: string) {
  const pool = distinctIdsByCountry.get(country) ?? [];
  distinctIdsByCountry.set(country, pool);

  if (customerType !== 'new' && pool.length && rng.chance(customerType === 'vip' ? 0.86 : 0.62)) {
    return rng.pick(pool);
  }

  const id = `hs_${country.toLowerCase()}_${hashShort(`${country}:${pool.length}:${sessionSequence}`)}`;
  pool.push(id);
  return id;
}

function getIntentScore(customerType: string, campaign: Campaign, channel: string) {
  const base = customerType === 'vip' ? 72 : customerType === 'returning' ? 58 : 42;
  const channelBoost = ['email', 'paid_search'].includes(channel)
    ? 8
    : channel === 'direct'
      ? 4
      : 0;
  return clamp(
    Math.round(base + campaign.conversionLift * 8 + channelBoost + rng.normal(0, 12)),
    1,
    99,
  );
}

function getReferrer(country: string, campaign: Campaign): Referrer {
  const channel = rng.weighted([
    { value: 'direct', weight: 0.28 },
    { value: 'organic', weight: 0.3 },
    { value: 'paid_search', weight: campaign.name === 'always_on_global' ? 0.14 : 0.19 },
    { value: 'paid_social', weight: 0.11 },
    { value: 'email', weight: campaign.name === 'always_on_global' ? 0.06 : 0.09 },
    { value: 'referral', weight: 0.07 },
    { value: 'influencer', weight: 0.04 },
  ]);

  if (channel === 'direct') {
    return emptyReferrer(channel);
  }

  if (channel === 'organic') {
    const domain =
      country === 'CN' ? 'baidu.com' : rng.pick(['google.com', 'bing.com', 'duckduckgo.com']);
    return { ...emptyReferrer(channel), domain, path: domain === 'baidu.com' ? '/s' : '/search' };
  }

  if (channel === 'paid_search') {
    const source = country === 'CN' ? 'baidu' : rng.pick(['google', 'bing']);
    return {
      ...emptyReferrer(channel),
      domain: `${source}.com`,
      path: source === 'baidu' ? '/s' : '/search',
      utmSource: source,
      utmMedium: 'cpc',
      utmCampaign: campaign.name,
      utmContent: rng.pick(['brand', 'category', 'product', 'remarketing']),
      utmTerm: rng.pick(['running shoes', 'training gear', 'cycling kit', 'sport apparel']),
    };
  }

  if (channel === 'paid_social') {
    const source = country === 'CN' ? 'xiaohongshu' : rng.pick(['instagram', 'facebook', 'tiktok']);
    return {
      ...emptyReferrer(channel),
      domain: source === 'xiaohongshu' ? 'xiaohongshu.com' : `${source}.com`,
      utmSource: source,
      utmMedium: 'paid_social',
      utmCampaign: campaign.name,
      utmContent: rng.pick(['athlete_story', 'new_arrival', 'sale_video', 'fit_guide']),
    };
  }

  if (channel === 'email') {
    return {
      ...emptyReferrer(channel),
      utmSource: 'newsletter',
      utmMedium: 'email',
      utmCampaign: campaign.name,
      utmContent: rng.pick(['weekly_edit', 'member_offer', 'race_calendar']),
    };
  }

  if (channel === 'influencer') {
    const source = rng.pick(['strava_creator', 'youtube_runner', 'instagram_coach']);
    return {
      ...emptyReferrer(channel),
      domain: source.includes('youtube') ? 'youtube.com' : 'instagram.com',
      utmSource: source,
      utmMedium: 'creator',
      utmCampaign: campaign.name,
    };
  }

  return {
    ...emptyReferrer(channel),
    domain: rng.pick(['strava.com', 'runnersworld.com', 'cyclingweekly.com', 'outsideonline.com']),
    path: '/gear',
  };
}

function emptyReferrer(channel: string): Referrer {
  return {
    channel,
    domain: null,
    path: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    utmTerm: null,
  };
}

function chooseProduct(persona: Persona, campaign: Campaign) {
  const preferredCategory = campaign.category ?? personaCategory[persona];
  const preferred = products.filter(product => product.category === preferredCategory);

  if (preferred.length && rng.chance(0.75)) {
    return rng.pick(preferred);
  }

  return rng.pick(products);
}

function getCoupon(campaign: Campaign) {
  if (campaign.name === 'black_friday_performance_sale') return 'HARBORBF25';
  if (campaign.name === 'new_year_training_plan') return 'TRAIN15';
  if (campaign.name === 'spring_race_ready') return 'RACEREADY10';
  if (campaign.name === 'summer_swim_outdoor') return 'SUMMER10';
  return rng.pick(['WELCOME10', 'MEMBER12', 'FREESHIP']);
}

function getDiscount(campaignName: string) {
  if (campaignName === 'black_friday_performance_sale') return 0.22;
  if (campaignName === 'new_year_training_plan') return 0.12;
  if (campaignName === 'spring_race_ready') return 0.1;
  if (campaignName === 'summer_swim_outdoor') return 0.08;
  return rng.chance(0.18) ? 0.1 : 0;
}

function getMarket(country: string) {
  if (['US', 'CA', 'MX'].includes(country)) return 'north_america';
  if (['GB', 'DE', 'FR', 'NL', 'ES', 'IT', 'SE', 'CH'].includes(country)) return 'europe';
  if (['CN', 'JP', 'KR', 'SG', 'IN'].includes(country)) return 'asia_pacific';
  if (['AU', 'NZ'].includes(country)) return 'oceania';
  if (['BR'].includes(country)) return 'latin_america';
  return 'middle_east';
}

function getClickPoint(pageKey: string, screen: string) {
  const page = getPage(pageKey);
  const viewport = getViewport(screen);
  const points: Record<string, [number, number, number][]> = {
    home: [
      [0.18, 0.14, 0.18],
      [0.5, 0.23, 0.28],
      [0.72, 0.44, 0.2],
      [0.36, 0.62, 0.18],
      [0.84, 0.78, 0.16],
    ],
    shop: [
      [0.22, 0.16, 0.18],
      [0.35, 0.34, 0.26],
      [0.58, 0.36, 0.22],
      [0.8, 0.52, 0.18],
    ],
    running: [
      [0.2, 0.18, 0.16],
      [0.42, 0.34, 0.28],
      [0.64, 0.35, 0.22],
      [0.84, 0.56, 0.2],
    ],
    productRunner: [
      [0.56, 0.28, 0.26],
      [0.72, 0.42, 0.34],
      [0.64, 0.58, 0.2],
      [0.35, 0.72, 0.2],
    ],
    productTrainer: [
      [0.56, 0.28, 0.26],
      [0.72, 0.42, 0.34],
      [0.64, 0.58, 0.2],
      [0.35, 0.72, 0.2],
    ],
    cart: [
      [0.74, 0.22, 0.25],
      [0.68, 0.52, 0.45],
      [0.32, 0.62, 0.12],
    ],
    checkout: [
      [0.68, 0.32, 0.24],
      [0.76, 0.62, 0.54],
      [0.24, 0.48, 0.12],
    ],
    sale: [
      [0.52, 0.2, 0.24],
      [0.36, 0.38, 0.28],
      [0.74, 0.44, 0.22],
    ],
  };
  const [xRatio, yRatio] = rng.weighted(
    (points[pageKey] ?? points.home).map(([x, y, weight]) => ({
      value: [x, y] as [number, number],
      weight,
    })),
  );
  const x = clamp(
    Math.round(xRatio * viewport.width + rng.normal(0, viewport.width * 0.025)),
    8,
    viewport.width - 8,
  );
  const y = clamp(
    Math.round(yRatio * viewport.height + rng.normal(0, viewport.height * 0.025)),
    8,
    viewport.height - 8,
  );
  const pageX = clamp(
    Math.round(xRatio * page.pageW + rng.normal(0, page.pageW * 0.025)),
    8,
    page.pageW - 8,
  );
  const pageY = clamp(
    Math.round(yRatio * page.pageH + rng.normal(0, page.pageH * 0.025)),
    8,
    page.pageH - 8,
  );

  return {
    x,
    y,
    pageX,
    pageY,
    pageW: page.pageW,
    pageH: page.pageH,
    viewportW: viewport.width,
    viewportH: viewport.height,
  };
}

function getViewport(screen: string) {
  const [width, height] = screen.split('x').map(value => Number(value));
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1440,
    height: Number.isFinite(height) && height > 0 ? height : 900,
  };
}

function timestampForDay(day: Date) {
  const hour = rng.weighted([
    { value: 0, weight: 0.02 },
    { value: 1, weight: 0.01 },
    { value: 6, weight: 0.04 },
    { value: 7, weight: 0.07 },
    { value: 8, weight: 0.08 },
    { value: 9, weight: 0.07 },
    { value: 10, weight: 0.08 },
    { value: 11, weight: 0.07 },
    { value: 12, weight: 0.06 },
    { value: 13, weight: 0.07 },
    { value: 14, weight: 0.08 },
    { value: 15, weight: 0.08 },
    { value: 16, weight: 0.07 },
    { value: 17, weight: 0.07 },
    { value: 18, weight: 0.07 },
    { value: 19, weight: 0.06 },
    { value: 20, weight: 0.05 },
    { value: 21, weight: 0.04 },
    { value: 22, weight: 0.03 },
    { value: 23, weight: 0.02 },
  ]);
  const date = new Date(day);
  date.setUTCHours(hour, rng.int(0, 59), rng.int(0, 59), rng.int(0, 999));
  return date;
}

function getPage(key: string) {
  const page = pageByKey.get(key);
  if (!page) throw new Error(`Unknown page key: ${key}`);
  return page;
}

function isProductPage(key: string) {
  return products.some(product => product.pageKey === key);
}

function uuidFor(...parts: Array<string | number>) {
  const hex = createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function hashShort(input: string) {
  return createHash('sha256').update(input).digest('hex').slice(0, 10);
}

function datesBetween(startDate: Date, endDate: Date) {
  const dates: Date[] = [];
  let current = startOfUtcDay(startDate);
  const end = startOfUtcDay(endDate);

  while (current <= end) {
    dates.push(current);
    current = addDays(current, 1);
  }

  return dates;
}

function startOfUtcDay(date: Date) {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1000);
}

function iso(date: Date) {
  return date.toISOString();
}

function round(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

class Rng {
  private state: number;

  constructor(seed: string) {
    this.state = createHash('sha256').update(seed).digest().readUInt32LE(0) || 1;
  }

  next() {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0x100000000;
  }

  int(min: number, max: number) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  float(min: number, max: number) {
    return this.next() * (max - min) + min;
  }

  chance(probability: number) {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]) {
    return items[this.int(0, items.length - 1)] as T;
  }

  weighted<T>(options: readonly WeightedOption<T>[]) {
    const total = options.reduce((sum, option) => sum + option.weight, 0);
    let target = this.next() * total;

    for (const option of options) {
      target -= option.weight;
      if (target <= 0) return option.value;
    }

    return options[options.length - 1].value;
  }

  normal(mean: number, stdDev: number) {
    const u = 1 - this.next();
    const v = this.next();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return mean + z * stdDev;
  }
}

rng = new Rng('harbor-sport-global-demo-v1');

if (process.argv.includes('--help')) {
  console.log(`
Harbor Sport seed SQL generator

Usage:
  pnpm seed-harbor-sport | docker compose exec -T db psql -U umami -d umami

The script writes SQL to stdout. It only deletes and recreates the Harbor Sport
demo website and its related synthetic rows.
`);
} else {
  main();
}
