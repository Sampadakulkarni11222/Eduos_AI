import type { GuideTopic } from './types';

/**
 * What Ask Agent can read and do for one role. Keep these lists in step with
 * that role's tools in docs/mcp-tools.json (the MCP role matrix).
 */
export interface AgentCapabilities {
  askAbout: string[];
  canDo: string[];
  examples: string[];
  /** Features of this portal the assistant has no tools for yet; they are used from their page instead. */
  notYet?: string[];
}

/** The Ask Agent assistant in the top bar: what it can read and do for this role. */
export function askAgentTopic({ askAbout, canDo, examples, notYet = [] }: AgentCapabilities): GuideTopic {
  return {
    id: 'ask-agent',
    title: 'Ask Agent (AI assistant)',
    shortTitle: 'Ask Agent',
    category: 'Help & Support',
    icon: '✨',
    summary: 'Ask Agent answers questions from your school\'s own records and can carry out everyday tasks for you. Open it with the ✨ Ask Agent button at the top of any page.',
    highlights: [
      { label: 'You can ask about', text: `${askAbout.join(', ')}.` },
      ...(canDo.length ? [{ label: 'It can do for you', text: `${canDo.join(', ')}.` }] : []),
      { label: 'Try asking', text: examples.map((e) => `"${e}"`).join(', ') },
      { label: 'Safe actions', text: 'Before creating or changing anything, the assistant shows a summary of exactly what it will do. Nothing is saved until you confirm.' },
      { label: 'Voice and language', text: 'Use the microphone to speak your question in English, हिन्दी, मराठी, বাংলা, தமிழ், తెలుగు, ગુજરાતી, ಕನ್ನಡ, മലയാളം or ਪੰਜਾਬੀ.' },
      { label: 'Long answers', text: 'Long lists show the first few rows; use "Read more" to see the rest. Nothing is left out.' },
      { label: 'WhatsApp', text: 'If your school has turned on WhatsApp, "Chat on WhatsApp" continues the conversation on your phone. It works from the phone number on your EduOS account.' },
    ],
    tips: [
      'The assistant only sees what your role is allowed to see, and politely refuses anything else.',
      ...(notYet.length ? [`The assistant cannot handle ${notYet.join(' or ')} yet. Use their pages from the sidebar.`] : []),
      'Full replies are available in English and हिन्दी. In other languages, replies may come back in English.',
    ],
  };
}

export const notificationsTopic: GuideTopic = {
  id: 'notifications',
  title: 'Notifications',
  category: 'Help & Support',
  icon: '🔔',
  summary: 'The bell at the top of every page collects updates meant for you, such as new results, announcements, fee updates and decisions on your requests.',
  steps: [
    'Click the 🔔 bell. A number shows how many are unread.',
    'Click a notification to read it.',
    'When everything has been read you will see "You\'re all caught up".',
  ],
};

export const accessTip = 'If a menu item from this guide is missing for you, your role does not have permission for it. Ask your school administrator.';

/** Signing in, choosing a profile and signing out. Schools sign in at their own address; the platform at its own. */
export function signInTopic({ platform = false }: { platform?: boolean } = {}): GuideTopic {
  return {
    id: 'sign-in',
    title: 'Signing in & your account',
    category: 'Help & Support',
    icon: '🔑',
    summary: platform
      ? 'Platform administrators sign in on the platform sign-in page. School staff, students and families sign in at their own school\'s address instead.'
      : 'Sign in at your school\'s own address with your email or phone number. Your school\'s name and logo appear on the sign-in page.',
    steps: [
      'Enter your email address or phone number and click "Send OTP".',
      'Enter the 6-digit code you receive, then click "Sign In". You can also use "Continue with Google" if your school has set it up.',
      'If your account has more than one profile (for example a teacher who is also a parent), choose the profile you want to use.',
      'To sign out, click Logout at the bottom of the sidebar.',
    ],
    tips: [
      'If you are told you are at the wrong address, use the link shown to reach your own school\'s sign-in page.',
      ...(platform ? [] : ['On a phone, open the menu (☰) at the top left to see the sidebar.']),
    ],
  };
}
