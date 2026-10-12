import type { RoleGuide } from './types';
import { notificationsTopic, signInTopic } from './shared';

export const superAdminGuide: RoleGuide = {
  slug: 'super-admin',
  hubTitle: 'Platform Guide',
  hubDesc: 'How to run schools on the EduOS platform.',
  heroText: 'Register schools, sell and approve seats, set prices, brand each school and manage its web address.',
  quickActions: ['schools', 'seats', 'pricing', 'customization', 'domains'],
  help: {
    title: 'Need to trace a change?',
    text: 'The audit log records every administrative action across the platform.',
    label: 'Open Audit Logs',
    href: '/super-admin/audit',
  },
  topics: [
    {
      id: 'dashboard', title: 'Platform dashboard', category: 'Home Base', icon: '◫',
      href: '/super-admin', openLabel: 'Open Dashboard',
      summary: 'Every school on the platform with its School Admins, profile counts and any suspended or inactive accounts.',
      steps: ['Click Manage on a school to work with it.'],
    },
    {
      id: 'schools', title: 'Schools & admins', category: 'Schools', icon: '🏫',
      href: '/super-admin/schools', openLabel: 'Open Schools & Admins',
      summary: 'Register schools and manage the School Admin accounts that run them.',
      workflow: ['New School', 'Set address', 'Add first School Admin', 'Open school'],
      steps: [
        'Click "+ New School", enter the school name and its address (lowercase letters, digits and hyphens; this becomes part of the sign-in address), and optionally the seats purchased and the school website.',
        'Create the first School Admin with full name, phone (E.164, e.g. +919876543210), email and password.',
        'Select a school to add more School Admins, edit its website, suspend or reactivate it, or click "Open school →" to view it.',
      ],
      tips: ['A school\'s website domain feeds Domain Management, where it is verified before it can be used.'],
    },
    {
      id: 'seats', title: 'Seat management', category: 'Schools', icon: '🪑', isNew: true,
      href: '/super-admin/seats', openLabel: 'Open Seat Management',
      summary: 'Seats sold to each school, and the extra-seat requests waiting on a decision.',
      steps: [
        'Select a school to see approved seats, seats in use, and seats paid for but awaiting approval.',
        'Click "Sell seats" to add seats with an optional note. A negative number corrects an overcount.',
        'Under "Extra-seat requests", Approve or Reject what schools have asked for (with an optional note).',
        'Every change is recorded in the school\'s seat history.',
      ],
      tips: ['A school with no seats sold has no limit.'],
    },
    {
      id: 'pricing', title: 'Per-seat pricing', category: 'Schools', icon: '₹', isNew: true,
      href: '/super-admin/pricing', openLabel: 'Open Per-Seat Pricing',
      summary: 'What each school pays for a seat.',
      steps: [
        'Select a school and click "Set price".',
        'Enter the price, currency (three-letter code, e.g. INR), the effective-from date and an optional note.',
        'Deactivate or reactivate price versions as needed.',
      ],
      tips: ['Changing a price never alters what has already been charged. Every version is kept, so old requests still show the price they were charged at.'],
    },
    {
      id: 'customization', title: 'School customization', category: 'Schools', icon: '◈', isNew: true,
      href: '/super-admin/customization', openLabel: 'Open School Customization',
      summary: 'Theme, branding and dropdown values, configured separately for each school.',
      steps: [
        'Select a school.',
        'Set the primary, secondary and accent colours, display name, tagline, logo and favicon, and choose what the header and sidebar show.',
        'Check the Preview, then click Save. "Reset to default" returns the school to the default look.',
        'Under "Dropdown values", add a list (e.g. house) with its label and options, one per line.',
      ],
      tips: ['Logos and favicons can be uploaded or given as an https URL. SVG is not accepted.'],
    },
    {
      id: 'domains', title: 'Domain management', category: 'Schools', icon: '🌐', isNew: true,
      href: '/super-admin/domains', openLabel: 'Open Domain Management',
      summary: 'The address each school is served at: a platform subdomain or its own custom domain.',
      workflow: ['Add domain', 'School creates DNS records', 'Verify', 'Check SSL', 'Activate'],
      steps: [
        'Choose Subdomain or Custom domain for a school, or "Import from profile" to use the website its School Admin entered.',
        'Enter the domain name only (e.g. www.abcschool.com, no https:// or path). It is saved as pending.',
        'Share the DNS instructions (type, name, value) with the school. Use Copy to copy each value.',
        'Once DNS resolves, click "Check SSL", then Activate. Deactivate takes a domain offline immediately.',
      ],
      tips: ['A new domain stays inactive until it is verified, has a certificate and is activated. The current live domain keeps working until then.'],
    },
    {
      id: 'dashboards', title: 'School dashboards', category: 'Schools', icon: '◪',
      href: '/super-admin/dashboards', openLabel: 'Open School Dashboards',
      summary: 'Every school-wide summary the school portals show, read from the same data: operations, finance, hostel and library.',
      steps: ['Select a school and switch between Operations, Finance, Hostel and Library.'],
    },
    {
      id: 'audit', title: 'Audit log', category: 'System', icon: '▷',
      href: '/super-admin/audit', openLabel: 'Open Audit Logs',
      summary: 'A complete record of administrative actions.',
      steps: ['Filter by role, action (e.g. student.create) or month.'],
    },
    {
      id: 'permissions', title: 'Access & permissions', category: 'System', icon: '🔐',
      href: '/super-admin/permissions', openLabel: 'Open Access & Permissions',
      summary: 'Control what each role can see and do across the platform.',
      highlights: [
        { label: 'ALL', text: 'The role can act on the whole school.' },
        { label: 'OWN', text: 'The role is limited to its own classes, children or records.' },
      ],
    },
    {
      id: 'platform-view', title: 'Viewing a school (platform view)', category: 'Schools', icon: '👁',
      summary: 'Open any school\'s own portal to see what its staff see, without signing in as them.',
      steps: [
        'In Schools & Admins, select a school and click "Open school →".',
        'A "Platform view" banner shows which school you are looking at.',
        'Click "Leave school view" in the banner to return to the platform console.',
      ],
    },
    {
      id: 'ask-agent', title: 'Ask Agent and the platform account', category: 'Help & Support', icon: '✨',
      summary: 'Ask Agent is a school assistant. It answers from a school\'s own records with that school\'s permissions, so the platform administrator account is deliberately not given access to it.',
      tips: [
        'Use the pages in this console for platform work: schools, seats, pricing, customization and domains.',
        'To see a school\'s data, use platform view, or ask that school\'s admin.',
      ],
    },
    signInTopic({ platform: true }),
    notificationsTopic,
  ],
};
