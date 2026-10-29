export interface SubscriptionPlan {
  id: string;
  name: string;
  priceNPR: number; // Price in Nepali Rupees
  pricePaisa: number; // Khalti uses paisa (1 NPR = 100 paisa)
  durationDays: number;
  maxResolution: string; // e.g., "1080p", "4K"
  maxConcurrentStreams: number;
  features: string[];
}

export const SUBSCRIPTION_PLANS: Record<string, SubscriptionPlan> = {
  basic: {
    id: "basic",
    name: "Basic",
    priceNPR: 12,
    pricePaisa: 1200,
    durationDays: 30,
    maxResolution: "720p",
    maxConcurrentStreams: 1,
    features: ["SD & HD streaming", "Watch on 1 device", "Cancel anytime"],
  },
  standard: {
    id: "standard",
    name: "Standard",
    priceNPR: 13,
    pricePaisa: 1300,
    durationDays: 30,
    maxResolution: "1080p",
    maxConcurrentStreams: 2,
    features: [
      "Full HD streaming",
      "Watch on 2 devices",
      "Download for offline",
      "Cancel anytime",
    ],
  },
  premium: {
    id: "premium",
    name: "Premium",
    priceNPR: 14,
    pricePaisa: 1400,
    durationDays: 30,
    maxResolution: "4K",
    maxConcurrentStreams: 4,
    features: [
      "4K + HDR streaming",
      "Watch on 4 devices",
      "Download for offline",
      "Spatial Audio",
      "Cancel anytime",
    ],
  },
};
