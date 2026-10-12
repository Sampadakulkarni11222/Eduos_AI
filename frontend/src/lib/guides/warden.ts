import type { RoleGuide } from './types';
import { askAgentTopic, notificationsTopic, accessTip, signInTopic } from './shared';

export const wardenGuide: RoleGuide = {
  slug: 'warden',
  hubTitle: 'Hostel Hub',
  hubDesc: 'How to run the hostel in EduOS.',
  heroText: 'Manage rooms and allocations, look after residents, and answer hostel queries.',
  quickActions: ['rooms', 'students', 'medical', 'tickets'],
  help: {
    title: 'Got a hostel query?',
    text: 'Questions from students and parents arrive as support tickets.',
    label: 'Open Support Tickets',
    href: '/warden/tickets',
  },
  topics: [
    {
      id: 'dashboard', title: 'Hostel overview', category: 'Home Base', icon: '◫',
      href: '/warden', openLabel: 'Open Dashboard',
      summary: 'Hostel facilities, student welfare and room allocations at a glance.',
      highlights: [
        { label: 'Counts', text: 'Total rooms, occupied beds, hostel enquiries and maintenance requests.' },
        { label: 'Hostel Tickets & Requests', text: 'Open requests from residents and parents.' },
        { label: 'Leave Awaiting Approval', text: 'Resident leave that needs a decision.' },
        { label: 'Quick Actions', text: 'Room allocations, the students directory and an emergency medical lookup.' },
      ],
    },
    {
      id: 'rooms', title: 'Rooms and allocations', category: 'Hostel', icon: '▦',
      href: '/warden/rooms', openLabel: 'Open Room Management',
      summary: 'Create rooms and place students in them.',
      steps: [
        'Click Add Room and enter the room number, block/wing (e.g. Boys Hostel) and room type (General, Boys, Girls or Staff).',
        'Click Allocate (or "Allocate Student"), then choose the student and room.',
        'Use Vacate when a student moves out.',
        'For many at once use "Bulk Upload Rooms" or "Bulk Allocate" with the CSV template. Rows with errors are listed so you can fix and re-upload them.',
      ],
      tips: ['Search by room or block to find a room quickly.'],
    },
    {
      id: 'students', title: 'Hostel students', category: 'Hostel', icon: '◈',
      href: '/warden/students', openLabel: 'Open Hostel Students',
      summary: 'A directory of every student currently allocated to a hostel block.',
      steps: ['Search by student name, room or block to see their admission number, class, block and room.'],
    },
    {
      id: 'medical', title: 'Medical records', category: 'Health & Care', icon: '✚',
      href: '/warden/medical', openLabel: 'Open Medical Records',
      summary: 'Health records of your residents, including allergies, medications and emergency contacts.',
      steps: [
        'Search for a student and select them.',
        'Review blood group, emergency contact, allergies, medications and history, and update them when needed.',
      ],
      tips: ['In an emergency, use "Emergency Medical Lookup" on the dashboard to get there fast.'],
    },
    {
      id: 'announcements', title: 'Notice board', category: 'Communication', icon: '◍',
      href: '/warden/announcements', openLabel: 'Open Announcements',
      summary: 'School notices and hostel circulars.',
    },
    {
      id: 'tickets', title: 'Hostel queries', category: 'Communication', icon: '✉',
      href: '/warden/tickets', openLabel: 'Open Support Tickets',
      summary: 'Support tickets and enquiries from residents and parents.',
      steps: ['Open a ticket, read the conversation, then type a reply and press Send.'],
    },
    askAgentTopic({
      askAbout: ['the hostel summary', 'rooms and allocations', 'residents', 'hostel enquiries', 'residents\' medical records', 'students', 'announcements and the calendar', 'hostel queries'],
      canDo: ['add or update rooms', 'allocate or vacate a bed', 'record and update hostel enquiries', 'reply to and update hostel queries'],
      examples: ['Which rooms are vacant?', 'Who is in room 104?', 'Allocate a bed in Block A to Riya Sharma'],
    }),
    signInTopic(),
    { ...notificationsTopic, tips: [accessTip] },
  ],
};
