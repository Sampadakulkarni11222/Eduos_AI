export interface GuideHighlight {
  label: string;
  text: string;
}

export interface GuideTopic {
  id: string;
  title: string;
  /** Short label for quick-action buttons; defaults to the open button's target name. */
  shortTitle?: string;
  category: string;
  icon: string;
  summary: string;
  /** Portal route this topic explains, unprefixed (e.g. '/admin/users'); omitted for features with no page of their own. */
  href?: string;
  openLabel?: string;
  isNew?: boolean;
  highlights?: GuideHighlight[];
  workflow?: string[];
  steps?: string[];
  tips?: string[];
}

export interface RoleGuide {
  /** Portal slug, matching PORTALS in lib/portals.ts. */
  slug: string;
  hubTitle: string;
  hubDesc: string;
  heroText: string;
  topics: GuideTopic[];
  /** Topic ids shown as buttons in the hero. */
  quickActions: string[];
  help: { title: string; text: string; label: string; href: string };
}
