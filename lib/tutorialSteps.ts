// /workspaces/Vext/lib/tutorialSteps.ts

export type TutorialPlacement = "top" | "bottom" | "left" | "right" | "center";

export interface TutorialStep {
  id: string;
  message: string;
  // CSS selector for the real element to spotlight — matches the
  // data-tutorial="..." attributes added throughout the app. Omit for a
  // centered, no-target message (e.g. a welcome/closing step).
  targetSelector?: string;
  placement?: TutorialPlacement;
}

export const VISITOR_TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "welcome",
    message: "Welcome to Vext! Let's take a quick look around — you can skip this anytime.",
  },
  {
    id: "feed",
    message: "Swipe up for the next service, swipe down to go back — just like scrolling any video feed.",
  },
  {
    id: "like",
    message: "Tap the heart to like a service you're into.",
    targetSelector: '[data-tutorial="like-button"]',
    placement: "left",
  },
  {
    id: "comment",
    message: "Leave a comment or question for the provider here.",
    targetSelector: '[data-tutorial="comment-button"]',
    placement: "left",
  },
  {
    id: "share",
    message: "Found something worth sharing? Send it to a friend from here.",
    targetSelector: '[data-tutorial="share-button"]',
    placement: "left",
  },
  {
    id: "book",
    message: "When you're ready, tap Book Service to pick a time and pay — right from the feed.",
    targetSelector: '[data-tutorial="book-service-button"]',
    placement: "left",
  },
  {
    id: "search",
    message: "Looking for something specific? Search by service or provider here.",
    targetSelector: '[data-tutorial="search"]',
    placement: "bottom",
  },
  {
    id: "filters",
    message: "Or narrow things down with filters — location, price, and more.",
    targetSelector: '[data-tutorial="filters"]',
    placement: "bottom",
  },
  {
    id: "profile",
    message: "Your account, bookings, and settings all live here. That's it — enjoy Vext!",
    targetSelector: '[data-tutorial="profile-menu"]',
    placement: "bottom",
  },
];

export const PROVIDER_TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "welcome",
    message: "Welcome aboard! Here's a quick tour of managing your services on Vext.",
  },
  {
    id: "services-offered",
    message: "This is where clients see your price list. Tap it to add services, set prices and durations, and mark any as available for housecall.",
    targetSelector: '[data-tutorial="services-offered-button"]',
    placement: "top",
  },
  {
    id: "uploads",
    message: "Post videos of your work from the feed — clients book directly from what they see.",
  },
  {
    id: "settings",
    message: "Business details, your location, and mobile-service settings all live in your Profile page — tap the profile icon anytime to get there.",
  },
];