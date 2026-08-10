// src/features/feedback/feedbackSeedItems.ts

import { FeedbackCategory } from "../../types/community";

export interface FeedbackSeedItem {
  title: string;
  body: string;
  category: FeedbackCategory;
}

export const FEEDBACK_SEED_ITEMS: FeedbackSeedItem[] = [
  {
    category: "feature",
    title: "Add a way to bookmark campsites",
    body:
      "It would be great if we could save campsites we want to try later. Something simple like a favorites list or a 'save for later' button when viewing park details.",
  },
  {
    category: "bug",
    title: "Map sometimes loads without markers",
    body:
      "When I open the Parks tab, the map shows up but the campsite markers take a long time to appear. It has not crashed, but it feels slow compared to the rest of the app.",
  },
  {
    category: "improvement",
    title: "Dark mode could use slightly brighter text",
    body:
      "Dark mode looks great, but the body text is a little dim on my phone at night. A touch more contrast would make it easier to read while camping.",
  },
  {
    category: "question",
    title: "Does the trip planner save drafts automatically?",
    body:
      "I started building a trip and was not sure if the app saves changes on its own or if I need to tap something to save. Just checking how it behaves.",
  },
  {
    category: "feature",
    title: "Add gear checklists for different camping styles",
    body:
      "I would love preset checklists for car camping, backpacking, and family camping. It would help new campers know where to start and keep things organized.",
  },
  {
    category: "bug",
    title: "Text overlaps on smaller screens",
    body:
      "On my older iPhone, a few labels in the Gear Reviews section wrap strangely. Not a deal breaker, just something I noticed.",
  },
  {
    category: "improvement",
    title: "Can the app remember my last used filter?",
    body:
      "Every time I return to Parks, the filters reset. It would be helpful if it kept my options between sessions.",
  },
  {
    category: "other",
    title: "Love the vintage style design",
    body:
      "Just wanted to say the illustrations and colors make the app feel cozy. It reminds me of old guidebooks my dad had in the camper.",
  },
  {
    category: "question",
    title: "How do I submit campsite photos?",
    body:
      "Is photo sharing available yet, or is that still coming later? I have a few great campground shots I would love to add.",
  },
];
